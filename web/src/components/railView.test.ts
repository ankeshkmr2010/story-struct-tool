import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ladderLevels, railChoice, startTab } from './railView.ts'

const fresh = '2026-10-31T04:00:00Z'
const older = '2026-10-16T05:51:45Z'

test('a new Just write story opens in Write on the collapsed ladder, even before its library card loads', () => {
  const choice = railChoice(undefined, fresh)
  assert.deepEqual(choice, { showAll: false, fullLadder: false })
  assert.deepEqual(ladderLevels(choice.fullLadder), [1, 4, 8])
  assert.equal(startTab('pantser'), 'write')
})

test('the card decides once it exists; older stories and the sandbox show everything', () => {
  assert.deepEqual(railChoice({ show_all_tools: false, full_ladder: true }, fresh), { showAll: false, fullLadder: true })
  assert.deepEqual(railChoice({ show_all_tools: true, full_ladder: false }, fresh), { showAll: true, fullLadder: true })
  assert.deepEqual(railChoice(undefined, older), { showAll: true, fullLadder: true })
  assert.deepEqual(railChoice(undefined, fresh, true), { showAll: true, fullLadder: true })
  assert.equal(ladderLevels(true), undefined)
})

test('outlines and plans start in Design; a saved place always wins', () => {
  assert.equal(startTab('hybrid'), 'design')
  assert.equal(startTab('plotter'), 'design')
  assert.equal(startTab('pantser', 'read'), 'read')
})
