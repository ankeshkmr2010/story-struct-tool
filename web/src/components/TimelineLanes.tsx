import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type TimelineEntry } from '../api/client'
import { t } from '../i18n'
import { craftPlain, craftTitle } from './CraftTerm'

type Order = 'story' | 'world'
type Lanes = 'pov' | 'place'
const LANES_KEY = 'storytool-timeline-lanes'

/** Design → Timeline: every scene and event on lanes (by POV or by place), in reading or world order. */
export function TimelineLanes({ storyId, onOpenScene }: { storyId: string; onOpenScene: (sceneId: string) => void }) {
  const timeline = useQuery({ queryKey: ['timeline', storyId], queryFn: () => api.getTimeline(storyId) })
  const [order, setOrder] = useState<Order>('story')
  const [lanes, setLanesState] = useState<Lanes>(() => { try { return localStorage.getItem(LANES_KEY) === 'place' ? 'place' : 'pov' } catch { return 'pov' } })
  const setLanes = (value: Lanes) => { setLanesState(value); try { localStorage.setItem(LANES_KEY, value) } catch { /* Optional browser storage. */ } }
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)

  if (timeline.isPending) return <p className="writer-help">{t('Loading…')}</p>
  const all = timeline.data?.entries ?? []
  // Story order is reading order (scenes on the page); world order is when things happen.
  const key = (entry: TimelineEntry) => order === 'story' ? entry.reading_order ?? null : entry.ordinal ?? null
  const placed = all.filter(entry => key(entry) !== null).sort((a, b) => (key(a)! - key(b)!) || a.title.localeCompare(b.title))
  const unplaced = all.length - placed.length
  const laneOf = (entry: TimelineEntry) => lanes === 'pov'
    ? entry.participants.find(person => person.is_pov)?.name ?? t('No POV')
    : entry.location_name ?? t('No place')
  const names = [...new Set(placed.map(laneOf))]
  const step = 132 * zoom
  const current = all.find(entry => entry.id === selected)

  return <section className="plan-view">
    <header className="plan-head">
      <h2>{t('Timeline')}</h2>
      <div className="timeline-controls">
        <div className="lib-view" role="group" aria-label={t('Order')}>
          <button type="button" aria-pressed={order === 'story'} onClick={() => setOrder('story')}>{t('Story order')}</button>
          <button type="button" aria-pressed={order === 'world'} onClick={() => setOrder('world')} title={craftTitle('world_order')}>{craftPlain('world_order')}</button>
        </div>
        <div className="lib-view" role="group" aria-label={t('Lanes')}>
          <button type="button" aria-pressed={lanes === 'pov'} onClick={() => setLanes('pov')}>{t('By POV')}</button>
          <button type="button" aria-pressed={lanes === 'place'} onClick={() => setLanes('place')}>{t('By place')}</button>
        </div>
        <span className="timeline-zoom">
          <button type="button" className="ui-icon-btn" aria-label={t('Zoom out')} disabled={zoom <= 0.6} onClick={() => setZoom(value => Math.max(0.6, value - 0.4))}>−</button>
          <button type="button" className="ui-icon-btn" aria-label={t('Zoom in')} disabled={zoom >= 2.2} onClick={() => setZoom(value => Math.min(2.2, value + 0.4))}>+</button>
        </span>
      </div>
    </header>
    {!placed.length ? <p className="writer-help">{order === 'story' ? t('No scenes are placed in reading order yet.') : t('Nothing has a story time yet. Give scenes and events a time to see them in world order.')}</p> : <>
      <div className="timeline-panel">
        <div className="timeline-scroll" tabIndex={0} aria-label={t('Scroll sideways through the timeline')}>
          <div className="timeline-grid" style={{ width: `max(100%, ${140 + placed.length * step + 40}px)` }}>
            {names.map((name, lane) => <div key={name} className="timeline-lane">
              <span className="timeline-lane-label" title={name}>{name}</span>
              <div className="timeline-track">
                {placed.map((entry, index) => laneOf(entry) === name && <button key={entry.id} type="button" className={`timeline-item lane-c${lane % 6}${entry.kind === 'event' ? ' is-event' : ''}${entry.is_flashback ? ' is-flashback' : ''}${selected === entry.id ? ' is-selected' : ''}`} style={{ left: index * step, width: step - 10 }} aria-pressed={selected === entry.id} title={entry.title} onClick={() => setSelected(selected === entry.id ? null : entry.id)}>
                  {entry.is_turning_point && <i aria-label={craftPlain('turning_point')}>◆</i>}<span>{entry.title}</span>
                </button>)}
              </div>
            </div>)}
          </div>
        </div>
        <p className="lib-note">{[t(placed.length === 1 ? '{0} item' : '{0} items', placed.length), unplaced ? t('{0} not shown: no place in this order', unplaced) : null, t('◆ turning point · dashed: event off the page · slanted: flashback')].filter(Boolean).join(' · ')}</p>
      </div>
      {current && <div className="timeline-detail" aria-live="polite">
        <p className="eyebrow">{current.kind === 'scene' ? t('Scene') : t('Event')}{current.time_label ? ` · ${current.time_label}` : ''}</p>
        <h3>{current.title}</h3>
        <p className="lib-note">{[current.chapter_title, current.location_name, current.participants.map(person => person.is_pov ? `${person.name} (POV)` : person.name).join(', ')].filter(Boolean).join(' · ')}</p>
        {current.summary && <p>{current.summary}</p>}
        {(current.beats.length > 0 || current.threads.length > 0) && <p className="lib-note">{[...current.beats, ...current.threads].join(' · ')}</p>}
        {current.scene_id && <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpenScene(current.scene_id!)}>{t('Open scene')}</button>}
      </div>}
    </>}
  </section>
}
