import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// One name per idea (usability phase 1). Interface text must use the word on the right;
// craft terms themselves (Value shift, Misbelief…) stay as subtitles next to plain labels.
const RETIRED: [RegExp, string][] = [
  [/\bEvaluate\b/, 'Check my story (or Craft checks for that section)'],
  [/\bInsights\b/, 'Needs attention'],
  [/\bplot points?\b/i, 'story moment (craft term: beat)'],
  [/Continue writing card/, 'Pick up where you left off card'],
  [/\bReview inbox\b/, 'Agent changes'],
]

const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : []
})

test('interface text uses one name per idea', () => {
  const found: string[] = []
  for (const file of files(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    for (const [, text] of readFileSync(file, 'utf8').matchAll(/\b(?:t|tx)\('((?:[^'\\]|\\.)*)'/g)) {
      for (const [word, use] of RETIRED) if (word.test(text)) found.push(`${file}: "${text.slice(0, 60)}" → use ${use}`)
    }
  }
  assert.deepEqual(found, [])
})
