<template>
  <section class="block">
    <h2 class="block-title">{{ t('layout.title') }}</h2>
    <div class="layout-export-options">
      <a-checkbox
        :checked="exportConstraintsEnabled"
        @update:checked="emit('update:exportConstraintsEnabled', $event)"
        >{{ t('layout.exportWidgets') }}</a-checkbox
      >
      <a-checkbox
        v-show="exportConstraintsEnabled"
        class="layout-nested-checkbox"
        :checked="widgetRootFillScreen"
        @update:checked="emit('update:widgetRootFillScreen', $event)"
        >{{ t('layout.widgetRootFillScreen') }}</a-checkbox
      >
      <a-checkbox
        :checked="textureSubdirByPrimaryGroup"
        @update:checked="emit('update:textureSubdirByPrimaryGroup', $event)"
        >{{ t('layout.textureSubdir') }}</a-checkbox
      >
      <!-- <a-checkbox
        :checked="exportFigmaAutoLayoutEnabled"
        @update:checked="$emit('update:exportFigmaAutoLayoutEnabled', $event)"
        >导出 Layout 组件</a-checkbox
      > -->
    </div>
  </section>
</template>

<script setup lang="ts">
import { inject, watch } from 'vue'
import { I18N_INJECT_KEY } from '../i18n/injectionKey'

const i18n = inject(I18N_INJECT_KEY)!
const { t } = i18n

const props = defineProps<{
  exportConstraintsEnabled: boolean
  widgetRootFillScreen: boolean
  textureSubdirByPrimaryGroup: boolean
}>()

const emit = defineEmits<{
  'update:exportConstraintsEnabled': [value: boolean]
  'update:widgetRootFillScreen': [value: boolean]
  'update:textureSubdirByPrimaryGroup': [value: boolean]
}>()

watch(
  () => props.exportConstraintsEnabled,
  (on) => {
    if (!on) emit('update:widgetRootFillScreen', false)
  },
)
</script>

<style scoped>
.layout-export-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.layout-nested-checkbox {
  margin-left: 20px;
}
</style>
