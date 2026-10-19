/** Writing languages a story or account can use; the spelling check follows the story's. */
export const LANGUAGES = [
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
] as const

export type LanguageId = (typeof LANGUAGES)[number]['id']

export const languageLabel = (id: string | null | undefined) => LANGUAGES.find(language => language.id === id)?.label ?? 'English (US)'
