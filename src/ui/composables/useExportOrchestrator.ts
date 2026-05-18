// src/ui/composables/useExportOrchestrator.ts
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import JSZip from 'jszip'
import { validateAssetsRelativeRoot } from '../../shared/pathValidation'
import { ReportCollector } from '../../pipeline/report'
import type { ReportEntry } from '../../shared/types'
import type {
  ExportFileWire,
  ExportProgressPayload,
  ExportResultPayload,
} from '../../types/messages'
import type { usePathSettings } from './usePathSettings'
import type { useFontManager } from './useFontManager'
import type { useEngineSelector } from './useEngineSelector'
import type { I18nApi } from '../i18n/injectionKey'

const EXPORT_REPORT_SESSION_KEY = 'figma2gameui:lastExportReportV1'

function loadPersistedExportReport(): { entries: ReportEntry[]; ok: boolean } | null {
  try {
    const raw = sessionStorage.getItem(EXPORT_REPORT_SESSION_KEY)
    if (raw === null || raw === '') return null
    const parsed = JSON.parse(raw) as { report?: unknown; ok?: unknown }
    if (!Array.isArray(parsed.report)) return null
    return { entries: parsed.report as ReportEntry[], ok: Boolean(parsed.ok) }
  } catch {
    return null
  }
}

function persistExportReport(entries: ReportEntry[], ok: boolean): void {
  try {
    sessionStorage.setItem(EXPORT_REPORT_SESSION_KEY, JSON.stringify({ report: entries, ok }))
  } catch {
    // 私密模式 / 配额等：忽略
  }
}

const DEFAULT_EXPORT_ROOT = '_figma_export'

interface Deps {
  pathSettings: ReturnType<typeof usePathSettings>
  fontManager: ReturnType<typeof useFontManager>
  engineSelector: ReturnType<typeof useEngineSelector>
  selectedFrameIds: Ref<string[]>
  flushExportFrameIdsSync: (ids?: readonly string[]) => void
  sendToMain: (payload: unknown) => void
  /** 须由 `App.vue` 传入：同组件 setup 内 `inject` 读不到自身的 `provide`。 */
  i18n: I18nApi
}

