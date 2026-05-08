<template>
  <div class="lang-switcher">
    <span class="lang-label">{{ i18n.t('lang.label') }}</span>
    <a-select
      :value="preference"
      class="lang-select"
      :options="localeOptions"
      @change="onPreferenceChange"
    />
  </div>
</template>

<script setup lang="ts">
import { inject, computed } from 'vue'
import { I18N_INJECT_KEY } from '../i18n/injectionKey'
import type { LocalePreference } from '../i18n/constants'

const i18n = inject(I18N_INJECT_KEY)!

const preference = i18n.preference

const localeOptions = computed(() => {
  const t = i18n.t
  return [
    { value: 'auto' as const, label: t('lang.option.auto') },
    { value: 'en' as const, label: t('lang.option.en') },
    { value: 'zh-Hans' as const, label: t('lang.option.zhHans') },
    { value: 'zh-Hant' as const, label: t('lang.option.zhHant') },
  ] satisfies { value: LocalePreference; label: string }[]
})

function onPreferenceChange(v: string | number): void {
  const s = String(v)
  if (s === 'auto' || s === 'en' || s === 'zh-Hans' || s === 'zh-Hant') {
    i18n.setPreference(s)
  }
}
</script>

<style scoped>
.lang-switcher {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.lang-label {
  flex-shrink: 0;
}
.lang-select {
  flex: 1;
  min-width: 0;
  width: 100%;
}
</style>
