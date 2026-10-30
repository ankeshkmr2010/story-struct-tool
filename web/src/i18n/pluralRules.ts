/** Which form a count takes in a language: 'one' or 'other'. French and Portuguese (Brazil)
 * treat 0 as singular ("0 scène"); English, German, Spanish and Italian do not.
 * Pure on purpose, so `npm test` can check it without the app around it. */
export function pluralForm(language: string, count: number): 'one' | 'other' {
  return new Intl.PluralRules(language).select(count) === 'one' ? 'one' : 'other'
}
