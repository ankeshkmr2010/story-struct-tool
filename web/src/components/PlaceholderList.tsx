import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { applyPassageEdits, type Passage } from './passageEdits'
import { openBeside } from './beside'
import { usePlaceholders } from './usePlaceholders'
import { t } from '../i18n'

const note = (marker: string) => marker.replace(/^\[\s*tk\s*:?\s*/i, '').replace(/\]$/, '').trim()

/** Fill or remove placeholders as verified saves of the scene's prose (see passageEdits). */
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
    mutationFn: async ({ passage, replacement }: { passage: Passage; replacement: string }) => {
      const { stale } = await applyPassageEdits(storyId, [{ passage, replacement }], beforeEdit)
      if (stale) throw new Error('This placeholder changed since the list loaded. The list is refreshed; try again.')
    },
    onSettled: async (_, __, { passage }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['placeholders', storyId] }),
        qc.invalidateQueries({ queryKey: ['content', storyId, passage.scene_id] }),
      ])
    },
  })

  if (placeholders.isPending) return <p className="writer-help">{t('Looking for placeholders…')}</p>
  if (placeholders.error) return <p role="alert">{errorText(placeholders.error)}</p>
  const items = placeholders.data.findings.flatMap(finding => finding.passage ? [finding.passage] : [])
  const sceneTitle = (id: string) => scenes.data?.find(scene => scene.id === id)?.title || t('Untitled scene')
  const chapterTitle = (sceneId: string) => {
    const chapterId = scenes.data?.find(scene => scene.id === sceneId)?.chapter_id
    return chapters.data?.find(chapter => chapter.id === chapterId)?.title || ''
  }
  const key = (p: Passage) => `${p.scene_id}:${p.start}`

  return <div className="placeholder-list">
    <p className="writer-help">{t('{0} Type', items.length ? t('{0} {1} left to fill.', items.length, items.length === 1 ? t('placeholder') : t('placeholders')) : t('No placeholders.'))}{' '}<code>[TK]</code>{' '}{t('or')}{' '}<code>[TK: note]</code>{' '}{t('while writing, or right-click and choose Add TK here.')}</p>
    {placeholders.data.missing.length > 0 && <p className="writer-help">{placeholders.data.missing.join(' ')}</p>}
    {edit.error && <p role="alert" className="writer-error">{errorText(edit.error)}</p>}
    <ul>
      {items.map((passage, index) => {
        const heading = passage.scene_id !== items[index - 1]?.scene_id
        const value = drafts[key(passage)] ?? ''
        return <li key={key(passage)}>
          {heading && <p className="placeholder-scene">{!compact && chapterTitle(passage.scene_id) && <span>{chapterTitle(passage.scene_id)} · </span>}{sceneTitle(passage.scene_id)}</p>}
          <div className="placeholder-item">
            <p><strong>{note(passage.find) || t('No note')}</strong><span>{passage.excerpt}</span></p>
            <form onSubmit={event => { event.preventDefault(); if (value.trim()) edit.mutate({ passage, replacement: value.trim() }) }}>
              <input aria-label={t('Text to replace {0}', passage.find)} placeholder={t('Fill in…')} value={value} onChange={event => setDrafts(current => ({ ...current, [key(passage)]: event.target.value }))} />
              <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={edit.isPending || !value.trim()}>{t('Fill')}</button>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpen(passage.scene_id, passage.find, passage.paragraph)}>{t('Open')}</button>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" title={t('Show this scene read-only beside the manuscript')} onClick={() => openBeside({ kind: 'scene', id: passage.scene_id })}>{t('Beside')}</button>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={edit.isPending} onClick={() => edit.mutate({ passage, replacement: '' })} title={t('Delete the marker and keep the surrounding text')}>{t('Remove')}</button>
            </form>
          </div>
        </li>
      })}
    </ul>
  </div>
}
