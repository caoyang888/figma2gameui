import { describe, it, expect } from 'vitest'
import { resolveEffectiveLang } from '../../src/ui/i18n/resolveEffectiveLang'

describe('resolveEffectiveLang', () => {
  it('respects explicit preference', () => {
    expect(resolveEffectiveLang('zh-Hant', ['en-US'])).toBe('zh-Hant')
  })
  it('zh-TW → Hant', () => {
    expect(resolveEffectiveLang('auto', ['zh-TW'])).toBe('zh-Hant')
  })
  it('zh-Hant script → Hant', () => {
    expect(resolveEffectiveLang('auto', ['zh-Hant-HK'])).toBe('zh-Hant')
  })
  it('zh-CN → Hans', () => {
    expect(resolveEffectiveLang('auto', ['zh-CN'])).toBe('zh-Hans')
  })
  it('bare zh → Hans', () => {
    expect(resolveEffectiveLang('auto', ['zh'])).toBe('zh-Hans')
  })
  it('other zh → Hans', () => {
    expect(resolveEffectiveLang('auto', ['zh-FOO'])).toBe('zh-Hans')
  })
  it('non-zh uses next tag', () => {
    expect(resolveEffectiveLang('auto', ['ja-JP', 'zh-TW'])).toBe('zh-Hant')
  })
  it('empty → en', () => {
    expect(resolveEffectiveLang('auto', [])).toBe('en')
  })
})
