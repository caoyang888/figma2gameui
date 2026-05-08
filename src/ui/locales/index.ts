import type { EffectiveUiLang } from '../i18n/constants'
import { messagesEn, type MessageKey } from './en'
import { messagesZhHans } from './zh-Hans'
import { messagesZhHant } from './zh-Hant'

export type { MessageKey } from './en'

export function pickMessages(lang: EffectiveUiLang): Record<MessageKey, string> {
  switch (lang) {
    case 'en':
      return { ...messagesEn }
    case 'zh-Hans':
      return { ...messagesZhHans }
    case 'zh-Hant':
      return { ...messagesZhHant }
  }
}
