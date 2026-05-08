<template>
  <section class="block muted-block">
    <h2 class="block-title">{{ t('dev.title') }}</h2>
    <p class="field-hint">{{ t('dev.toggleHint') }}</p>
    <div class="row-inline">
      <a-checkbox
        :checked="attachDebugIr"
        @update:checked="$emit('update:attachDebugIr', $event)"
        >{{ t('dev.attachDebugIr') }}</a-checkbox
      >
    </div>
    <div class="row-inline dev-atlas-unlock-row">
      <a-checkbox
        :checked="atlasPackingDevUnlock"
        @update:checked="$emit('update:atlasPackingDevUnlock', $event)"
        >{{ t('dev.atlasUnlock') }}</a-checkbox
      >
    </div>
  </section>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { I18N_INJECT_KEY } from '../i18n/injectionKey'

const i18n = inject(I18N_INJECT_KEY)!
const { t } = i18n

defineProps<{
  attachDebugIr: boolean
  atlasPackingDevUnlock: boolean
}>()

defineEmits<{
  'update:attachDebugIr': [value: boolean]
  'update:atlasPackingDevUnlock': [value: boolean]
}>()
</script>

<style scoped>
.muted-block {
  opacity: 0.95;
}
.field-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.row-inline {
  margin-top: 6px;
}
.dev-atlas-unlock-row {
  margin-top: 8px;
}
</style>
