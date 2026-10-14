import { ReadOnlyReferenceImages } from '../components/StoryImages'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { orderChapters, orderScenes } from '../api/ordering'
import { ManuscriptReading } from '../components/ManuscriptReading'
import { ReadOnlyTimeline } from '../components/ReadOnlyTimeline'

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

function Section({ id, title, count, children }: { id?: string; title: string; count?: number; children: ReactNode }) {
  if (count === 0) return null
  return <section id={id} className="showcase-section"><h2>{title}{count != null && <small> · {count}</small>}</h2>{children}</section>
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
  const arcOwner = (arc: Row) => arc.character_id ? name('character', arc.character_id) : arc.thread_id ? name('thread', arc.thread_id)
    : [lookup('relationship', arc.relationship_id)].map(rel => [name('character', rel?.character_a_id), name('character', rel?.character_b_id)].filter(Boolean).join(' & '))[0] || 'Arc'
  const acts = orderChapters(rows('act'))
  const totalEdits = Object.values(data.authorship).reduce((sum, count) => sum + count, 0)
  const words = data.versions[0]?.word_count
  const agentEdits = (data.authorship.mcp ?? 0) + (data.authorship.assistant ?? 0)
  const shownVersions = allVersions ? data.versions : data.versions.slice(0, 6)

  return <main className="shared-reader-page showcase-page">
    <header className="shared-reader-header"><div>
      <p className="eyebrow">STORY SHOWCASE · READ ONLY{data.genre ? ` · ${data.genre.toUpperCase()}` : ''}</p>
      <h1>{data.title}</h1>
      {data.blurb && <p className="shared-reader-blurb">{data.blurb.replace(/\\"/g, '"')}</p>}
      <p className="writer-help">By {data.owner_name} · updated {date(data.updated_at)}{words ? ` · ${words.toLocaleString()} words` : ''} · {chapters.length} chapters · {rows('character').length} characters · {data.versions.length} saved versions</p>
    </div></header>
    <div className="reader-toolbar showcase-tabs" role="tablist" aria-label="Showcase sections">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-pressed={tab === id} className="share-story-button" onClick={() => setTab(id)}>{label}</button>)}</div>

    {tab === 'read' && <ManuscriptReading structure={structure} storyId={token} accountId="showcase" onPassage={() => undefined} onContext={() => undefined} />}

    {tab === 'context' && <ShowcaseContext story={story} rows={rows} name={name} />}

    {tab === 'timeline' && <ReadOnlyTimeline entries={data.timeline.entries} />}

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

const ROLE_ORDER = ['protagonist', 'deuteragonist', 'antagonist', 'love_interest', 'mentor', 'supporting', 'minor']

function ShowcaseContext({ story, rows, name }: { story: Row; rows: (kind: string) => Row[]; name: (kind: string, id: unknown) => string }) {
  const people = [...rows('character')].sort((a, b) => {
    const rank = (row: Row) => { const i = ROLE_ORDER.indexOf(value(row, 'role').toLowerCase()); return i < 0 ? ROLE_ORDER.length : i }
    return rank(a) - rank(b)
  })
  const canon = ([['world_rules', 'World rules'], ['style_rules', 'Style rules']] as const).filter(([field]) => list(story, field).length)
  const motifs = list(story, 'motifs')
  const framework = value(story, 'structure_framework')
  const chips = [value(story, 'genre'), value(story, 'pov_style') && `${human(value(story, 'pov_style'))} person`, framework && framework !== 'custom' && human(framework)].filter(Boolean)
  const sections = ([['story', 'Story', 1], ['characters', 'Characters', people.length], ['relationships', 'Relationships', rows('relationship').length], ['places', 'Places', rows('location').length], ['glossary', 'Glossary', rows('glossary_entry').length]] as const).filter(([, , count]) => count)
  return <div className="showcase-body showcase-context">
    <nav className="showcase-jump" aria-label="Context sections">{sections.map(([id, label, count]) => <a key={id} href={`#ctx-${id}`} onClick={event => { event.preventDefault(); document.getElementById(`ctx-${id}`)?.scrollIntoView({ behavior: 'smooth' }) }}>{label}{id !== 'story' && <small>{count}</small>}</a>)}</nav>

    <section id="ctx-story" className="showcase-bible">
      <div className="showcase-card showcase-story-card">{chips.length > 0 && <div className="showcase-chips">{chips.map(chip => <span key={String(chip)}>{chip}</span>)}</div>}
      {value(story, 'premise') && <p className="showcase-premise">{value(story, 'premise')}</p>}
      {value(story, 'thematic_statement') && <blockquote className="showcase-theme"><small>Theme</small>{value(story, 'thematic_statement')}</blockquote>}</div>
      {(canon.length > 0 || motifs.length > 0) && <div className="showcase-canon">
        {canon.map(([field, label]) => <div key={field} className="showcase-card"><p className="eyebrow">{label}</p><ul>{list(story, field).map((rule, i) => <li key={i}>{rule}</li>)}</ul></div>)}
        {motifs.length > 0 && <div className="showcase-card"><p className="eyebrow">Motifs</p><div className="showcase-tags">{motifs.map((motif, i) => <span key={i}>{motif}</span>)}</div></div>}
      </div>}
    </section>

    <Section id="ctx-characters" title="Characters" count={people.length}><div className="showcase-grid">{people.map(person => {
      const inner = [['wound', 'Wound'], ['misbelief', 'Misbelief'], ['voice_notes', 'Voice']].filter(([field]) => value(person, field))
      return <article key={value(person, 'id')} className="showcase-card showcase-person">
        <header><span className="showcase-avatar" aria-hidden="true">{value(person, 'name').charAt(0)}</span><div><h3>{value(person, 'name')}</h3>{value(person, 'role') && <span className="showcase-pill">{human(value(person, 'role'))}</span>}</div></header>
        <ReadOnlyReferenceImages images={rows('story_image')} entity="character" entityId={value(person, 'id')} />{value(person, 'description') && <p>{value(person, 'description')}</p>}
        {(value(person, 'want') || value(person, 'need')) && <div className="showcase-wantneed">{value(person, 'want') && <div><small>Wants</small>{value(person, 'want')}</div>}{value(person, 'need') && <div><small>Needs</small>{value(person, 'need')}</div>}</div>}
        {inner.length > 0 && <details><summary>More</summary><dl className="reader-context-fields">{inner.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{value(person, field)}</dd></div>)}</dl></details>}
      </article>
    })}</div></Section>

    <Section id="ctx-relationships" title="Relationships" count={rows('relationship').length}><div className="showcase-grid">{rows('relationship').map(rel => <article key={value(rel, 'id')} className="showcase-card showcase-rel">
      <h3>{name('character', rel.character_a_id)} <span aria-label="and">⇄</span> {name('character', rel.character_b_id)}</h3>
      {value(rel, 'current_dynamic') && <p>{value(rel, 'current_dynamic')}</p>}
      {value(rel, 'tension_notes') && <p className="showcase-tension">{value(rel, 'tension_notes')}</p>}
    </article>)}</div></Section>

    <Section id="ctx-places" title="Places" count={rows('location').length}><div className="showcase-grid">{rows('location').map(place => <article key={value(place, 'id')} className="showcase-card">
      <h3>{value(place, 'name')}</h3><ReadOnlyReferenceImages images={rows('story_image')} entity="location" entityId={value(place, 'id')} />{value(place, 'description') && <p>{value(place, 'description')}</p>}{value(place, 'atmosphere_notes') && <p className="showcase-atmosphere">{value(place, 'atmosphere_notes')}</p>}
    </article>)}</div></Section>

    <Section id="ctx-glossary" title="Glossary" count={rows('glossary_entry').length}><div className="showcase-glossary">{rows('glossary_entry').map(entry => <div key={value(entry, 'id')}><strong>{value(entry, 'term')}</strong><p>{value(entry, 'definition')}</p><ReadOnlyReferenceImages images={rows('story_image')} entity="glossary" entityId={value(entry, 'id')} /></div>)}</div></Section>
  </div>
}

