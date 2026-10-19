import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Evaluation } from '../api/client'
import { errorText } from '../api/errors'
import { usePlaceholders } from './usePlaceholders'

type Passage = NonNullable<Evaluation['findings'][number]['passage']>

const note = (marker: string) => marker.replace(/^\[\s*tk\s*:?\s*/i, '').replace(/\]$/, '').trim()

// Removing a marker should not leave a double space or a space before punctuation.
function without(content: string, start: number, end: number) {
  const before = content.slice(0, start), after = content.slice(end)
  return / $/.test(before) && /^( |[.,;:!?)\]'"’”])/.test(after) ? before.slice(0, -1) + after : before + after
}

/**
 * Fill or remove placeholders as ordinary saves of the scene's prose. Each edit first saves any
 * open writing, re-reads the scene and checks the marker is still at its recorded offsets, so
 * a stale list can never overwrite newer text.
 */
export function PlaceholderList({ storyId, compact = false, beforeEdit, onOpen }: {
  storyId: string
  compact?: boolean
  beforeEdit: () => Promise<boolean>
  onOpen: (sceneId: string, find: string, paragraph: number) => void
}) {
  const qc = useQueryClient()
  const placeholders = usePlaceholders(storyId)
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const edit = useMutation({
    mutationFn: async ({ passage, replacement }: { passage: Passage; replacement: string | null }) => {
      if (!await beforeEdit()) throw new Error('Save your writing before changing placeholders.')
      const current = await api.getContent(storyId, passage.scene_id)
      const content = current.content ?? ''
      if (content.slice(passage.start, passage.end) !== passage.find) throw new Error('This placeholder changed since the list loaded. The list is refreshed; try again.')
      const next = replacement === null ? without(content, passage.start, passage.end) : content.slice(0, passage.start) + replacement + content.slice(passage.end)
      await api.saveContent(storyId, passage.scene_id, { content: next, expected_content: content })
    },
    onSettled: async (_, __, { passage }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['placeholders', storyId] }),
        qc.invalidateQueries({ queryKey: ['content', storyId, passage.scene_id] }),
      ])
    },
  })

  if (placeholders.isPending) return <p className="writer-help">Looking for placeholders…</p>
  if (placeholders.error) return <p role="alert">{errorText(placeholders.error)}</p>
  const items = placeholders.data.findings.flatMap(finding => finding.passage ? [finding.passage] : [])
  const sceneTitle = (id: string) => scenes.data?.find(scene => scene.id === id)?.title || 'Untitled scene'
  const chapterTitle = (sceneId: string) => {
    const chapterId = scenes.data?.find(scene => scene.id === sceneId)?.chapter_id
    return chapters.data?.find(chapter => chapter.id === chapterId)?.title || ''
  }
  const key = (p: Passage) => `${p.scene_id}:${p.start}`

  return <div className="placeholder-list">
    <p className="writer-help">{items.length ? `${items.length} ${items.length === 1 ? 'placeholder' : 'placeholders'} left to fill.` : 'No placeholders.'} Type <code>[TK]</code> or <code>[TK: note]</code> while writing, or right-click and choose Add TK here.</p>
    {placeholders.data.missing.length > 0 && <p className="writer-help">{placeholders.data.missing.join(' ')}</p>}
    {edit.error && <p role="alert" className="writer-error">{errorText(edit.error)}</p>}
    <ul>
      {items.map((passage, index) => {
        const heading = passage.scene_id !== items[index - 1]?.scene_id
        const value = drafts[key(passage)] ?? ''
        return <li key={key(passage)}>
          {heading && <p className="placeholder-scene">{!compact && chapterTitle(passage.scene_id) && <span>{chapterTitle(passage.scene_id)} · </span>}{sceneTitle(passage.scene_id)}</p>}
          <div className="placeholder-item">
            <p><strong>{note(passage.find) || 'No note'}</strong><span>{passage.excerpt}</span></p>
            <form onSubmit={event => { event.preventDefault(); if (value.trim()) edit.mutate({ passage, replacement: value.trim() }) }}>
              <input aria-label={`Text to replace ${passage.find}`} placeholder="Fill in…" value={value} onChange={event => setDrafts(current => ({ ...current, [key(passage)]: event.target.value }))} />
              <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={edit.isPending || !value.trim()}>Fill</button>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpen(passage.scene_id, passage.find, passage.paragraph)}>Open</button>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={edit.isPending} onClick={() => edit.mutate({ passage, replacement: null })} title="Delete the marker and keep the surrounding text">Remove</button>
            </form>
          </div>
        </li>
      })}
    </ul>
  </div>
}
