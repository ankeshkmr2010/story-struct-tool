import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { orderChapters, orderScenes } from '../api/ordering'
import { ManuscriptReading } from '../components/ManuscriptReading'

type Row = Record<string, unknown>
const value = (row: Row | undefined, field: string) => row?.[field] == null ? '' : String(row[field])
const list = (row: Row | undefined, field: string) => Array.isArray(row?.[field]) ? (row[field] as unknown[]).map(String) : []
const date = (text: string) => new Date(text).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const TABS = [['read', 'Read'], ['context', 'Context'], ['timeline', 'Timeline'], ['design', 'Design'], ['history', 'History']] as const
type Tab = typeof TABS[number][0]
const titled = (prefix: string, row: Row | undefined) => {
  const title = value(row, 'title'), number = value(row, 'number')
  if (new RegExp(`^${prefix}\\b`, 'i').test(title)) return title
  return [number && `${prefix} ${number}`, title].filter(Boolean).join(' · ') || `Untitled ${prefix.toLowerCase()}`
}
const human = (text: string) => text.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const ORIGINS: Record<string, string> = { mcp: 'AI agents (MCP)', assistant: 'In-app assistant', author: 'Author', import: 'Import' }

function Fields({ row, fields }: { row: Row; fields: [string, string][] }) {
  const shown = fields.filter(([field]) => value(row, field))
  if (!shown.length) return null
  return <dl className="reader-context-fields">{shown.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{value(row, field)}</dd></div>)}</dl>
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  if (count === 0) return null
  return <section className="showcase-section"><h2>{title}{count != null && <small> · {count}</small>}</h2>{children}</section>
}

