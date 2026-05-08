<!-- src/ui/components/ReportPanel.vue -->
<template>
  <section class="block report-block">
    <h2 class="block-title">{{ t('report.title') }}</h2>
    <ul v-if="entries.length > 0" class="report-list">
      <li
        v-for="(item, idx) in entries"
        :key="idx"
        :class="{ 'report-error': item.level === 'error' }"
        :title="item.nodeId || undefined"
      >
        {{ item.message }}
      </li>
    </ul>
    <p v-else class="report-empty">{{ t('report.empty') }}</p>
  </section>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { ReportEntry } from '../../shared/types'
import { I18N_INJECT_KEY } from '../i18n/injectionKey'

const i18n = inject(I18N_INJECT_KEY)!
const { t } = i18n

defineProps<{ entries: ReportEntry[] }>()
</script>

<style scoped>
.report-block { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.report-list {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #fafafa;
}
.report-list li {
  padding: 10px 12px;
  border-bottom: 1px solid #e8e8e8;
  font-size: 13px;
  line-height: 1.5;
  color: #1a1a1a;
  word-break: break-word;
}
.report-list li:last-child {
  border-bottom: none;
}
.report-error {
  color: #cf1322;
  background: #fff2f0;
}
.report-empty {
  margin: 10px 0 0;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
  line-height: 1.45;
}
</style>