export function useExportOrchestrator(deps: Deps) {
  const {
    pathSettings,
    fontManager,
    engineSelector,
    selectedFrameIds,
    flushExportFrameIdsSync,
    sendToMain,
    i18n,
  } = deps
  const { t, effectiveLang } = i18n

  const exporting = ref(false)
  const progressLabel = ref('')
  const progressRatio = ref(0)
  const preflightReport = ref<ReportEntry[]>([])
  /** 最近一次完整导出（ZIP）的报告；有内容时报告面板优先显示本列表，避免被 dry-run 冲掉。 */
  const exportReport = ref<ReportEntry[]>([])
  /** 显示用报告：dry-run 用 preflight；完整导出用 exportReport。 */
  const sortedReport = computed(() =>
    ReportCollector.sortEntries(
      exportReport.value.length > 0 ? exportReport.value : preflightReport.value,
    ),
  )
  /** 仅显示 UI 侧「准备导出」文案时尚未收到主线程进度 label */
  const progressShowsOnlyPrepare = ref(false)
  /** 最近一次来自导出结果的校验横幅（用于切换语言时重算 t()） */
  const lastHadReportValidation = ref(false)
  const lastApplyEntries = ref<readonly ReportEntry[]>([])
  const lastApplyOk = ref(false)
  /** 导出前校验失败时保存 detail（message 语言与抛出时一致） */
  const exportBlockedDetail = ref<string | null>(null)

  onMounted(() => {
    const persisted = loadPersistedExportReport()
    if (persisted !== null && persisted.entries.length > 0) {
      exportReport.value = persisted.entries
      applyValidationFromReport(persisted.entries, persisted.ok)
    }
  })

  const validationBanner = ref<{ ok: boolean | null; title: string; detail: string }>({
    ok: null,
    title: t('validation.idleTitle'),
    detail: '',
  })

  const progressPercentText = computed(() => `${Math.round(progressRatio.value * 100)}%`)
  const canClickExport = computed(
    () =>
      pathSettings.canExportAnything.value &&
      selectedFrameIds.value.length > 0 &&
      !exporting.value
  )

  function applyValidationFromReport(entries: readonly ReportEntry[], ok: boolean): void {
    exportBlockedDetail.value = null
    lastHadReportValidation.value = true
    lastApplyEntries.value = entries
    lastApplyOk.value = ok
    const errs = entries.filter((e) => e.level === 'error')
    if (errs.length > 0) {
      validationBanner.value = {
        ok: false,
        title: ok ? t('validation.completedWithErrorsTitle') : t('validation.badTitleGeneric'),
        detail: errs[0]?.message ?? t('validation.badDetailFromReport'),
      }
      return
    }
    if (!ok) {
      validationBanner.value = {
        ok: false,
        title: t('validation.badTitleGeneric'),
        detail:
          entries.length > 0
            ? t('validation.badDetailFromReport')
            : t('validation.badDetailNoEntries'),
      }
      return
    }
    validationBanner.value = {
      ok: true,
      title: t('validation.okTitle'),
      detail: t('validation.okDetail'),
    }
  }

  async function zipAndDownload(files: ExportFileWire[]): Promise<void> {
    const zip = new JSZip()
    for (const f of files) zip.file(f.path, new Uint8Array(f.data))
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'figma2gameui-export.zip'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function requestExport(): Promise<void> {
    try {
      validateAssetsRelativeRoot(
        (pathSettings.exportRoot.value || DEFAULT_EXPORT_ROOT).trim()
      )
      validateAssetsRelativeRoot((pathSettings.prefabRel.value || 'prefabs').trim())
      validateAssetsRelativeRoot((pathSettings.textureRel.value || 'textures').trim())
      validateAssetsRelativeRoot((pathSettings.fontRel.value || 'fonts').trim())
      if (!pathSettings.canExportAnything.value) {
        throw new Error(t('export.err.needKind'))
      }
      if (selectedFrameIds.value.length === 0) {
        throw new Error(t('export.err.needFrame'))
      }
      const selectedEngine = engineSelector.getSelectedEngineOption()
      if (!selectedEngine || !selectedEngine.supported) {
        throw new Error(
          t('export.err.unsupportedEngine', { engine: engineSelector.selectedEngineKey.value })
        )
      }
      if (pathSettings.includeFonts.value) {
        const missingKeys = fontManager.fontKeys.value.filter(
          (key) => !fontManager.fontFileState.value[key]
        )
        if (missingKeys.length > 0) {
          throw new Error(t('export.err.needFontFiles', { count: missingKeys.length }))
        }
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      exportReport.value = [{ level: 'error', message: m }]
      lastHadReportValidation.value = false
      exportBlockedDetail.value = m
      validationBanner.value = { ok: false, title: t('validation.exportBlockedTitle'), detail: m }
      window.alert(m)
      return
    }

    const frameIds = [...selectedFrameIds.value]
    flushExportFrameIdsSync(frameIds)

    exporting.value = true
    progressShowsOnlyPrepare.value = true
    progressLabel.value = t('export.progress.prepare')
    progressRatio.value = 0
    const fontFiles = await fontManager.buildFontFilesPayload()
    sendToMain({
      type: 'EXPORT_REQUEST',
      payload: { fontFiles, selectedFrameIds: frameIds },
    })
  }

  function handleProgress(p: ExportProgressPayload): void {
    exporting.value = true
    const label = typeof p.label === 'string' ? p.label : ''
    if (label !== '') {
      progressShowsOnlyPrepare.value = false
    }
    progressLabel.value = label
    progressRatio.value = typeof p.ratio === 'number' ? p.ratio : 0
  }

  function handleResult(p: ExportResultPayload): void {
    const ok = Boolean(p.ok)
    const nextReport = Array.isArray(p.report) ? p.report : []
    const files = Array.isArray(p.files) ? p.files : []
    const isDryRun = p.dryRun === true
    exporting.value = false
    progressRatio.value = 0
    progressLabel.value = ''
    progressShowsOnlyPrepare.value = false
    if (isDryRun) {
      preflightReport.value = nextReport
      exportReport.value = []
      applyValidationFromReport(nextReport, ok)
      return
    }
    exportReport.value = nextReport
    persistExportReport(nextReport, ok)
    applyValidationFromReport(nextReport, ok)
    if (files.length > 0) void zipAndDownload(files)
  }

  watch(effectiveLang, () => {
    if (exportBlockedDetail.value !== null) {
      validationBanner.value = {
        ok: false,
        title: t('validation.exportBlockedTitle'),
        detail: exportBlockedDetail.value,
      }
    } else if (lastHadReportValidation.value) {
      applyValidationFromReport(lastApplyEntries.value, lastApplyOk.value)
    } else {
      validationBanner.value = { ok: null, title: t('validation.idleTitle'), detail: '' }
    }
    if (progressShowsOnlyPrepare.value && exporting.value) {
      progressLabel.value = t('export.progress.prepare')
    }
  })

  return {
    exporting,
    progressLabel,
    progressRatio,
    progressPercentText,
    preflightReport,
    exportReport,
    sortedReport,
    validationBanner,
    canClickExport,
    requestExport,
    handleProgress,
    handleResult,
  }
}
