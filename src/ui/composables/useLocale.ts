import { ref, computed } from 'vue'
import type { LocalePreference, EffectiveUiLang } from '../i18n/constants'
import { resolveEffectiveLang } from '../i18n/resolveEffectiveLang'
import { pickMessages } from '../locales/index'
import type { MessageKey } from '../locales/en'
import enUS from 'ant-design-vue/es/locale/en_US'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import zhTW from 'ant-design-vue/es/locale/zh_TW'

export interface UseLocaleDeps {
  sendToMain: (payload: unknown) => void
}

export function useLocale(deps: UseLocaleDeps) {
  const { sendToMain } = deps
  /** 首帧为 auto，待主线程 `UI_LOCALE_STATE` 水合。 */
  const preference = ref<LocalePreference>('auto')

  const effectiveLang = computed<EffectiveUiLang>(() =>
    resolveEffectiveLang(
      preference.value,
      typeof navigator !== 'undefined' && Array.isArray(navigator.languages)
        ? navigator.languages
        : typeof navigator !== 'undefined' && navigator.language
          ? [navigator.language]
          : [],
    ),
  )

  function hydratePreferenceFromMain(v: LocalePreference): void {
    preference.value = v
  }

  function setPreference(v: LocalePreference): void {
    preference.value = v
    sendToMain({ type: 'UI_LOCALE_SAVE', payload: { preference: v } })
  }

  function t(key: MessageKey, vars?: Record<string, string | number>): string {
    let str = pickMessages(effectiveLang.value)[key]
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        const needle = `{${name}}`
        str = str.split(needle).join(String(value))
      }
    }
    return str
  }

  const antdLocale = computed(() => {
    switch (effectiveLang.value) {
      case 'zh-Hans':
        return zhCN
      case 'zh-Hant':
        return zhTW
      default:
        return enUS
    }
  })

  return {
    preference,
    effectiveLang,
    hydratePreferenceFromMain,
    setPreference,
    t,
    antdLocale,
  }
}
