import { t, tx } from '../i18n'

/** Writing languages a story or account can use; the spelling check follows the story's. */
export const LANGUAGES = [
  { id: 'en-US', label: tx('English (US)') },
  { id: 'en-GB', label: tx('English (UK)') },
  { id: 'fr', label: tx('French') },
  { id: 'de', label: tx('German') },
  { id: 'es', label: tx('Spanish') },
  { id: 'pt-PT', label: tx('Portuguese (Portugal)') },
  { id: 'pt-BR', label: tx('Portuguese (Brazil)') },
  { id: 'it', label: tx('Italian') },
] as const

export type LanguageId = (typeof LANGUAGES)[number]['id']

/** Lower case without accents, one character for one ("José" → "jose"), so offsets in the
 * folded text are offsets in the original. Search ignores accents the same way. */
export const foldAccents = (text: string) => Array.from(text, ch => {
  const lower = ch.toLocaleLowerCase()
  const plain = lower.normalize('NFD').replace(/\p{M}/gu, '')
  return plain.length === 1 ? plain : lower.length === ch.length ? lower : ch
}).join('')

export const languageLabel = (id: string | null | undefined) => t(LANGUAGES.find(language => language.id === id)?.label ?? 'English (US)')
