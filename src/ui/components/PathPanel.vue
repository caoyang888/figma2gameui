<template>
  <div
    class="path-panel"
    :class="{ 'path-panel-open': pathDetailsExpanded }"
  >
    <button type="button" class="path-summary" @click="handleToggle">
      <span class="chevron" aria-hidden="true">{{
        pathDetailsExpanded ? "▼" : "▶"
      }}</span>
      <span class="path-summary-label">{{ t('path.summaryLabel') }}</span>
      <span class="path-summary-root" :title="fullRootPreview">{{
        exportRoot || "…"
      }}</span>
    </button>
    <div v-show="pathDetailsExpanded" class="path-body">
      <p class="field-hint">{{ t('path.rootHint') }}</p>
      <a-input
        :value="exportRoot"
        placeholder="_figma_export"
        spellcheck="false"
        @update:value="emit('update:exportRoot', $event)"
      />

      <label class="field-label">{{ t('path.prefabLabel') }}</label>
      <div class="path-inline-row">
        <a-checkbox
          :checked="includePrefabs"
          class="path-inline-cb"
          @update:checked="emit('update:includePrefabs', $event)"
          >{{ t('path.exportPrefabs') }}</a-checkbox
        >
        <a-input
          :value="prefabRel"
          placeholder="prefabs"
          spellcheck="false"
          @update:value="emit('update:prefabRel', $event)"
        />
      </div>
      <p class="field-preview" :title="fullPrefabPreview">
        {{ t('path.previewColon') }}{{ fullPrefabPreview }}
      </p>

      <label class="field-label">{{ t('path.textureLabel') }}</label>
      <div class="path-inline-row">
        <a-checkbox
          :checked="includeTextures"
          class="path-inline-cb"
          @update:checked="emit('update:includeTextures', $event)"
          >{{ t('path.exportTextures') }}</a-checkbox
        >
        <a-input
          :value="textureRel"
          placeholder="textures"
          spellcheck="false"
          @update:value="emit('update:textureRel', $event)"
        />
      </div>
      <p class="field-preview" :title="fullTexturePreview">
        {{ t('path.previewColon') }}{{ fullTexturePreview }}
      </p>

      <label class="field-label">{{ t('path.fontLabel') }}</label>
      <div class="path-inline-row">
        <a-checkbox
          :checked="includeFonts"
          class="path-inline-cb"
          @update:checked="emit('update:includeFonts', $event)"
          >{{ t('path.exportFonts') }}</a-checkbox
        >
        <a-input
          :value="fontRel"
          placeholder="fonts"
          spellcheck="false"
          @update:value="emit('update:fontRel', $event)"
        />
      </div>
      <p class="field-preview" :title="fullFontPreview">
        {{ t('path.previewColon') }}{{ fullFontPreview }}
      </p>

      <label class="field-label field-label-atlas">{{
        t('path.atlasSectionLabel')
      }}</label>
      <p v-if="!atlasPackingAuthorized" class="field-hint atlas-gated-hint">
        {{ t('path.atlasUnauthorizedHint') }}
      </p>
      <div class="atlas-pack-panel">
        <div class="atlas-pack-block">
          <a-checkbox
            :checked="atlasPackingRequested"
            class="atlas-pack-cb"
            :disabled="!atlasPackingAuthorized || exporting"
            @update:checked="emit('update:atlasPackingRequested', $event)"
            >{{ t('path.atlasPackCheckbox') }}</a-checkbox
          >
          <div
            class="atlas-sliders-wrap"
            :class="{ 'atlas-sliders-wrap--muted': atlasPackSlidersDisabled }"
          >
            <div class="atlas-slider-field">
              <a-slider
                :value="atlasMaxSidePotIndex"
                class="atlas-slider-control"
                :min="0"
                :max="atlasPotIndexMax"
                :step="1"
                :marks="atlasPotMarks"
                :disabled="atlasPackSlidersDisabled"
                :tooltip="{ formatter: atlasPotTooltip }"
                @update:value="emit('update:atlasMaxSidePotIndex', $event)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { I18N_INJECT_KEY } from '../i18n/injectionKey'

const i18n = inject(I18N_INJECT_KEY)!
const { t } = i18n

const props = defineProps<{
  exportRoot: string
  prefabRel: string
  textureRel: string
  fontRel: string
  includePrefabs: boolean
  includeTextures: boolean
  includeFonts: boolean
  pathDetailsExpanded: boolean
  fullRootPreview: string
  fullPrefabPreview: string
  fullTexturePreview: string
  fullFontPreview: string
  atlasPackingRequested: boolean
  atlasMaxSidePotIndex: number
  atlasPackingAuthorized: boolean
  atlasPotMarks: Record<number, string>
  atlasPotTooltip: (val?: number) => string
  atlasPotIndexMax: number
  atlasPackSlidersDisabled: boolean
  exporting: boolean
}>()

const emit = defineEmits<{
  (e: 'update:exportRoot', val: string): void
  (e: 'update:prefabRel', val: string): void
  (e: 'update:textureRel', val: string): void
  (e: 'update:fontRel', val: string): void
  (e: 'update:includePrefabs', val: boolean): void
  (e: 'update:includeTextures', val: boolean): void
  (e: 'update:includeFonts', val: boolean): void
  (e: 'update:pathDetailsExpanded', val: boolean): void
  (e: 'update:atlasPackingRequested', val: boolean): void
  (e: 'update:atlasMaxSidePotIndex', val: number): void
}>()

function handleToggle(): void {
  emit('update:pathDetailsExpanded', !props.pathDetailsExpanded)
}
</script>

<style scoped>
.path-panel {
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 0 10px 10px;
  margin-bottom: 12px;
  background: #fafafa;
}
.path-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 0;
  margin: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
  font-weight: 600;
  color: inherit;
}
.path-summary:focus-visible {
  outline: 2px solid #1677ff;
  outline-offset: 2px;
  border-radius: 4px;
}
.chevron {
  flex-shrink: 0;
  width: 1.1em;
  text-align: center;
  font-size: 10px;
  color: rgba(0, 0, 0, 0.55);
  user-select: none;
}
.path-summary-label {
  flex-shrink: 0;
}
.path-summary-root {
  flex: 1;
  min-width: 0;
  font-weight: 400;
  color: #1677ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.path-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.field-label {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
  margin-top: 4px;
}
.path-inline-row {
  margin-top: 2px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.path-inline-cb {
  white-space: nowrap;
}
.field-label-atlas {
  display: block;
  margin-top: 10px;
  margin-bottom: 6px;
}
.atlas-gated-hint {
  color: rgba(250, 140, 22, 0.95);
  margin-bottom: 8px;
  line-height: 1.45;
  white-space: pre-line;
}
.atlas-pack-panel {
  margin-top: 4px;
  padding: 16px 16px 14px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.02);
  max-width: 560px;
}
.atlas-pack-block {
  display: flex;
  flex-direction: column;
}
.atlas-pack-cb {
  align-self: flex-start;
  padding: 2px 0;
}
.atlas-sliders-wrap {
  display: flex;
  flex-direction: column;
  padding: 10px;
}
.atlas-sliders-wrap--muted {
  opacity: 0.55;
  transition: opacity 0.15s ease;
}
.atlas-slider-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 100%;
}
.atlas-slider-control {
  width: 100%;
  margin: 6px 0 0;
}
.field-preview {
  margin: -4px 0 0;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
  word-break: break-all;
  line-height: 1.35;
}
</style>
