import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Beat } from '../api/client'
import { errorText } from '../api/errors'
import { InlineSelect, InlineText } from './fields'
import { plural, t } from '../i18n'
import { CraftTerm } from './CraftTerm'

/** Design → Structure: act columns with their beats as cards; a beat opens in the drawer. */
export function StructureBoard({ storyId, onOpenScene }: { storyId: string; onOpenScene: (sceneId: string) => void }) {
  const qc = useQueryClient()
  const acts = useQuery({ queryKey: ['acts', storyId], queryFn: () => api.listActs(storyId) })
  const beats = useQuery({ queryKey: ['beats', storyId], queryFn: () => api.listBeats(storyId) })
  const timeline = useQuery({ queryKey: ['timeline', storyId], queryFn: () => api.getTimeline(storyId) })
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const refresh = () => { for (const key of ['beats', 'ladder', 'health', 'brief', 'timeline']) void qc.invalidateQueries({ queryKey: [key, storyId] }) }
  const update = (beat: Beat) => (body: Record<string, unknown>) => api.updateBeat(storyId, beat.id, body).then(refresh)
  const create = useMutation({
    mutationFn: (actId: string | null) => api.createBeat(storyId, { label: label.trim(), act_id: actId, sort_key: Math.max(0, ...(beats.data ?? []).map(beat => beat.sort_key)) + 100 }),
    onSuccess: beat => { setLabel(''); setAdding(null); setSelected(beat.id); refresh() },
  })
  // Scenes carry the labels of the beats they fulfil, so a beat's card can show where it lands.
  const scenesFor = (beat: Beat) => (timeline.data?.entries ?? []).filter(entry => entry.kind === 'scene' && entry.scene_id && entry.beats.includes(beat.label))
  const columns = [
    ...(acts.data ?? []).map(act => ({ id: act.id as string | null, title: act.title ? t('Act {0} · {1}', act.number, act.title) : t('Act {0}', act.number) })),
    ...((beats.data ?? []).some(beat => !beat.act_id) || !(acts.data ?? []).length ? [{ id: null, title: t('No act yet') }] : []),
  ]
  const current = beats.data?.find(beat => beat.id === selected)
  const submit = (actId: string | null) => (event: FormEvent) => { event.preventDefault(); if (label.trim()) create.mutate(actId) }

  if (acts.isPending || beats.isPending) return <p className="writer-help">{t('Loading…')}</p>
  return <section className="plan-view">
    <header className="plan-head"><h2>{t('Structure')}</h2><span>{[plural(acts.data?.length ?? 0, '{0} act', '{0} acts', acts.data?.length ?? 0), plural(beats.data?.length ?? 0, '{0} story moment', '{0} story moments', beats.data?.length ?? 0)].join(' · ')}</span></header>
    <p className="writer-help">{t('Each act with the beats it should land. Click a beat to edit it and see the scenes that fulfil it. Acts and Beats in the list keep the full forms.')}</p>
    <div className={`structure-layout${current ? ' has-drawer' : ''}`}>
      <div className="structure-board" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(220px, 1fr))` }}>
        {columns.map(column => <div key={column.id ?? 'none'} className="structure-col">
          <h3>{column.title}</h3>
          {(beats.data ?? []).filter(beat => beat.act_id === column.id).map(beat => {
            const scenes = scenesFor(beat)
            return <button key={beat.id} type="button" className={`structure-beat${selected === beat.id ? ' is-selected' : ''}`} aria-pressed={selected === beat.id} onClick={() => setSelected(selected === beat.id ? null : beat.id)}>
              <strong>{beat.label}</strong>
              {beat.framework_position && <small>{beat.framework_position}</small>}
              <span className={`structure-status${scenes.length ? ' is-done' : ''}`}>{scenes.length ? plural(scenes.length, 'In {0} scene', 'In {0} scenes', scenes.length) : t('Not in a scene yet')}</span>
            </button>
          })}
          {adding === (column.id ?? 'none') ? <form className="structure-add" onSubmit={submit(column.id)}>
            <input autoFocus value={label} maxLength={200} placeholder={t('Beat label')} aria-label={t('Beat label')} onChange={event => setLabel(event.target.value)} />
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={!label.trim() || create.isPending}>{t('Add')}</button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { setAdding(null); setLabel('') }}>{t('Cancel')}</button>
          </form> : <button type="button" className="structure-new" onClick={() => { setAdding(column.id ?? 'none'); setLabel('') }}>{t('+ Story moment')}</button>}
        </div>)}
      </div>
      {current && <aside className="structure-drawer" aria-label={t('Beat details')}>
        <div className="structure-drawer-head"><h3><CraftTerm id="beat" /></h3><button type="button" aria-label={t('Close')} onClick={() => setSelected(null)}>×</button></div>
        <label className="field-label">{t('Label')}<InlineText key={`label-${current.id}`} value={current.label} placeholder={t('Beat label')} onSave={value => value ? update(current)({ label: value }) : undefined} /></label>
        <label className="field-label">{t('Description')}<InlineText key={`desc-${current.id}`} value={current.description} placeholder={t('What has to happen here?')} multiline onSave={value => update(current)({ description: value })} /></label>
        <label className="field-label">{t('Act')}<InlineSelect value={current.act_id} options={(acts.data ?? []).map(act => ({ value: act.id, label: act.title ? t('Act {0} · {1}', act.number, act.title) : t('Act {0}', act.number) }))} onSave={value => update(current)({ act_id: value })} /></label>
        <h4 className="field-label">{t('Scenes that fulfil it')}</h4>
        {scenesFor(current).length ? <ul className="structure-scenes">{scenesFor(current).map(entry => <li key={entry.id}><button type="button" className="goal-link" onClick={() => onOpenScene(entry.scene_id!)}>{entry.title}</button>{entry.chapter_title && <small> · {entry.chapter_title}</small>}</li>)}</ul>
          : <p className="writer-help">{t('No scene fulfils this beat yet. Link it from a scene’s details.')}</p>}
      </aside>}
    </div>
    {create.isError && <p role="alert" className="writer-error">{errorText(create.error)}</p>}
  </section>
}
