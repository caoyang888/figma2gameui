<template>
  <a-config-provider :locale="i18n.antdLocale">
    <div class="plugin-root">
    <div class="upper">
      <aside class="upper-nav">
        <FrameTreePanel v-model="selectedFrameIds" :roots="frameTreeRoots" />
      </aside>

      <div class="upper-center">
        <PathPanel
          v-model:export-root="exportRoot"
          v-model:prefab-rel="prefabRel"
          v-model:texture-rel="textureRel"
          v-model:font-rel="fontRel"
          v-model:include-prefabs="includePrefabs"
          v-model:include-textures="includeTextures"
          v-model:include-fonts="includeFonts"
          v-model:path-details-expanded="pathDetailsExpanded"
          v-model:atlas-packing-requested="atlasPackingRequested"
          v-model:atlas-max-side-pot-index="atlasMaxSidePotIndex"
          :full-root-preview="fullRootPreview"
          :full-prefab-preview="fullPrefabPreview"
          :full-texture-preview="fullTexturePreview"
          :full-font-preview="fullFontPreview"
          :atlas-packing-authorized="atlasPackingAuthorized"
          :atlas-pot-marks="atlasPotMarks"
          :atlas-pot-tooltip="atlasPotTooltip"
          :atlas-pot-index-max="atlasPotIndexMax"
          :atlas-pack-sliders-disabled="atlasPackSlidersDisabled"
          :exporting="exporting"
        />

        <LayoutOptionsPanel
          v-model:export-constraints-enabled="exportConstraintsEnabled"
          v-model:widget-root-fill-screen="widgetRootFillScreen"
          v-model:texture-subdir-by-primary-group="textureSubdirByPrimaryGroup"
        />

        <FontPanel
          :font-keys="fontKeys"
          :font-map-state="fontMapState"
          :font-uuid-map="fontUuidMapState"
          :exporting="exporting"
          @font-file-change="handleFontFileInput"
          @font-drop="handleFontDrop"
          @font-uuid-change="handleFontUuidChange"
        />

        <DevPanel
          v-show="devUiVisible"
          v-model:attach-debug-ir="attachDebugIr"
          v-model:atlas-packing-dev-unlock="atlasPackingDevUnlock"
        />
      </div>

      <div class="upper-right">
        <div class="lang-switcher-row">
          <LanguageSwitcher />
        </div>
        <ValidationPanel
          :ok="validationBanner.ok"
          :title="validationBanner.title"
          :detail="validationBanner.detail"
          :connection-line="connectionLine"
        />

        <ReportPanel :entries="sortedReport" />
      </div>
    </div>

    <ExportFooter
      :exporting="exporting"
      :can-click-export="canClickExport"
      :progress-label="progressLabel"
      :progress-ratio="progressRatio"
      :progress-percent-text="progressPercentText"
      :selected-engine-key="selectedEngineKey"
      :engine-select-options="engineSelectOptions"
      @export="requestExport"
      @update:selected-engine-key="selectedEngineKey = $event"
    />
    </div>
  </a-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, provide } from 'vue'
import type { FrameTreeNodeWire } from '../types/frameTree'
import FrameTreePanel from './FrameTreePanel.vue'
import LanguageSwitcher from './components/LanguageSwitcher.vue'
import ValidationPanel from './components/ValidationPanel.vue'
import ReportPanel from './components/ReportPanel.vue'
import ExportFooter from './components/ExportFooter.vue'
import DevPanel from './components/DevPanel.vue'
import FontPanel from './components/FontPanel.vue'
import LayoutOptionsPanel from './components/LayoutOptionsPanel.vue'
import PathPanel from './components/PathPanel.vue'
import { usePathSettings } from './composables/usePathSettings'
import { useFontManager } from './composables/useFontManager'
import { useAtlasSettings, ATLAS_POT_INDEX_MAX } from './composables/useAtlasSettings'
import { useEngineSelector } from './composables/useEngineSelector'
import { useExportOrchestrator } from './composables/useExportOrchestrator'
import { useExportFrameSync } from './composables/useExportFrameSync'
import { useSettingsPersistence } from './composables/useSettingsPersistence'
import { useMessaging } from './composables/useMessaging'
import { useLocale } from './composables/useLocale'
import { I18N_INJECT_KEY } from './i18n/injectionKey'

