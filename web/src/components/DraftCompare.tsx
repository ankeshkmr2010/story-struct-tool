import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { changeStats, compareTexts, mergeTexts, type Choice } from './draftDiff'
import { t } from '../i18n'

export type DraftSide = { label: string; text: string }

/**
 * Compare an earlier draft of a scene (a snapshot or a story version) with another draft,
 * word by word. Against the current text, each change can be kept or taken from the earlier
 * draft, and Apply saves the result as an ordinary, undoable edit: open writing is saved
 * first, the scene must still read as compared, and the previous text is snapshotted.
 */
export function DraftCompare({ storyId, sceneId, earlier, later, laterIsCurrent, beforeEdit, onApplied }: {
  storyId: string
  sceneId: string
  earlier: DraftSide
  later: DraftSide
  laterIsCurrent: boolean
  beforeEdit: () => Promise<boolean>
  onApplied: (text: string) => void
}) {
  const qc = useQueryClient()
  const segments = useMemo(() => compareTexts(earlier.text, later.text), [earlier.text, later.text])
  const stats = changeStats(segments)
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [view, setView] = useState<'changes' | 'side'>('changes')
  const taken = Object.values(choices).filter(choice => choice === 'snapshot').length
  const choose = (id: number, choice: Choice) => setChoices(current => ({ ...current, [id]: choice }))
  const chooseAll = (choice: Choice) => setChoices(Object.fromEntries(segments.flatMap(segment => segment.kind === 'change' ? [[segment.id, choice]] : [])))

  const apply = useMutation({
    mutationFn: async () => {
      if (!await beforeEdit()) throw new Error(t('Save your writing before applying changes.'))
      const saved = (await api.getContent(storyId, sceneId)).content ?? ''
      if (saved !== later.text) throw new Error(t('This scene changed since you opened the comparison. Close it and compare again.'))
      const merged = mergeTexts(segments, choices)
      await api.saveContent(storyId, sceneId, { content: merged, expected_content: saved, snapshot: true, snapshot_label: t('Before taking changes from {0}', earlier.label) })
      return merged
    },
    onSuccess: merged => {
      qc.setQueryData(['content', storyId, sceneId], { scene_id: sceneId, content: merged, word_count: merged.split(/\s+/).filter(Boolean).length })
      for (const key of ['revisions', 'scenes', 'progress', 'placeholders']) void qc.invalidateQueries({ queryKey: [key, storyId] })
      onApplied(merged)
    },
  })

  if (!stats.changes) return <p className="writer-help">{t('No differences: {0} and {1} read the same.', earlier.label, later.label)}</p>
  return <div className="draft-compare">
    <div className="draft-compare-bar">
      <p>{stats.changes} {stats.changes === 1 ? t('change') : t('changes')} · {earlier.label} → {later.label}</p>
      <div className="draft-compare-views" role="group" aria-label={t('View')}>
        <button type="button" aria-pressed={view === 'changes'} onClick={() => setView('changes')}>{t('Changes')}</button>
        <button type="button" aria-pressed={view === 'side'} onClick={() => setView('side')}>{t('Side by side')}</button>
      </div>
    </div>

    {view === 'changes' ? <>
      {laterIsCurrent && <div className="draft-compare-bulk">
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => chooseAll('current')}>{t('Keep all current')}</button>
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => chooseAll('snapshot')}>{t('Take all from {0}', earlier.label)}</button>
      </div>}
      <div className="draft-compare-text">
        {segments.map((segment, index) => segment.kind === 'same' ? <span key={index}>{segment.text}</span> : (() => {
          const fromEarlier = choices[segment.id] === 'snapshot'
          return <span key={index} className={`draft-change${fromEarlier ? ' is-earlier' : ''}`}>
            {segment.snapshot && <del title={t('In {0}', earlier.label)}>{segment.snapshot}</del>}
            {segment.current && <ins title={t('In {0}', later.label)}>{segment.current}</ins>}
            {laterIsCurrent && <button type="button" className="draft-change-toggle" aria-pressed={fromEarlier} aria-label={fromEarlier ? t('Using {0} here; keep the current text instead', earlier.label) : t('Keeping the current text here; use {0} instead', earlier.label)} onClick={() => choose(segment.id, fromEarlier ? 'current' : 'snapshot')}>{fromEarlier ? t('↩ earlier') : t('current')}</button>}
          </span>
        })())}
      </div>
    </> : <div className="draft-compare-side">
      <section aria-label={earlier.label}><h3>{earlier.label}</h3><div className="draft-compare-text">{segments.map((segment, index) => segment.kind === 'same' ? <span key={index}>{segment.text}</span> : segment.snapshot && <del key={index}>{segment.snapshot}</del>)}</div></section>
      <section aria-label={later.label}><h3>{later.label}</h3><div className="draft-compare-text">{segments.map((segment, index) => segment.kind === 'same' ? <span key={index}>{segment.text}</span> : segment.current && <ins key={index}>{segment.current}</ins>)}</div></section>
    </div>}

    <div className="draft-compare-foot">
      {laterIsCurrent ? <>
        <p className="writer-help">{taken ? t('{0} of {1} will be taken from {2}; the rest stay as they are.', taken, stats.changes, earlier.label) : t('Every change stays as it is now. Click a change to take the earlier wording instead.')}</p>
        <button type="button" className="ui-btn ui-btn-primary" disabled={!taken || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? t('Applying…') : t('Apply')}</button>
      </> : <p className="writer-help">{t('Comparing two earlier drafts is read-only. Compare a draft with the current text to take changes from it.')}</p>}
      {apply.error && <p role="alert" className="writer-error">{errorText(apply.error)}</p>}
    </div>
  </div>
}
