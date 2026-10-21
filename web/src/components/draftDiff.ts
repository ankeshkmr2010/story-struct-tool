import { diffWordsWithSpace } from 'diff'

/** Unchanged text, or one change: the snapshot's words against the current words. */
export type Segment = { kind: 'same'; text: string } | { kind: 'change'; id: number; snapshot: string; current: string }
export type Choice = 'current' | 'snapshot'

// A short run of unchanged text between two changes (a space, a comma, a word or two) reads
// as part of one edit, so it joins them; a paragraph break never does.
const JOIN_LIMIT = 12

/** Word-level comparison of two drafts, grouped into changes a writer can accept one by one. */
export function compareTexts(snapshot: string, current: string): Segment[] {
  const raw: Segment[] = []
  for (const part of diffWordsWithSpace(snapshot, current)) {
    const last = raw[raw.length - 1]
    if (!part.added && !part.removed) { raw.push({ kind: 'same', text: part.value }); continue }
    const change = last?.kind === 'change' ? last : (raw.push({ kind: 'change', id: 0, snapshot: '', current: '' }), raw[raw.length - 1] as Extract<Segment, { kind: 'change' }>)
    if (part.added) change.current += part.value
    else change.snapshot += part.value
  }
  const merged: Segment[] = []
  for (let index = 0; index < raw.length; index++) {
    const segment = raw[index]
    const previous = merged[merged.length - 1]
    const next = raw[index + 1]
    if (segment.kind === 'same' && previous?.kind === 'change' && next?.kind === 'change' && segment.text.length <= JOIN_LIMIT && !/\n\s*\n/.test(segment.text)) {
      previous.snapshot += segment.text + next.snapshot
      previous.current += segment.text + next.current
      index++
      continue
    }
    if (segment.kind === 'change' && previous?.kind === 'change') { previous.snapshot += segment.snapshot; previous.current += segment.current; continue }
    merged.push(segment.kind === 'change' ? { ...segment } : segment)
  }
  let id = 0
  return merged.map(segment => segment.kind === 'change' ? { ...segment, id: id++ } : segment)
}

/** The text that results from taking each change from the chosen side (current by default). */
export function mergeTexts(segments: Segment[], choices: Record<number, Choice>): string {
  return segments.map(segment => segment.kind === 'same' ? segment.text : choices[segment.id] === 'snapshot' ? segment.snapshot : segment.current).join('')
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

export function changeStats(segments: Segment[]) {
  const changes = segments.filter((segment): segment is Extract<Segment, { kind: 'change' }> => segment.kind === 'change')
  return { changes: changes.length, snapshotWords: changes.reduce((sum, c) => sum + words(c.snapshot), 0), currentWords: changes.reduce((sum, c) => sum + words(c.current), 0) }
}
