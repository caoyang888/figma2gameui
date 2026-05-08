import type { EffectiveUiLang, LocalePreference } from './constants'

export function resolveEffectiveLang(
  preference: LocalePreference | null | undefined,
  navigatorLanguages: readonly string[],
): EffectiveUiLang {
  const pref = preference ?? 'auto'
  if (pref === 'en' || pref === 'zh-Hans' || pref === 'zh-Hant') {
    return pref
  }

  for (const tag of navigatorLanguages) {
    const tagLower = tag.trim().toLowerCase()
    if (tagLower === 'zh') {
      return 'zh-Hans'
    }
    if (
      tagLower.startsWith('zh-tw') ||
      tagLower.startsWith('zh-hk') ||
      tagLower.startsWith('zh-mo')
    ) {
      return 'zh-Hant'
    }
    if (tagLower.includes('-hant')) {
      return 'zh-Hant'
    }
    if (tagLower.startsWith('zh-cn') || tagLower.startsWith('zh-sg')) {
      return 'zh-Hans'
    }
    if (tagLower.includes('-hans')) {
      return 'zh-Hans'
    }
    if (tagLower.startsWith('zh-')) {
      return 'zh-Hans'
    }
  }

  return 'en'
}
