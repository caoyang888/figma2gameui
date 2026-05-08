<!-- src/ui/components/ValidationPanel.vue -->
<template>
  <section class="block validation-block">
    <h2 class="block-title">{{ t('validation.heading') }}</h2>
    <div
      class="validation-banner"
      :class="{
        'validation-ok': ok === true,
        'validation-bad': ok === false,
        'validation-idle': ok === null,
      }"
    >
      <div class="validation-title">{{ title }}</div>
      <div v-if="detail" class="validation-detail">{{ detail }}</div>
    </div>
    <p class="conn-line">{{ connectionLine }}</p>
  </section>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { I18N_INJECT_KEY } from '../i18n/injectionKey'

const i18n = inject(I18N_INJECT_KEY)!
const { t } = i18n

defineProps<{
  ok: boolean | null
  title: string
  detail: string
  connectionLine: string
}>()
</script>

<style scoped>
.validation-block { flex-shrink: 0; }
.validation-banner {
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  background: #fafafa;
}
.validation-idle { border-color: #d9d9d9; }
.validation-ok { border-color: #b7eb8f; background: #f6ffed; }
.validation-bad { border-color: #ffccc7; background: #fff2f0; }
.validation-title { font-weight: 600; font-size: 13px; }
.validation-detail { margin-top: 6px; font-size: 12px; color: rgba(0,0,0,.65); line-height: 1.4; }
.conn-line { margin: 8px 0 0; font-size: 11px; color: rgba(0,0,0,.45); }
</style>
