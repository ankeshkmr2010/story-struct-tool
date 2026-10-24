import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Scene } from '../api/client'
import { orderScenes } from '../api/ordering'
import { openBeside } from './beside'
import { t, tx } from '../i18n'

const MAX_POV = 8
type Shift = 'shift' | 'flat' | 'missing'
const SHIFT_LABEL: Record<Shift, string> = { shift: tx('Value shifts'), flat: tx('No shift'), missing: tx('Not set') }

const shiftOf = (scene: Scene): Shift => {
  const from = scene.emotional_value_from?.trim().toLowerCase()
  const to = scene.emotional_value_to?.trim().toLowerCase()
  if (!from || !to) return 'missing'
  return from === to ? 'flat' : 'shift'
}

/**
 * The book's pacing at a glance: scene length, value shift and point of view for every
 * placed scene in reading order, as three rows on one shared scene axis. Read-only; a click
 * selects a scene and keeps the chart, offering Open scene and Open beside. Everything comes
 * from fields the Grid already stores.
 */
export function PacingView({ storyId, onOpenScene }: { storyId: string; onOpenScene: (scene: Scene) => void }) {
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId) })
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  if (chapters.isPending || scenes.isPending) return <p className="writer-help">{t('Loading scenes…')}</p>
  const ordered = (chapters.data ?? []).flatMap(chapter => orderScenes((scenes.data ?? []).filter(scene => scene.chapter_id === chapter.id)).map(scene => ({ scene, chapter })))
  if (!ordered.length) return <p className="writer-help">{t('Place scenes in chapters to see the book’s pacing.')}</p>

  const name = (id: string | null | undefined) => characters.data?.find(character => character.id === id)?.name ?? null
  // POV colour follows the character (first appearance order), never its rank, and folds
  // past eight into Other so no generated hues appear.
  const povOrder: string[] = []
  for (const { scene } of ordered) if (scene.pov_character_id && !povOrder.includes(scene.pov_character_id)) povOrder.push(scene.pov_character_id)
  const povSlot = (id: string | null | undefined) => !id ? null : povOrder.indexOf(id) < MAX_POV ? povOrder.indexOf(id) + 1 : 'other'
  const longest = Math.max(1, ...ordered.map(({ scene }) => scene.word_count))
  const total = ordered.reduce((sum, { scene }) => sum + scene.word_count, 0)
  const shifting = ordered.filter(({ scene }) => shiftOf(scene) === 'shift').length
  const flat = ordered.filter(({ scene }) => shiftOf(scene) === 'flat').length
  const withPov = ordered.filter(({ scene }) => scene.pov_character_id).length
  const columns = { gridTemplateColumns: `repeat(${ordered.length}, minmax(8px, 1fr))` }
  const active = hovered !== null ? ordered[hovered] : selected !== null ? ordered[selected] ?? null : null
  const chosen = selected !== null ? ordered[selected] ?? null : null
  const marked = (index: number) => `${hovered === index ? ' is-hovered' : ''}${selected === index ? ' is-selected' : ''}`
  const describe = ({ scene, chapter }: (typeof ordered)[number]) =>
    t('{0}, chapter {1}: {2} words, {3}{4}', scene.title || 'Untitled scene', chapter.number, scene.word_count.toLocaleString(), t(SHIFT_LABEL[shiftOf(scene)]).toLowerCase(), scene.pov_character_id ? `, POV ${name(scene.pov_character_id) ?? 'unknown'}` : '')

  return <section className="pacing-root" aria-label={t('Pacing')}>
    <p className="pacing-summary">
      {t('{0} scenes · {1} words · average {2} per scene · value shifts in {3} of {4}{5} · POV set in {6}', ordered.length, total.toLocaleString(), Math.round(total / ordered.length).toLocaleString(), shifting, ordered.length, flat ? t(' ({0} flat)', flat) : '', withPov)}
    </p>

    <div className="pacing-scroll">
      <div className="pacing-chart" onMouseLeave={() => setHovered(null)}>
        <div className="pacing-chapters" style={columns} aria-hidden="true">
          {ordered.map(({ scene, chapter }, index) => <span key={scene.id} className={index === 0 || ordered[index - 1].chapter.id !== chapter.id ? 'is-start' : ''}>{index === 0 || ordered[index - 1].chapter.id !== chapter.id ? chapter.number : ''}</span>)}
        </div>

        <p className="pacing-row-label">{t('Scene length')}{' '}<span>{t('longest {0} words', longest.toLocaleString())}</span></p>
        <div className="pacing-row pacing-lengths" style={columns}>
          {ordered.map(({ scene }, index) => <span key={scene.id} className={marked(index)}><i style={{ height: `${Math.max(scene.word_count ? 6 : 0, (scene.word_count / longest) * 100)}%` }} /></span>)}
        </div>

        <p className="pacing-row-label">{t('Value shift')}</p>
        <div className="pacing-row pacing-shifts" style={columns}>
          {ordered.map(({ scene }, index) => <span key={scene.id} className={`is-${shiftOf(scene)}${marked(index)}`}><i /></span>)}
        </div>

        <p className="pacing-row-label">{t('Point of view')}</p>
        <div className="pacing-row pacing-povs" style={columns}>
          {ordered.map(({ scene }, index) => { const slot = povSlot(scene.pov_character_id); return <span key={scene.id} className={marked(index)}><i className={slot === null ? 'is-none' : slot === 'other' ? 'is-other' : ''} style={typeof slot === 'number' ? { background: `var(--pov-${slot})` } : undefined} /></span> })}
        </div>

        {/* One hit target per scene spans all three rows, so hover and click never miss a thin mark. */}
        <div className="pacing-hits" style={columns}>
          {ordered.map((entry, index) => <button key={entry.scene.id} type="button" aria-pressed={selected === index} aria-label={t('Select {0}', describe(entry))} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onClick={() => setSelected(index)} onDoubleClick={() => onOpenScene(entry.scene)} />)}
        </div>
      </div>
    </div>

    <div className="pacing-tooltip" aria-hidden="true">
      {active ? <>
        <strong>{active.scene.title || t('Untitled scene')}</strong>
        <span>{t('Chapter {0}{1}', active.chapter.number, active.chapter.title ? `: ${active.chapter.title}` : '')}</span>
        <span>{t('{0} words · {1}', active.scene.word_count.toLocaleString(), active.scene.type === 'sequel' ? t('Sequel') : t('Scene'))}</span>
        <span>{t(SHIFT_LABEL[shiftOf(active.scene)])}{active.scene.emotional_value_from || active.scene.emotional_value_to ? `: ${active.scene.emotional_value_from || '?'} → ${active.scene.emotional_value_to || '?'}` : ''}</span>
        <span>{t('POV: {0}', name(active.scene.pov_character_id) ?? t('not set'))}</span>
      </> : <span>{t('Hover or tab to a scene for details; click to select it.')}</span>}
    </div>
    {chosen && <div className="pacing-selected">
      <span>{t('Selected:')}{' '}<strong>{chosen.scene.title || t('Untitled scene')}</strong></span>
      <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => onOpenScene(chosen.scene)}>{t('Open scene')}</button>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openBeside({ kind: 'scene', id: chosen.scene.id })}>{t('Open beside')}</button>
      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setSelected(null)}>{t('Clear')}</button>
    </div>}

    <ul className="pacing-legend" aria-label={t('Legend')}>
      <li><i className="pacing-key is-shift" />{t('Value shifts')}</li>
      <li><i className="pacing-key is-flat" />{t('No shift')}</li>
      <li><i className="pacing-key is-missing" />{t('Not set')}</li>
      {povOrder.slice(0, MAX_POV).map((id, index) => <li key={id}><i className="pacing-key is-pov" style={{ background: `var(--pov-${index + 1})` }} />{name(id) ?? t('Unknown')}</li>)}
      {povOrder.length > MAX_POV && <li><i className="pacing-key is-pov is-other" />{t('Other POV')}</li>}
      <li><i className="pacing-key is-pov is-none" />{t('No POV')}</li>
    </ul>

    <details className="pacing-table">
      <summary>{t('Table view')}</summary>
      <table>
        <thead><tr><th scope="col">{t('Ch.')}</th><th scope="col">{t('Scene')}</th><th scope="col">{t('Words')}</th><th scope="col">{t('Value shift')}</th><th scope="col">{t('POV')}</th></tr></thead>
        <tbody>{ordered.map(({ scene, chapter }) => <tr key={scene.id}>
          <td>{chapter.number}</td>
          <td><button type="button" className="underline" onClick={() => onOpenScene(scene)}>{scene.title || t('Untitled scene')}</button> <button type="button" className="pacing-beside" onClick={() => openBeside({ kind: 'scene', id: scene.id })}>{t('Beside')}</button></td>
          <td>{scene.word_count.toLocaleString()}</td>
          <td>{t(SHIFT_LABEL[shiftOf(scene)])}{scene.emotional_value_from || scene.emotional_value_to ? ` (${scene.emotional_value_from || '?'} → ${scene.emotional_value_to || '?'})` : ''}</td>
          <td>{name(scene.pov_character_id) ?? '—'}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </section>
}
