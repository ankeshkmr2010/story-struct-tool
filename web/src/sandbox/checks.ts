import { rows, SANDBOX_ID, type Row, type Sandbox } from './storage'

// The sandbox's own versions of two Evaluate checks, run on the story in this browser. They
// return the server's shapes (passages with offsets, actions with edits), so the TKs tab,
// Evaluate and their fix buttons work unchanged. Consistency here checks names against the
// cast only; with an account it also covers US/UK spelling, hyphenation and capitals.

type Passage = { scene_id: string; paragraph: number; find: string; start: number; end: number; excerpt: string }

const byKey = (a: Row, b: Row) => Number(a.sort_key ?? 0) - Number(b.sort_key ?? 0) || Number(a.number ?? 0) - Number(b.number ?? 0) || String(a.id).localeCompare(String(b.id))

function placedScenes(s: Sandbox) {
  const scenes = rows(s, 'scene')
  return [...rows(s, 'chapter')].sort(byKey).flatMap(chapter => scenes.filter(scene => scene.chapter_id === chapter.id).sort(byKey))
}

/** Write's paragraph numbering: blank-line separated, empty blocks skipped, from 1. */
function paragraphs(content: string) {
  const spans: { offset: number; text: string }[] = []
  const breaks = /\n\s*\n/g
  let start = 0
  for (let found = breaks.exec(content); found; found = breaks.exec(content)) { spans.push({ offset: start, text: content.slice(start, found.index) }); start = found.index + found[0].length }
  spans.push({ offset: start, text: content.slice(start) })
  return spans.filter(span => span.text.trim())
}

function excerpt(text: string, start: number, end: number) {
  let left = Math.max(0, start - 40), right = Math.min(text.length, end + 40)
  if (left > 0 && text.slice(left, start).includes(' ')) left = text.indexOf(' ', left) + 1
  if (right < text.length && text.slice(end, right).includes(' ')) right = text.lastIndexOf(' ', right)
  return `${left > 0 ? '…' : ''}${text.slice(left, right).split(/\s+/).join(' ')}${right < text.length ? '…' : ''}`
}

function matches(s: Sandbox, pattern: RegExp) {
  return placedScenes(s).flatMap(scene => paragraphs(String(scene.content ?? '')).flatMap((span, index) =>
    [...span.text.matchAll(pattern)].map(found => ({
      scene,
      text: found[0],
      groups: found,
      passage: { scene_id: String(scene.id), paragraph: index + 1, find: found[0], start: span.offset + found.index!, end: span.offset + found.index! + found[0].length, excerpt: excerpt(span.text, found.index!, found.index! + found[0].length) } satisfies Passage,
    }))))
}

const hasProse = (s: Sandbox) => placedScenes(s).some(scene => String(scene.content ?? '').trim())
const missing = (s: Sandbox) => hasProse(s) ? [] : ['Write prose in a scene that is placed in a chapter']

const EVALUATORS = [
  { id: 'tk_placeholders', name: 'TK placeholders', description: 'Lists every [TK] or [TK: note] left in the prose, so nothing unfinished reaches an export.' },
  { id: 'consistency', name: 'Smart consistency', description: 'Finds misspelt names (Maia for Maya) and offers to fix them everywhere at once. In this sample it checks names against the cast; with a free account it also checks US/UK spelling, hyphenation and capitals.' },
]

function tk(s: Sandbox) {
  const found = matches(s, /\[tk(?:[ \t]*:[ \t]*([^\]\n]*))?\]/gi)
  return {
    findings: found.map(match => ({
      code: 'tk.placeholder', severity: 'warning', entity_type: 'scene', entity_id: match.scene.id, passage: match.passage, actions: [], uncertain: false,
      message: match.groups[1]?.trim() ? `TK in '${match.scene.title ?? 'Untitled scene'}': ${match.groups[1].trim()}` : `TK in '${match.scene.title ?? 'Untitled scene'}' (no note): ${match.passage.excerpt}`,
    })),
    visual: { count: found.length, scenes: new Set(found.map(match => match.scene.id)).size },
  }
}

function oneEditApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function consistency(s: Sandbox) {
  const kept = new Set((rows(s, 'story')[0]?.consistency_exceptions as string[] | undefined) ?? [])
  const cast = rows(s, 'character').flatMap(character => [String(character.name), ...((character.aliases as string[] | undefined) ?? [])].map(name => ({ name, character })))
  const known = new Set(cast.map(entry => entry.name.toLocaleLowerCase()))
  const words = matches(s, /\p{Lu}\p{Ll}{2,}/gu)
  const lower = new Set(placedScenes(s).flatMap(scene => String(scene.content ?? '').match(/\b\p{Ll}+\b/gu) ?? []))
  const findings = cast.filter(entry => entry.name.length >= 4).flatMap(({ name, character }) => {
    const variants = new Map<string, typeof words>()
    for (const word of words) {
      const folded = word.text.toLocaleLowerCase()
      if (known.has(folded) || lower.has(folded) || !oneEditApart(folded, name.toLocaleLowerCase())) continue
      variants.set(word.text, [...(variants.get(word.text) ?? []), word])
    }
    const uses = words.filter(word => word.text === name).length
    return [...variants].filter(([variant]) => !kept.has(`name:${variant.toLocaleLowerCase()}~${name.toLocaleLowerCase()}`)).map(([variant, found]) => {
      const scene = found[0].scene
      const present = words.some(word => word.text === name && word.scene.id === scene.id)
      return {
        code: 'names.likely_typo', severity: 'warning', entity_type: 'character', entity_id: character.id, passage: found[0].passage, uncertain: false,
        message: `'${variant}' (${found.length === 1 ? 'once' : `${found.length}×`}) is probably ${name} (${uses}×): one letter different; ${name} is ${present ? '' : 'not '}in that scene.`,
        actions: [
          { kind: 'replace', label: `Replace every '${variant}' with ${name}`, value: name, entity_type: null, entity_id: null, edits: found.map(word => ({ passage: word.passage, replacement: name })) },
          { kind: 'add_alias', label: `Add '${variant}' as an alias of ${name}`, value: variant, entity_type: 'character', entity_id: character.id, edits: [] },
          { kind: 'keep', label: 'Keep both', value: `name:${variant.toLocaleLowerCase()}~${name.toLocaleLowerCase()}`, entity_type: null, entity_id: null, edits: [] },
        ],
      }
    })
  })
  return { findings, visual: { language: 'en-US', names: findings.length, spelling: 0, hyphenation: 0, capitalisation: 0, kept: kept.size } }
}

/** GET /evaluations and /evaluations/{id} for the sandbox story. */
export function sandboxEvaluation(s: Sandbox, id: string | undefined) {
  const missingNow = missing(s)
  if (!id) return EVALUATORS.map(evaluator => ({ ...evaluator, kind: 'deterministic', has_review: false, reads_prose: true, inputs: ['scene.content'], ready: !missingNow.length, missing: missingNow }))
  const run = id === 'tk_placeholders' ? tk : id === 'consistency' ? consistency : null
  if (!run) throw new Error('Available with a free account')
  if (missingNow.length) return { story_id: SANDBOX_ID, evaluator_id: id, ready: false, missing: missingNow, findings: [], visual: {} }
  return { story_id: SANDBOX_ID, evaluator_id: id, ready: true, missing: [], ...run(s) }
}

/** The server's rename plan (domain/rename.py): full name, then each changed word, plus upper case. */
function renamePlan(from: string, to: string) {
  const before = from.split(/\s+/).filter(Boolean), after = to.split(/\s+/).filter(Boolean)
  const old = before.join(' '), next = after.join(' ')
  if (!old || !next || old === next) return []
  const plan: [string, string, string][] = [[old, next, 'full']]
  if (before.length > 1) {
    const pairs = before.length === after.length ? before.map((word, index) => [word, after[index]]) : [[before[0], after[0]]]
    for (const [a, b] of pairs) if (a !== b && a.length > 1 && !a.endsWith('.')) plan.push([a, b, 'part'])
  }
  return plan.flatMap(([find, replace, group]) => find.toUpperCase() === find ? [[find, replace, group]] : [[find, replace, group], [find.toUpperCase(), replace.toUpperCase(), group]]).sort((a, b) => b[0].length - a[0].length)
}

/** GET /name-uses: where an old name still appears, with its replacement (same shape as the server). */
export function sandboxNameUses(s: Sandbox, name: string, replacement: string) {
  const plan = renamePlan(name, replacement)
  const lookup = new Map(plan.map(([find, replace, group]) => [find, { replace, group }]))
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?<![-\\u2010])(?:${plan.map(([find]) => escape(find)).join('|')})(?![-\\u2010]?[\\p{L}\\p{N}])`, 'gu')
  const uses = plan.length ? matches(s, pattern).map(match => ({ passage: match.passage, replacement: lookup.get(match.text)!.replace, group: lookup.get(match.text)!.group })) : []
  return { name, replacement, uses }
}

/** The server's rule: a save replacing over half of 200+ characters snapshots first. */
export function replacesMostOf(previous: string, next: string) {
  if (previous.length < 200 || previous === next) return false
  const limit = Math.min(previous.length, next.length)
  let start = 0
  while (start < limit && previous[start] === next[start]) start++
  let end = 0
  while (end < limit - start && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++
  return (previous.length - start - end) / previous.length > 0.5
}
