// src/ui/composables/useMessaging.ts
import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import type { FrameTreeNodeWire } from '../../types/frameTree'
import type {
  FrameTreePayload,
  SettingsStatePayload,
  ExportProgressPayload,
  ExportResultPayload,
  UiLocaleStatePayload,
} from '../../types/messages'
import type { usePathSettings } from './usePathSettings'
import type { useFontManager } from './useFontManager'
import type { useAtlasSettings } from './useAtlasSettings'
import type { useEngineSelector } from './useEngineSelector'
import type { useExportOrchestrator } from './useExportOrchestrator'
import type { useSettingsPersistence } from './useSettingsPersistence'
import type { useExportFrameSync } from './useExportFrameSync'
import type { I18nApi } from '../i18n/injectionKey'

interface Deps {
  pathSettings: ReturnType<typeof usePathSettings>
  fontManager: ReturnType<typeof useFontManager>
  atlasSettings: ReturnType<typeof useAtlasSettings>
  engineSelector: ReturnType<typeof useEngineSelector>
  exportOrch: ReturnType<typeof useExportOrchestrator>
  persistence: ReturnType<typeof useSettingsPersistence>
  frameSync: ReturnType<typeof useExportFrameSync>
  frameTreeRoots: Ref<FrameTreeNodeWire[]>
  selectedFrameIds: Ref<string[]>
  devUiVisible: Ref<boolean>
  sendToMain: (payload: unknown) => void
  /** 须由 `App.vue` 传入：同组件 setup 内 `inject` 读不到自身的 `provide`。 */
  i18n: I18nApi
}

function collectFrameWireIds(roots: readonly FrameTreeNodeWire[]): Set<string> {
  const s = new Set<string>()
  function walk(n: FrameTreeNodeWire): void {
    if (n.isExportFrame) s.add(n.id)
    for (const c of n.children) walk(c)
  }
  for (const r of roots) walk(r)
  return s
}

export function useMessaging(deps: Deps) {
  const {
    pathSettings, fontManager, atlasSettings, engineSelector,
    exportOrch, persistence, frameSync, frameTreeRoots, selectedFrameIds,
    devUiVisible, sendToMain, i18n,
  } = deps

  const { t, hydratePreferenceFromMain } = i18n

  type ConnMessageKey = 'conn.connecting' | 'conn.connected'
  let lastConnKey: ConnMessageKey = 'conn.connecting'
  const connectionLine = ref(t('conn.connecting'))

  watch(
    () => i18n.effectiveLang.value,
    () => {
      connectionLine.value = t(lastConnKey)
    }
  )

  let hasHydratedSettings = false

  frameSync.bindFrameSelectionWatch(persistence.suppressSave)

  function onMessage(event: MessageEvent): void {
    const pm = event.data?.pluginMessage
    if (!pm) return

    if (pm.type === 'PONG') {
      lastConnKey = 'conn.connected'
      connectionLine.value = t('conn.connected')
      return
    }

    if (pm.type === 'UI_LOCALE_STATE' && pm.payload && typeof pm.payload === 'object') {
      const pref = (pm.payload as UiLocaleStatePayload).preference
      if (pref === 'auto' || pref === 'en' || pref === 'zh-Hans' || pref === 'zh-Hant') {
        hydratePreferenceFromMain(pref)
      }
      return
    }

    if (pm.type === 'SETTINGS_STATE' && pm.payload && typeof pm.payload === 'object') {
      const payload = pm.payload as SettingsStatePayload
      persistence.suppressSave.value = true
      const isFirst = !hasHydratedSettings

      pathSettings.hydrate(payload, isFirst)
      fontManager.hydrate(payload, isFirst)
      atlasSettings.hydrate(payload)
      engineSelector.hydrate(payload)

      devUiVisible.value = Boolean(payload.devUiVisible)
      selectedFrameIds.value = Array.isArray(payload.exportFrameIds)
        ? [...payload.exportFrameIds]
        : []

      if (!hasHydratedSettings) hasHydratedSettings = true

      void nextTick(() => {
        persistence.suppressSave.value = false
      })
      sendToMain({ type: 'FONT_KEYS_REQUEST' })
      return
    }

    if (pm.type === 'FRAME_TREE' && pm.payload && typeof pm.payload === 'object') {
      const payload = pm.payload as FrameTreePayload
      if (Array.isArray(payload.roots)) {
        frameTreeRoots.value = payload.roots
        const valid = collectFrameWireIds(payload.roots)
        selectedFrameIds.value = selectedFrameIds.value.filter((id) => valid.has(id))
      }
      return
    }

    if (pm.type === 'FONT_KEYS_RESPONSE' && pm.payload && typeof pm.payload === 'object') {
      const keys = Array.isArray((pm.payload as { keys?: unknown }).keys)
        ? (pm.payload as { keys: string[] }).keys
        : []
      fontManager.setFontKeysFromMain(keys)
      return
    }

    if (pm.type === 'EXPORT_PROGRESS' && pm.payload && typeof pm.payload === 'object') {
      exportOrch.handleProgress(pm.payload as ExportProgressPayload)
      return
    }

    if (pm.type === 'EXPORT_RESULT' && pm.payload && typeof pm.payload === 'object') {
      exportOrch.handleResult(pm.payload as ExportResultPayload)
      return
    }
  }

  function onDevToggleKey(ev: KeyboardEvent): void {
    if (ev.ctrlKey && ev.shiftKey && (ev.key === 'D' || ev.key === 'd')) {
      ev.preventDefault()
      devUiVisible.value = !devUiVisible.value
    }
  }

  onMounted(() => {
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onDevToggleKey)
    sendToMain({ type: 'PING' })
    sendToMain({ type: 'READY' })
  })

  onUnmounted(() => {
    window.removeEventListener('message', onMessage)
    window.removeEventListener('keydown', onDevToggleKey)
  })

  return { connectionLine }
}
