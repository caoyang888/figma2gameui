// src/ui/composables/useSettingsPersistence.ts
import { ref, watch, type Ref } from 'vue'
import {
  potOptionIndexToMaxSide,
  clampAtlasLargeSpriteAreaRatio,
} from '../../shared/atlasPackSettings'
import type { usePathSettings } from './usePathSettings'
import type { useFontManager } from './useFontManager'
import type { useAtlasSettings } from './useAtlasSettings'
import type { useEngineSelector } from './useEngineSelector'

interface Deps {
  pathSettings: ReturnType<typeof usePathSettings>
  fontManager: ReturnType<typeof useFontManager>
  atlasSettings: ReturnType<typeof useAtlasSettings>
  engineSelector: ReturnType<typeof useEngineSelector>
  devUiVisible: Ref<boolean>
  selectedFrameIds: Ref<string[]>
  sendToMain: (payload: unknown) => void
}

export function useSettingsPersistence(deps: Deps) {
  const { pathSettings, fontManager, atlasSettings, engineSelector,
          devUiVisible, selectedFrameIds, sendToMain } = deps

  const suppressSave = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function buildSaveSettingsPayload() {
    return {
      exportRoot: pathSettings.exportRoot.value,
      prefabRel: pathSettings.prefabRel.value,
      textureRel: pathSettings.textureRel.value,
      fontRel: pathSettings.fontRel.value,
      fontMap: { ...fontManager.fontMapState.value },
      fontUuidMap: { ...fontManager.fontUuidMapState.value },
      attachDebugIr: pathSettings.attachDebugIr.value,
      pathDetailsExpanded: pathSettings.pathDetailsExpanded.value,
      devUiVisible: devUiVisible.value,
      selectedFrameIds: [...selectedFrameIds.value],
      includePrefabs: pathSettings.includePrefabs.value,
      includeTextures: pathSettings.includeTextures.value,
      includeFonts: pathSettings.includeFonts.value,
      exportConstraintsEnabled: pathSettings.exportConstraintsEnabled.value,
      widgetRootFillScreen: pathSettings.widgetRootFillScreen.value,
      textureSubdirByPrimaryGroup: pathSettings.textureSubdirByPrimaryGroup.value,
      exportFigmaAutoLayoutEnabled: pathSettings.exportFigmaAutoLayoutEnabled.value,
      engineId: engineSelector.engineId.value,
      engineVersion: engineSelector.engineVersion.value,
      atlasPackingRequested: atlasSettings.atlasPackingRequested.value,
      atlasPackingDevUnlock: atlasSettings.atlasPackingDevUnlock.value,
      atlasMaxSide: potOptionIndexToMaxSide(atlasSettings.atlasMaxSidePotIndex.value),
      atlasLargeSpriteAreaRatio: clampAtlasLargeSpriteAreaRatio(
        atlasSettings.atlasLargeSpriteAreaRatio.value
      ),
    }
  }

  function scheduleSave(): void {
    if (suppressSave.value) return
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      sendToMain({ type: 'SAVE_SETTINGS', payload: buildSaveSettingsPayload() })
    }, 450)
  }

  function flushSaveAndDryRun(): void {
    if (suppressSave.value) return
    sendToMain({ type: 'SAVE_SETTINGS', payload: buildSaveSettingsPayload() })
    sendToMain({ type: 'EXPORT_DRY_RUN' })
  }

  // 路径域
  watch(
    [
      pathSettings.exportRoot, pathSettings.prefabRel, pathSettings.textureRel,
      pathSettings.fontRel, pathSettings.includePrefabs, pathSettings.includeTextures,
      pathSettings.pathDetailsExpanded,
      pathSettings.exportConstraintsEnabled, pathSettings.widgetRootFillScreen,
      pathSettings.textureSubdirByPrimaryGroup,
      pathSettings.exportFigmaAutoLayoutEnabled, pathSettings.attachDebugIr,
    ],
    scheduleSave
  )

  // 图集域
  watch(
    [
      atlasSettings.atlasPackingRequested, atlasSettings.atlasPackingDevUnlock,
      atlasSettings.atlasMaxSidePotIndex, atlasSettings.atlasLargeSpriteAreaRatio,
    ],
    scheduleSave
  )

  // 引擎域
  watch([engineSelector.engineId, engineSelector.engineVersion], scheduleSave)

  // 字体 keys
  watch(fontManager.fontKeys, scheduleSave)

  // 字体 map / uuid 深度监听（对象条目通常 2-5 个，deep watch 开销可接受）
  watch(fontManager.fontMapState, scheduleSave, { deep: true })
  watch(fontManager.fontUuidMapState, scheduleSave, { deep: true })

  // UI 状态
  watch([devUiVisible, selectedFrameIds], scheduleSave)

  // includeFonts 变更需立即触发校验
  watch(pathSettings.includeFonts, () => {
    flushSaveAndDryRun()
  })

  return { suppressSave, scheduleSave, flushSaveAndDryRun }
}
