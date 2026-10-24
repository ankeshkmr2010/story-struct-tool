/** Writing languages a story or account can use; the spelling check follows the story's. */
export const LANGUAGES = [
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'es', label: 'Spanish' },
  { id: 'pt-PT', label: 'Portuguese (Portugal)' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)' },
  { id: 'it', label: 'Italian' },
] as const

export type LanguageId = (typeof LANGUAGES)[number]['id']

/** Lower case without accents, one character for one ("José" → "jose"), so offsets in the
 * folded text are offsets in the original. Search ignores accents the same way. */
export const foldAccents = (text: string) => Array.from(text, ch => {
  const lower = ch.toLocaleLowerCase()
  const plain = lower.normalize('NFD').replace(/\p{M}/gu, '')
  return plain.length === 1 ? plain : lower.length === ch.length ? lower : ch
}).join('')

export const languageLabel =(id: string | null | undefined) => LANGUAGES.find(language => language.id === id)?.label ?? 'English (US)'