export default function StoryShowcase() {
  const { token = '' } = useParams()
  const [tab, setTab] = useState<Tab>('read')
  const [allVersions, setAllVersions] = useState(false)
  const doc = useQuery({ queryKey: ['showcase', token], queryFn: () => api.readShowcase(token), retry: false })
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'; meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])
  useEffect(() => { if (doc.data) document.title = `${doc.data.title} · StoryTool showcase` }, [doc.data])

  if (doc.isPending) return <p className="p-8">Loading showcase…</p>
  if (doc.isError) return <main className="shared-reader-page"><h1>Showcase unavailable</h1><p role="alert" className="writer-help">{errorText(doc.error)}</p><p className="writer-help">The author may have turned this link off or replaced it.</p><Link to="/">What is StoryTool?</Link></main>

  const data = doc.data
  const structure = data.structure as Record<string, Row[]>
  const rows = (kind: string): Row[] => structure[kind] ?? []
  const lookup = (kind: string, id: unknown) => rows(kind).find(row => row.id === id)
  const name = (kind: string, id: unknown) => value(lookup(kind, id), kind === 'thread' ? 'title' : 'name')
  const story = rows('story')[0] ?? {}
  const chapters = orderChapters(rows('chapter'))
  const events = [...rows('event')].sort((a, b) => Number(a.sort_ordinal ?? Number.MAX_SAFE_INTEGER) - Number(b.sort_ordinal ?? Number.MAX_SAFE_INTEGER))
  const arcOwner = (arc: Row) => arc.character_id ? name('character', arc.character_id) : arc.thread_id ? name('thread', arc.thread_id)
    : [lookup('relationship', arc.relationship_id)].map(rel => [name('character', rel?.character_a_id), name('character', rel?.character_b_id)].filter(Boolean).join(' & '))[0] || 'Arc'
  const acts = orderChapters(rows('act'))
  const totalEdits = Object.values(data.authorship).reduce((sum, count) => sum + count, 0)
  const words = data.versions[0]?.word_count
  const agentEdits = (data.authorship.mcp ?? 0) + (data.authorship.assistant ?? 0)
  const shownVersions = allVersions ? data.versions : data.versions.slice(0, 6)
  const storyFacts: Row = { ...story, pov_style: story.pov_style ? `${human(value(story, 'pov_style'))} person` : null, structure_framework: value(story, 'structure_framework') === 'custom' ? null : human(value(story, 'structure_framework')) }

  return <main className="shared-reader-page showcase-page">
    <header className="shared-reader-header"><div>
      <p className="eyebrow">STORY SHOWCASE · READ ONLY{data.genre ? ` · ${data.genre.toUpperCase()}` : ''}</p>
      <h1>{data.title}</h1>
      {data.blurb && <p className="shared-reader-blurb">{data.blurb.replace(/\\"/g, '"')}</p>}
      <p className="writer-help">By {data.owner_name} · updated {date(data.updated_at)}{words ? ` · ${words.toLocaleString()} words` : ''} · {chapters.length} chapters · {rows('character').length} characters · {data.versions.length} saved versions</p>
    </div></header>
    <div className="reader-toolbar showcase-tabs" role="tablist" aria-label="Showcase sections">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-pressed={tab === id} className="share-story-button" onClick={() => setTab(id)}>{label}</button>)}</div>

    {tab === 'read' && <ManuscriptReading structure={structure} storyId={token} accountId="showcase" onPassage={() => undefined} onContext={() => undefined} />}

    {tab === 'context' && <div className="showcase-body">
      <Section title="Story"><Fields row={storyFacts} fields={[['premise', 'Premise'], ['thematic_statement', 'Theme'], ['pov_style', 'Point of view'], ['structure_framework', 'Structure']]} />
        {[['world_rules', 'World rules'], ['style_rules', 'Style rules'], ['motifs', 'Motifs']].map(([field, label]) => list(story, field).length > 0 && <div key={field}><h3>{label}</h3><ul className="showcase-list">{list(story, field).map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}
      </Section>
      <Section title="Characters" count={rows('character').length}><div className="showcase-grid">{rows('character').map(person => <article key={value(person, 'id')} className="showcase-card"><h3>{value(person, 'name')}</h3>{value(person, 'role') && <p className="eyebrow">{value(person, 'role')}</p>}<Fields row={person} fields={[['description', 'Description'], ['want', 'Wants'], ['need', 'Needs'], ['wound', 'Wound'], ['misbelief', 'Misbelief'], ['voice_notes', 'Voice']]} /></article>)}</div></Section>
      <Section title="Relationships" count={rows('relationship').length}><div className="showcase-grid">{rows('relationship').map(rel => <article key={value(rel, 'id')} className="showcase-card"><h3>{name('character', rel.character_a_id)} & {name('character', rel.character_b_id)}</h3><Fields row={rel} fields={[['current_dynamic', 'Dynamic'], ['history', 'History'], ['tension_notes', 'Tension']]} /></article>)}</div></Section>
      <Section title="Locations" count={rows('location').length}><div className="showcase-grid">{rows('location').map(place => <article key={value(place, 'id')} className="showcase-card"><h3>{value(place, 'name')}</h3><Fields row={place} fields={[['description', 'Description'], ['atmosphere_notes', 'Atmosphere']]} /></article>)}</div></Section>
      <Section title="Glossary" count={rows('glossary_entry').length}><dl className="reader-context-fields">{rows('glossary_entry').map(entry => <div key={value(entry, 'id')}><dt>{value(entry, 'term')}</dt><dd>{value(entry, 'definition')}</dd></div>)}</dl></Section>
    </div>}

    {tab === 'timeline' && <div className="showcase-body"><p className="writer-help">Events in world order. The manuscript keeps the author’s reading order, including flashbacks.</p>
      <ol className="reader-timeline">{events.map(event => <li key={value(event, 'id')}><small>{[value(event, 'display_label'), event.is_turning_point ? 'Turning point' : ''].filter(Boolean).join(' · ') || `Event ${events.indexOf(event) + 1}`}</small><h3>{value(event, 'label')}</h3>{value(event, 'description') && <p>{value(event, 'description')}</p>}<p>{[name('location', event.location_id), ...rows('event_character').filter(link => link.event_id === event.id).map(link => name('character', link.character_id))].filter(Boolean).join(' · ')}</p></li>)}</ol>
      {events.length === 0 && <p className="writer-help">No timeline events yet.</p>}</div>}

    {tab === 'design' && <div className="showcase-body">
      <Section title="Acts & beats" count={acts.length + rows('beat').length}>{[...acts, undefined].map(act => { const beats = rows('beat').filter(beat => (beat.act_id ?? undefined) === act?.id); if (!act && !beats.length) return null; return <div key={value(act, 'id') || 'none'} className="showcase-card"><h3>{act ? titled('Act', act) : 'Beats without an act'}</h3>{act && value(act, 'summary') && <p>{value(act, 'summary')}</p>}{act && (value(act, 'emotional_shift_from') || value(act, 'emotional_shift_to')) && <p className="showcase-shift">{value(act, 'emotional_shift_from') || '…'} → {value(act, 'emotional_shift_to') || '…'}</p>}<ol className="showcase-list">{orderScenes(beats).map(beat => <li key={value(beat, 'id')}><strong>{value(beat, 'label')}</strong>{value(beat, 'description') && ` — ${value(beat, 'description')}`}</li>)}</ol></div> })}</Section>
      <Section title="Arcs" count={rows('arc').length}><div className="showcase-grid">{rows('arc').map(arc => <article key={value(arc, 'id')} className="showcase-card"><h3>{arcOwner(arc)}</h3><ol className="showcase-list">{orderScenes(rows('arc_stage').filter(stage => stage.arc_id === arc.id)).map(stage => <li key={value(stage, 'id')}><strong>{value(stage, 'label')}</strong>{value(stage, 'description') && ` — ${value(stage, 'description')}`}</li>)}</ol>{value(arc, 'resolution') && <p className="writer-help">Resolution: {value(arc, 'resolution')}</p>}</article>)}</div></Section>
      <Section title="Threads" count={rows('thread').length}><ul className="showcase-list">{rows('thread').map(thread => <li key={value(thread, 'id')}><strong>{value(thread, 'title') || 'Untitled thread'}</strong>{value(thread, 'type') && ` · ${value(thread, 'type')}`}{thread.owner_character_id != null && ` · ${name('character', thread.owner_character_id)}`}</li>)}</ul></Section>
      <Section title="Chapters & scenes" count={chapters.length}>{chapters.map(chapter => <div key={value(chapter, 'id')} className="showcase-card"><h3>{titled('Chapter', chapter)}</h3>{value(chapter, 'summary') && <p>{value(chapter, 'summary')}</p>}<ol className="showcase-list">{orderScenes(rows('scene').filter(scene => scene.chapter_id === chapter.id)).map(scene => <li key={value(scene, 'id')}><strong>{value(scene, 'title') || 'Untitled scene'}</strong>{value(scene, 'status') && <small> · {human(value(scene, 'status'))}</small>}{value(scene, 'summary') && <p>{value(scene, 'summary')}</p>}<Fields row={scene} fields={[['goal', 'Goal'], ['conflict', 'Conflict'], ['outcome', 'Outcome']]} /></li>)}</ol></div>)}</Section>
    </div>}

    {tab === 'history' && <div className="showcase-body">
      <div className="showcase-stats">{([[agentEdits, 'field changes by AI agents'], [totalEdits - agentEdits, 'by the author'], [data.changes.length, 'agent batches reviewed'], [data.versions.length, 'restorable versions']] as const).map(([count, label]) => <div key={label}><strong>{count.toLocaleString()}</strong><span>{label}</span></div>)}</div>
      <Section title="Who wrote what"><p className="writer-help">Every field change is attributed to whoever made it.</p><div className="showcase-bar" aria-hidden="true">{Object.entries(data.authorship).sort((a, b) => b[1] - a[1]).map(([origin, count], i) => <span key={origin} style={{ flexGrow: count, opacity: 1 - i * 0.3 }} />)}</div><ul className="showcase-legend">{Object.entries(data.authorship).sort((a, b) => b[1] - a[1]).map(([origin, count]) => <li key={origin}><strong>{ORIGINS[origin] ?? human(origin)}</strong> {count.toLocaleString()} ({Math.round(100 * count / Math.max(totalEdits, 1))}%)</li>)}</ul></Section>
      <Section title="Saved versions" count={data.versions.length}><p className="writer-help">Whole-story checkpoints. Any of them can be previewed and restored by the author.</p><table className="showcase-table"><tbody>{shownVersions.map(version => <tr key={version.number}><td>v{version.number}</td><td>{version.label}</td><td>{human(version.source)}</td><td>{version.word_count != null ? `${version.word_count.toLocaleString()} words` : ''}</td><td>{date(version.created_at)}</td></tr>)}</tbody></table>{data.versions.length > 6 && <button type="button" className="share-story-button" onClick={() => setAllVersions(!allVersions)}>{allVersions ? 'Show fewer' : `Show all ${data.versions.length}`}</button>}</Section>
      <Section title="Reviewed agent changes" count={data.changes.length}><p className="writer-help">AI agents propose batches of edits; each one is applied, reviewed, or undone as a unit.</p><ul className="showcase-changes">{data.changes.map((change, i) => <li key={i}><span className={`showcase-status showcase-status-${change.status}`}>{human(change.status)}</span><span>{change.summary}</span><small>{date(change.created_at)}</small></li>)}</ul></Section>
    </div>}

    <footer className="showcase-footer"><p className="writer-help">Made with <Link to="/">StoryTool</Link>, a story graph and writing workspace that AI agents edit through MCP while the author stays in control.</p></footer>
  </main>
}
