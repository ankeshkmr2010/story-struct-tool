import { useState } from 'react'
import type { TimelineEntry } from '../api/client'
import { t } from '../i18n'

/**
 * The one read-only story timeline (public showcase and shared reader). World order shows when
 * things happen; reading order shows scenes as told, with the events each one depicts.
 * The workspace Timeline is the editing tool and stays separate.
 */
function EntryCard({ entry, order, nested = [], onOpenScene }: { entry: TimelineEntry; order: 'world' | 'reading'; nested?: TimelineEntry[]; onOpenScene?: (sceneId: string) => void }) {
  const sceneId = entry.kind === 'scene' ? entry.id : entry.scene_id
  const people = entry.participants.map(person => person.name)
  const when = order === 'world' ? entry.reading_label && t('Told in {0}', entry.reading_label) : entry.time_label && t('Happens: {0}', entry.time_label)
  return <li className={`showcase-entry showcase-entry-${entry.kind}`}>
    <div className="showcase-entry-tags"><span className="showcase-pill">{entry.kind === 'scene' ? t('Scene') : t('Event')}</span>{entry.is_turning_point && <span className="showcase-pill showcase-pill-accent">{t('Turning point')}</span>}{entry.is_flashback && <span className="showcase-pill showcase-pill-accent">{t('↺ Flashback')}</span>}{order === 'world' && entry.time_label && <small>{entry.time_label}</small>}{order === 'reading' && entry.chapter_title && <small>{entry.chapter_title}</small>}</div>
    <h3>{entry.title}</h3>
    {entry.summary && <p>{entry.summary}</p>}
    <p className="showcase-entry-meta">{[entry.location_name, people.join(', '), when].filter(Boolean).join(' · ')}</p>
    {onOpenScene && sceneId && <button type="button" className="share-story-button mt-2" onClick={() => onOpenScene(sceneId)}>{t('Open scene →')}</button>}
    {nested.length > 0 && <ul className="showcase-entry-events">{nested.map(event => <li key={event.id}><strong>{event.title}</strong>{event.time_label && <small> · {event.time_label}</small>}</li>)}</ul>}
  </li>
}

export function ReadOnlyTimeline({ entries, onOpenScene }: { entries: TimelineEntry[]; onOpenScene?: (sceneId: string) => void }) {
  const [order, setOrder] = useState<'world' | 'reading'>('world')
  const world = entries.filter(entry => entry.ordinal != null).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
  const unplaced = entries.filter(entry => entry.ordinal == null)
  const scenes = entries.filter(entry => entry.kind === 'scene' && entry.reading_order != null).sort((a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0))
  const depicted = (scene: TimelineEntry) => entries.filter(entry => entry.kind === 'event' && entry.scene_id === scene.id)
  const flashbacks = scenes.filter(scene => scene.is_flashback).length
  return <div className="showcase-body">
    <div className="showcase-timeline-head">
      <div role="group" aria-label={t('Timeline order')} className="showcase-segment">{(['world', 'reading'] as const).map(id => <button key={id} type="button" aria-pressed={order === id} onClick={() => setOrder(id)}>{id === 'world' ? t('World order') : t('Reading order')}</button>)}</div>
      <p className="writer-help">{order === 'world' ? t('When things happen in the story world, including events that never appear on the page.') : t('The order a reader meets the scenes{0}. Events each scene depicts are listed under it.', flashbacks ? t(', including {0} flashback{1}', flashbacks, flashbacks > 1 ? t('s') : '') : '')}</p>
    </div>
    {order === 'world'
      ? <><ol className="reader-timeline showcase-timeline">{world.map(entry => <EntryCard key={entry.id} entry={entry} order="world" onOpenScene={onOpenScene} />)}</ol>{world.length === 0 && <p className="writer-help">{t('No timed scenes or events yet.')}</p>}{unplaced.length > 0 && <p className="writer-help">{t('{0} more {1} no world time yet.', unplaced.length, unplaced.length > 1 ? t('items have') : t('item has'))}</p>}</>
      : <><ol className="reader-timeline showcase-timeline">{scenes.map(scene => <EntryCard key={scene.id} entry={scene} order="reading" nested={depicted(scene)} onOpenScene={onOpenScene} />)}</ol>{scenes.length === 0 && <p className="writer-help">{t('No scenes placed in chapters yet.')}</p>}</>}
  </div>
}
