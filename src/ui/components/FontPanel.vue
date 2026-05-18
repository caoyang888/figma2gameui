<template>
  <section class="block">
    <h2 class="block-title">{{ t('font.title') }}</h2>
    <p class="field-hint">
      {{ t('font.hint') }}
    </p>
    <div class="font-list">
      <div
        v-for="key in fontKeys"
        :key="key"
        class="font-row"
        @dragover.prevent
        @dragenter.prevent
        @drop.prevent="handleDrop(key, $event)"
      >
        <div class="font-left">
          <input
            :ref="(el) => setInputRef(key, el as HTMLInputElement | null)"
            type="file"
            accept=".ttf"
            class="font-file-hidden"
            @change="$emit('font-file-change', key, $event)"
          />
          <a-button
            size="small"
            class="font-pick-btn"
            :disabled="exporting"
            :title="fontButtonTitle(key)"
            @click="clickPicker(key)"
          >
            {{ fontButtonText(key) }}
          </a-button>
        </div>
        <a-input
          :value="fontUuidMap[key]"
          size="small"
          placeholder="uuid"
          spellcheck="false"
          @update:value="$emit('font-uuid-change', key, $event)"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { I18N_INJECT_KEY } from '../i18n/injectionKey'

const i18n = inject(I18N_INJECT_KEY)!
const { t } = i18n

const props = defineProps<{
  fontKeys: string[]
  fontMapState: Record<string, string>
  fontUuidMap: Record<string, string>
  exporting: boolean
}>()

const emit = defineEmits<{
  'font-file-change': [key: string, event: Event]
  'font-drop': [key: string, event: DragEvent]
  'font-uuid-change': [key: string, value: string]
}>()

const inputRefMap: Record<string, HTMLInputElement | null> = {}

function setInputRef(key: string, el: HTMLInputElement | null): void {
  inputRefMap[key] = el
}

function clickPicker(key: string): void {
  inputRefMap[key]?.click()
}

function fontDisplayName(key: string): string {
  const v = (props.fontMapState[key] || '').trim()
  return v !== '' ? t('font.selectedPrefix', { name: v }) : key
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function fontButtonText(key: string): string {
  return truncateText(fontDisplayName(key), 20)
}

function fontButtonTitle(key: string): string {
  const label = fontDisplayName(key)
  return label === key ? label : `${label} (${key})`
}

function handleDrop(key: string, ev: DragEvent): void {
  emit('font-drop', key, ev)
}
</script>

<style scoped>
.field-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.font-list {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fff;
  max-height: 280px;
  overflow: auto;
}
.font-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 10px;
  align-items: center;
  padding: 10px 10px;
  border-bottom: 1px solid #f0f0f0;
}
.font-row:last-child {
  border-bottom: none;
}
.font-left {
  min-width: 0;
  display: flex;
  align-items: center;
}
.font-file-hidden {
  display: none;
}
.font-pick-btn {
  width: min(100%, 360px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
