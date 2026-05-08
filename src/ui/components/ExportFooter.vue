<!-- src/ui/components/ExportFooter.vue -->
<template>
  <footer class="footer">
    <div v-show="exporting" class="progress-wrap">
      <div class="progress-head">
        <span class="progress-label">{{ progressLabel }}</span>
        <span class="progress-pct">{{ progressPercentText }}</span>
      </div>
      <progress class="export-progress" :value="progressRatio * 100" max="100" />
    </div>
    <div class="export-row">
      <a-button
        type="primary"
        class="export-btn"
        size="large"
        :disabled="!canClickExport"
        @click="$emit('export')"
      >
        {{ t('export.footer.zip') }}
      </a-button>
      <a-select
        :value="selectedEngineKey"
        class="engine-select"
        size="large"
        :disabled="exporting"
        :options="engineSelectOptions"
        @change="(v: string) => $emit('update:selectedEngineKey', v)"
      />
    </div>
  </footer>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { I18N_INJECT_KEY } from '../i18n/injectionKey'

const i18n = inject(I18N_INJECT_KEY)!
const { t } = i18n

defineProps<{
  exporting: boolean
  canClickExport: boolean
  progressLabel: string
  progressRatio: number
  progressPercentText: string
  selectedEngineKey: string
  engineSelectOptions: { value: string; label: string; disabled: boolean }[]
}>()
defineEmits<{
  export: []
  'update:selectedEngineKey': [key: string]
}>()
</script>

<style scoped>
.footer {
  flex-shrink: 0; margin-top: 10px; padding-top: 10px;
  border-top: 1px solid #f0f0f0;
}
.progress-wrap { margin-bottom: 10px; }
.progress-head {
  display: flex; justify-content: space-between;
  align-items: baseline; gap: 8px; margin-bottom: 4px;
}
.progress-label {
  font-size: 12px; color: rgba(0,0,0,.65); flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.progress-pct { font-size: 11px; color: rgba(0,0,0,.45); flex-shrink: 0; }
.export-progress { width: 100%; height: 10px; border-radius: 6px; overflow: hidden; }
.export-btn { font-weight: 600; }
.export-row { display: flex; align-items: stretch; gap: 8px; }
.export-row .export-btn { flex: 1; }
.engine-select { width: 190px; flex-shrink: 0; }
</style>
