/** 与主线程 `figma.clientStorage` 使用同一键名 */
export const LOCALE_STORAGE_KEY = 'figma2gameui.uiLocale' as const

/** 持久化允许的值（经主线程白名单校验） */
export type LocalePreference = 'auto' | 'en' | 'zh-Hans' | 'zh-Hant'

/** 实际用于查表的语言 */
export type EffectiveUiLang = 'en' | 'zh-Hans' | 'zh-Hant'
