import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'

type Row = Record<string, unknown>
const value = (row: Row | undefined, field: string) => row?.[field] == null ? '' : String(row[field])
const ordered = (rows: Row[]) => [...rows].sort((a, b) => Number(a.sort_key ?? 0) - Number(b.sort_key ?? 0))

export default function SharedStoryReader() {
  const { storyId = '' } = useParams()
  return <Reader key={storyId} storyId={storyId} />
}

function Reader({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const document = useQuery({ queryKey: ['shared-document', storyId], queryFn: () => api.readSharedStory(storyId), retry: false })
  const [chapterId, setChapterId] = useState<string | null>(null)
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(() => window.matchMedia('(min-width: 1101px)').matches)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [view, setView] = useState<'manuscript' | 'timeline'>('manuscript')
  const [importFingerprint, setImportFingerprint] = useState<string | null>(null)
  const importDialog = useRef<HTMLDialogElement>(null)
  const imported = useMutation({ mutationFn: (fingerprint: string) => api.importSharedStory(storyId, fingerprint), onSuccess: story => { void qc.invalidateQueries({ queryKey: ['stories'] }); navigate(`/stories/${story.id}`) } })
  useEffect(() => { if (importFingerprint) importDialog.current?.showModal(); else importDialog.current?.close() }, [importFingerprint])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setContextOpen(false); setChaptersOpen(false) } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])

  if (document.isPending) return <p className="p-8">Loading shared story…</p>
  if (document.isError) return <main className="shared-reader-page"><Link to="/library">← Your stories</Link><h1 className="mt-6">Shared story unavailable</h1><p role="alert" className="writer-error">{errorText(document.error)}</p><p className="writer-help">Use the account the author shared with. The author may have revoked access or moved the story to Trash.</p></main>

  const { share, structure } = document.data
  const rows = (kind: string): Row[] => structure[kind] ?? []
  const lookup = (kind: string, id: unknown) => rows(kind).find(row => row.id === id)
  const chapters = ordered(rows('chapter'))
  const chapter = chapters.find(item => item.id === chapterId) ?? (chapterId === 'unfiled' ? undefined : chapters[0])
  const scenes = ordered(rows('scene').filter(item => item.chapter_id === (chapter?.id ?? null)))
  const scene = scenes.find(item => item.id === sceneId) ?? scenes[0]
  const sceneBeats = rows('scene_beat').filter(link => link.scene_id === scene?.id).map(link => link.beat_id)
  const chapterBeats = rows('chapter_beat').filter(link => link.chapter_id === chapter?.id).map(link => link.beat_id)
  const beats = rows('beat').filter(beat => [...sceneBeats, ...chapterBeats].includes(beat.id))
  const arcStages = rows('scene_arc_advance').filter(link => link.scene_id === scene?.id).map(link => lookup('arc_stage', link.arc_stage_id)).filter((stage): stage is Row => Boolean(stage))
  const participants = rows('scene_presence').filter(link => link.scene_id === scene?.id && !link.is_rejected).map(link => lookup('character', link.character_id)).filter((person): person is Row => Boolean(person))
  const arcOwner = (arc: Row | undefined) => {
    if (arc?.character_id) return value(lookup('character', arc.character_id), 'name')
    if (arc?.thread_id) return value(lookup('thread', arc.thread_id), 'title')
    const relationship = lookup('relationship', arc?.relationship_id)
    return [value(lookup('character', relationship?.character_a_id), 'name'), value(lookup('character', relationship?.character_b_id), 'name')].filter(Boolean).join(' & ') || 'Arc'
  }
  const events = [...rows('event')].sort((a, b) => Number(a.sort_ordinal ?? Number.MAX_SAFE_INTEGER) - Number(b.sort_ordinal ?? Number.MAX_SAFE_INTEGER))
  const chooseChapter = (id: string) => { setChapterId(id); setSceneId(null); setView('manuscript'); setChaptersOpen(false) }

  return <main className="shared-reader-page">
    <Link to="/library" className="writer-help">← Your stories</Link>
    <header className="shared-reader-header"><div><p className="eyebrow">SHARED STORY · READ ONLY</p><h1>{share.title}</h1><p className="writer-help">By {share.owner_name}. You’re reading the author’s current draft.</p></div><div className="shared-reader-actions"><button type="button" className="share-story-button" disabled={document.isFetching} onClick={() => { void document.refetch() }}>Refresh story</button>{share.allow_import && <button type="button" className="sharing-primary" onClick={() => { imported.reset(); setImportFingerprint(document.data.base_fingerprint) }}>Import a copy</button>}</div></header>
    {share.premise && <p className="shared-reader-premise">{share.premise}</p>}
    <div className="reader-toolbar"><button type="button" className="share-story-button" aria-expanded={chaptersOpen} onClick={() => setChaptersOpen(!chaptersOpen)}>Chapters</button><button type="button" className="share-story-button" aria-pressed={view === 'manuscript'} onClick={() => setView('manuscript')}>Manuscript</button><button type="button" className="share-story-button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</button><span className="writer-toolbar-spacer" /><button type="button" className="share-story-button" aria-expanded={contextOpen} onClick={() => setContextOpen(!contextOpen)}>Context</button></div>
    <div className={`shared-reader-layout ${contextOpen ? 'reader-with-context' : ''}`}>
      <nav aria-label="Shared story chapters" className={`reader-chapters ${chaptersOpen ? 'reader-chapters-open' : ''}`}><p className="eyebrow">CHAPTERS</p>{chapters.map(item => <button key={value(item, 'id')} type="button" aria-current={chapter?.id === item.id ? 'page' : undefined} onClick={() => chooseChapter(value(item, 'id'))}><small>Chapter {value(item, 'number')}</small><strong>{value(item, 'title') || 'Untitled chapter'}</strong></button>)}{rows('scene').some(item => item.chapter_id === null) && <button type="button" aria-current={!chapter ? 'page' : undefined} onClick={() => chooseChapter('unfiled')}>Unfiled writing</button>}</nav>
      <article className="reader-manuscript" aria-label="Shared manuscript">
        {view === 'manuscript' ? <><p className="eyebrow">{chapter ? `CHAPTER ${value(chapter, 'number')}` : 'UNFILED WRITING'}</p><h2>{value(chapter, 'title')}</h2>{scenes.length === 0 && <p className="writer-help">This chapter has no scenes yet.</p>}{scenes.map((item, index) => <section key={value(item, 'id')} className="reader-scene">{index > 0 && <div className="writer-scene-break">⁂</div>}<button type="button" className="reader-scene-label" aria-pressed={scene?.id === item.id} onClick={() => { setSceneId(value(item, 'id')); setContextOpen(true) }}>{value(item, 'title') || `Scene ${index + 1}`}<span>View context →</span></button>{value(item, 'content').trim() ? <div className="reader-prose">{value(item, 'content')}</div> : <p className="writer-help">This scene hasn’t been drafted yet.</p>}</section>)}</> : <><p className="eyebrow">WORLD TIME</p><h2>Story timeline</h2><p className="writer-help">Events follow when they happen in the world. The manuscript keeps the author’s reading order, including flashbacks.</p><ol className="reader-timeline">{events.map(event => <li key={value(event, 'id')}><small>{value(event, 'time_label') || (event.sort_ordinal == null ? 'Time not specified' : `Story time ${value(event, 'sort_ordinal')}`)}</small><h3>{value(event, 'label')}</h3><p>{value(lookup('location', event.location_id), 'name') || value(event, 'location')}</p><p>{rows('event_character').filter(link => link.event_id === event.id).map(link => value(lookup('character', link.character_id), 'name')).filter(Boolean).join(' · ')}</p>{event.scene_id != null && <button type="button" className="share-story-button" onClick={() => { const linked = lookup('scene', event.scene_id); if (linked) { setChapterId(value(linked, 'chapter_id') || 'unfiled'); setSceneId(value(linked, 'id')); setView('manuscript') } }}>Read linked scene</button>}</li>)}</ol>{events.length === 0 && <p className="writer-help">No timeline events have been added.</p>}</>}
      </article>
      {contextOpen && <aside className="reader-context" aria-label="Read-only story context"><div className="sharing-heading"><h2>Story context</h2><button type="button" aria-label="Close story context" className="share-story-button" onClick={() => setContextOpen(false)}>×</button></div><p className="writer-help">Context only. Changes to this story belong to its author.</p><h3>{value(scene, 'title') || 'Current scene'}</h3><dl className="reader-context-fields">{[['POV', value(lookup('character', scene?.pov_character_id), 'name')], ['People', participants.map(person => value(person, 'name')).join(', ')], ['Location', value(lookup('location', scene?.location_id), 'name') || value(scene, 'location')], ['Story time', value(scene, 'time_label')], ['Goal', value(scene, 'goal')], ['Conflict', value(scene, 'conflict')], ['Outcome', value(scene, 'outcome')]].filter(([, text]) => Boolean(text)).map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
        <h3>Beats in this chapter / scene</h3>{beats.length ? beats.map(beat => <div key={value(beat, 'id')} className="reader-context-card"><strong>{value(beat, 'label')}</strong><p>{value(beat, 'description')}</p></div>) : <p className="writer-help">No beats linked here yet.</p>}
        <h3>Arc stages advanced here</h3>{arcStages.length ? arcStages.map(stage => <div key={value(stage, 'id')} className="reader-context-card"><strong>{arcOwner(lookup('arc', stage.arc_id))}: {value(stage, 'label')}</strong><p>{value(stage, 'description')}</p></div>) : <p className="writer-help">No arc stages linked to this scene.</p>}
        <details><summary>All arcs ({rows('arc').length})</summary>{rows('arc').map(arc => <div key={value(arc, 'id')} className="reader-context-card"><strong>{arcOwner(arc)}</strong><ol>{ordered(rows('arc_stage').filter(stage => stage.arc_id === arc.id)).map(stage => <li key={value(stage, 'id')}>{value(stage, 'label')}{value(stage, 'description') && <p>{value(stage, 'description')}</p>}</li>)}</ol><p>{value(arc, 'resolution')}</p></div>)}</details>
        <details><summary>All beats ({rows('beat').length})</summary>{rows('beat').map(beat => <div key={value(beat, 'id')} className="reader-context-card"><strong>{value(beat, 'label')}</strong><p>{value(lookup('act', beat.act_id), 'title')}</p><p>{value(beat, 'description')}</p></div>)}</details>
        <details><summary>Characters ({rows('character').length})</summary>{rows('character').map(person => <div key={value(person, 'id')} className="reader-context-card"><strong>{value(person, 'name')} · {value(person, 'role')}</strong>{['want', 'need', 'misbelief', 'wound'].filter(field => person[field]).map(field => <p key={field}><b>{field}: </b>{value(person, field)}</p>)}</div>)}</details>
        <details><summary>Threads ({rows('thread').length})</summary>{rows('thread').map(thread => <div key={value(thread, 'id')} className="reader-context-card"><strong>{value(thread, 'title')}</strong><p>{value(thread, 'type')}</p></div>)}</details>
      </aside>}
    </div>
    <dialog ref={importDialog} className="story-sharing-dialog" aria-labelledby="import-story-title" onClose={() => setImportFingerprint(null)}><h2 id="import-story-title">Import an independent copy?</h2><p className="writer-help">Copy “{share.title}” into your stories with its current prose, structure, arcs, and timeline. You can edit your copy. The original stays with {share.owner_name}; later changes won’t sync. Private notes, past versions, and AI conversations aren’t imported.</p>{imported.isError && <p role="alert" className="writer-error">{errorText(imported.error)}</p>}<div className="shared-reader-actions"><button type="button" className="share-story-button" disabled={imported.isPending} onClick={() => setImportFingerprint(null)}>Cancel</button><button type="button" className="sharing-primary" disabled={imported.isPending || !importFingerprint} onClick={() => { if (importFingerprint) imported.mutate(importFingerprint) }}>{imported.isPending ? 'Importing…' : 'Import copy'}</button>{imported.isError && <button type="button" className="share-story-button" onClick={() => { setImportFingerprint(null); void document.refetch() }}>Refresh shared story</button>}</div></dialog>
  </main>
}
