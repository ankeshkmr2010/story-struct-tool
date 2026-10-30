import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluralForm } from './pluralRules.ts'

const expected: Record<string, [number, 'one' | 'other'][]> = {
  en: [[0, 'other'], [1, 'one'], [2, 'other'], [21, 'other']],
  de: [[0, 'other'], [1, 'one'], [5, 'other']],
  es: [[0, 'other'], [1, 'one'], [5, 'other']],
  it: [[0, 'other'], [1, 'one'], [5, 'other']],
  fr: [[0, 'one'], [1, 'one'], [2, 'other']],
  'pt-BR': [[0, 'one'], [1, 'one'], [2, 'other']],
}

for (const [language, cases] of Object.entries(expected)) {
  test(`${language}: counts at 0, 1 and many pick the right form`, () => {
    for (const [count, form] of cases) assert.equal(pluralForm(language, count), form, `${language} ${count}`)
  })
}
