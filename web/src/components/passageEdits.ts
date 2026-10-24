import { api, type Evaluation } from '../api/client'
import { t } from '../i18n'

export type Passage = NonNullable<Evaluation['findings'][number]['passage']>
export type PassageEdit = { passage: Passage; replacement: string }

// Removing text should not leave a double space or a space before punctuation.
function splice(content: string, start: number, end: number, replacement: string) {
  const before = content.slice(0, start), after = content.slice(end)
  if (replacement === '' && / $/.test(before) && /^( |[.,;:!?)\]'"’”])/.test(after)) return before.slice(0, -1) + after
  return before + replacement + after
}

/**
 * Apply edits found by a check to saved scene prose, as the author's own saves. Open writing
 * is saved first; each scene is re-read and every edit is applied only if its text is still at
 * the recorded offsets, so a stale finding can never overwrite newer prose. One save per
 * scene, guarded by `expected_content`; a labelled snapshot makes larger fixes easy to undo.
 */
export async function applyPassageEdits(storyId: string, edits: PassageEdit[], beforeEdit: () => Promise<boolean>, label?: string) {
  if (!await beforeEdit()) throw new Error(t('Save your writing before changing the text.'))
  const byScene = new Map<string, PassageEdit[]>()
  for (const edit of edits) byScene.set(edit.passage.scene_id, [...(byScene.get(edit.passage.scene_id) ?? []), edit])
  let applied = 0, stale = 0
  const scenes: string[] = []
  for (const [sceneId, sceneEdits] of byScene) {
    const content = (await api.getContent(storyId, sceneId)).content ?? ''
    let next = content
    // Last offsets first, so earlier offsets stay valid while splicing.
    for (const edit of [...sceneEdits].sort((a, b) => b.passage.start - a.passage.start)) {
      if (content.slice(edit.passage.start, edit.passage.end) !== edit.passage.find) { stale += 1; continue }
      next = splice(next, edit.passage.start, edit.passage.end, edit.replacement)
      applied += 1
    }
    if (next === content) continue
    await api.saveContent(storyId, sceneId, { content: next, expected_content: content, ...(label ? { snapshot: true, snapshot_label: label } : {}) })
    scenes.push(sceneId)
  }
  return { applied, stale, scenes }
}
