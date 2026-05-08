import type { InjectionKey, Ref, ComputedRef } from 'vue'
import type { LocalePreference, EffectiveUiLang } from './constants'
import type { MessageKey } from '../locales/en'

export type I18nApi = {
  preference: Ref<LocalePreference>
  effectiveLang: ComputedRef<EffectiveUiLang>
  /** 仅应用主线程 `clientStorage` 读到的值，不触发回写。 */
  hydratePreferenceFromMain: (v: LocalePreference) => void
  setPreference: (v: LocalePreference) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  antdLocale: ComputedRef<object>
}

export const I18N_INJECT_KEY: InjectionKey<I18nApi> = Symbol('figma2gameui.i18n')