// 组件级状态（跨多个 composable 共享，定义于此避免循环依赖）
const frameTreeRoots = ref<FrameTreeNodeWire[]>([])
const selectedFrameIds = ref<string[]>([])
const devUiVisible = ref(false)

function sendToMain(payload: unknown): void {
  parent.postMessage({ pluginMessage: payload }, '*')
}

const i18n = useLocale({ sendToMain })
provide(I18N_INJECT_KEY, i18n)

const pathSettings = usePathSettings()
const fontManager = useFontManager()
const atlasSettings = useAtlasSettings()
const engineSelector = useEngineSelector()

const frameSync = useExportFrameSync({ selectedFrameIds, sendToMain })

const exportOrch = useExportOrchestrator({
  pathSettings,
  fontManager,
  engineSelector,
  selectedFrameIds,
  flushExportFrameIdsSync: frameSync.flushExportFrameIdsSync,
  sendToMain,
  i18n,
})

const persistence = useSettingsPersistence({
  pathSettings,
  fontManager,
  atlasSettings,
  engineSelector,
  devUiVisible,
  selectedFrameIds,
  sendToMain,
})

const { connectionLine } = useMessaging({
  pathSettings,
  fontManager,
  atlasSettings,
  engineSelector,
  exportOrch,
  persistence,
  frameSync,
  frameTreeRoots,
  selectedFrameIds,
  devUiVisible,
  sendToMain,
  i18n,
})

const {
  exportRoot, prefabRel, textureRel, fontRel,
  includePrefabs, includeTextures, includeFonts,
  pathDetailsExpanded, exportConstraintsEnabled, widgetRootFillScreen,
  textureSubdirByPrimaryGroup,
  attachDebugIr,
  fullRootPreview, fullPrefabPreview, fullTexturePreview, fullFontPreview,
} = pathSettings

const { fontKeys, fontMapState, fontUuidMapState,
        onFontFileInput, onFontDrop } = fontManager

const {
  atlasPackingRequested, atlasPackingDevUnlock, atlasMaxSidePotIndex,
  atlasPackingAuthorized, atlasPotMarks, atlasPotTooltip,
} = atlasSettings
const atlasPotIndexMax = ATLAS_POT_INDEX_MAX

const { selectedEngineKey, engineSelectOptions } = engineSelector

const {
  exporting, progressLabel, progressRatio, progressPercentText,
  sortedReport, validationBanner, canClickExport,
} = exportOrch

const atlasPackSlidersDisabled = computed(
  () => exporting.value || !atlasPackingAuthorized.value || !atlasPackingRequested.value
)

const { flushSaveAndDryRun } = persistence

function handleFontFileInput(key: string, ev: Event): void {
  if (exporting.value) return
  onFontFileInput(key, ev, flushSaveAndDryRun)
}
function handleFontDrop(key: string, ev: DragEvent): void {
  if (exporting.value) return
  onFontDrop(key, ev, flushSaveAndDryRun)
}
function handleFontUuidChange(key: string, val: string): void {
  fontUuidMapState.value[key] = val
  flushSaveAndDryRun()
}

function requestExport(): void {
  void exportOrch.requestExport()
}

</script>

<style scoped>
.plugin-root {
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 12px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.88);
  min-height: 0;
}
.upper {
  flex: 1;
  display: flex;
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}
.upper-nav {
  flex: 0 0 260px;
  min-width: 200px;
  max-width: 34%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.upper-center {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 0 4px;
}
.upper-right {
  flex: 0 0 300px;
  min-width: 240px;
  max-width: 38%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}
.lang-switcher-row {
  margin-bottom: 4px;
  flex-shrink: 0;
}
</style>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

.block {
  margin-bottom: 12px;
}

.block-title {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}
</style>
