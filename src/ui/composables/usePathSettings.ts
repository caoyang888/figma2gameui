// src/ui/composables/usePathSettings.ts
import { computed, ref } from 'vue'
import type { SettingsStatePayload } from '../../types/messages'

const DEFAULT_EXPORT_ROOT = '_figma_export'

export function normSeg(s: string): string {
  return (
    (s || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '') || '…'
  )
}

export function usePathSettings() {
  const exportRoot = ref(DEFAULT_EXPORT_ROOT)
  const prefabRel = ref('prefabs')
  const textureRel = ref('textures')
  const fontRel = ref('fonts')
  const includePrefabs = ref(true)
  const includeTextures = ref(true)
  const includeFonts = ref(true)
  const pathDetailsExpanded = ref(false)
  const exportConstraintsEnabled = ref(true)
  const widgetRootFillScreen = ref(false)
  const textureSubdirByPrimaryGroup = ref(false)
  const exportFigmaAutoLayoutEnabled = ref(false)
  const attachDebugIr = ref(false)

  const fullRootPreview = computed(() => `assets/${normSeg(exportRoot.value)}`)
  const fullPrefabPreview = computed(
    () => `assets/${normSeg(exportRoot.value)}/${normSeg(prefabRel.value)}/`
  )
  const fullTexturePreview = computed(
    () => `assets/${normSeg(exportRoot.value)}/${normSeg(textureRel.value)}/`
  )
  const fullFontPreview = computed(
    () => `assets/${normSeg(exportRoot.value)}/${normSeg(fontRel.value)}/`
  )
  const canExportAnything = computed(
    () => includePrefabs.value || includeTextures.value || includeFonts.value
  )

  function togglePathPanel(): void {
    pathDetailsExpanded.value = !pathDetailsExpanded.value
  }

  function hydrate(p: SettingsStatePayload, isFirstHydration: boolean): void {
    exportRoot.value =
      typeof p.exportRoot === 'string' && p.exportRoot.trim() !== ''
        ? p.exportRoot
        : DEFAULT_EXPORT_ROOT
    prefabRel.value =
      typeof p.prefabRel === 'string' && p.prefabRel.trim() !== ''
        ? p.prefabRel
        : 'prefabs'
    textureRel.value =
      typeof p.textureRel === 'string' && p.textureRel.trim() !== ''
        ? p.textureRel
        : 'textures'
    fontRel.value =
      typeof p.fontRel === 'string' && p.fontRel.trim() !== ''
        ? p.fontRel
        : 'fonts'
    includePrefabs.value = p.includePrefabs !== false
    includeTextures.value = p.includeTextures !== false
    includeFonts.value = p.includeFonts !== false
    exportConstraintsEnabled.value = p.exportConstraintsEnabled !== false
    widgetRootFillScreen.value = p.widgetRootFillScreen === true
    textureSubdirByPrimaryGroup.value = p.textureSubdirByPrimaryGroup === true
    exportFigmaAutoLayoutEnabled.value = p.exportFigmaAutoLayoutEnabled !== false
    attachDebugIr.value = Boolean(p.attachDebugIr)
    // 只在首次 hydration 设置，避免主线程回灌与本地 toggle 竞争导致抖动
    if (isFirstHydration) {
      pathDetailsExpanded.value = Boolean(p.pathDetailsExpanded)
    }
  }

  return {
    exportRoot,
    prefabRel,
    textureRel,
    fontRel,
    includePrefabs,
    includeTextures,
    includeFonts,
    pathDetailsExpanded,
    exportConstraintsEnabled,
    widgetRootFillScreen,
    textureSubdirByPrimaryGroup,
    exportFigmaAutoLayoutEnabled,
    attachDebugIr,
    fullRootPreview,
    fullPrefabPreview,
    fullTexturePreview,
    fullFontPreview,
    canExportAnything,
    togglePathPanel,
    hydrate,
  }
}
