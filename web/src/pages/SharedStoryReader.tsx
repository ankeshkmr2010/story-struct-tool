import { ReadOnlyReferenceImages } from '../components/StoryImages'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { orderChapters, orderScenes } from '../api/ordering'
import { ManuscriptReading, type ReadingTarget } from '../components/ManuscriptReading'
import { SANDBOX_ID } from '../sandbox/storage'
import { ReadOnlyTimeline } from '../components/ReadOnlyTimeline'
import { useStoryLiveUpdates } from '../components/useStoryLiveUpdates'

type Row = Record<string, unknown>
const value = (row: Row | undefined, field: string) => row?.[field] == null ? '' : String(row[field])
const ordered = (rows: Row[]) => orderScenes(rows)

export default function SharedStoryReader() {
  const { storyId = '' } = useParams()
  return <StoryReader key={storyId} storyId={storyId} />
}

export function StoryReader({ storyId, owned = false, embedded = false, openTarget, betaRoundId, onBetaFeedback }: { storyId: string; owned?: boolean; embedded?: boolean; openTarget?: ReadingTarget; betaRoundId?: string; onBetaFeedback?: (chapterId: string, sceneId: string) => void }) {
  useStoryLiveUpdates(storyId, !owned, !embedded && !betaRoundId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const document = useQuery({ queryKey: betaRoundId ? ['beta-document', betaRoundId] : [owned ? 'reading-document' : 'shared-document', storyId], queryFn: () => betaRoundId ? api.readBetaRound(betaRoundId) : owned ? api.readOwnedStory(storyId) : api.readSharedStory(storyId), retry: false })
  const me = useQuery({ queryKey: [storyId === SANDBOX_ID ? 'sandbox-me' : 'me'], queryFn: api.currentUser })
  const [focus, setFocus] = useState(false)
  const [target, setTarget] = useState<ReadingTarget | undefined>(undefined)
  const sequence = useRef(0)
  const [chapterId, setChapterId] = useState<string | null>(null)
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [view, setView] = useState<'manuscript' | 'timeline'>('manuscript')
  useEffect(() => {
    if (openTarget) { setTarget(openTarget); setSceneId(openTarget.sceneId ?? null); setView('manuscript') }
  }, [openTarget])
  const [importFingerprint, setImportFingerprint] = useState<string | null>(null)
  const importDialog = useRef<HTMLDialogElement>(null)
  const imported = useMutation({ mutationFn: (fingerprint: string) => api.importSharedStory(storyId, fingerprint), onSuccess: story => { void qc.invalidateQueries({ queryKey: ['stories'] }); navigate(`/stories/${story.id}`) } })
  useEffect(() => { if (importFingerprint) importDialog.current?.showModal(); else importDialog.current?.close() }, [importFingerprint])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setContextOpen(false); setChaptersOpen(false); setFocus(false) } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])

  if (document.isPending || me.isPending) return <p className="p-8">Loading shared story…</p>
  if (document.isError) return <section className="shared-reader-page"><Link to="/library">← Your stories</Link><h1 className="mt-6">{owned ? 'Reader unavailable' : 'Shared story unavailable'}</h1><p role="alert" className="writer-error">{errorText(document.error)}</p><p className="writer-help">{owned ? 'Refresh your story to read the latest saved manuscript.' : 'Use the account the author shared with. Access may have been revoked or the story moved to Trash.'}</p></section>

  const { share, structure } = document.data
  const rows = (kind: string): Row[] => structure[kind] ?? []
  const lookup = (kind: string, id: unknown) => rows(kind).find(row => row.id === id)
  const chapters = orderChapters(rows('chapter'))
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
  const chooseChapter = (id: string) => { setChapterId(id); setSceneId(null); setTarget({ chapterId: id, sequence: ++sequence.current }); setView('manuscript'); setChaptersOpen(false) }

  const Container = embedded ? 'section' : 'main'
  return <Container className={`shared-reader-page ${embedded ? 'reader-embedded' : ''} ${focus ? 'reader-focus' : ''}`}>
    {!embedded && <Link to="/library" className="writer-help">← Your stories</Link>}
    <header className="shared-reader-header">{!embedded && <div><p className="eyebrow">{betaRoundId ? 'BETA MANUSCRIPT · READ ONLY' : owned ? 'READ YOUR STORY · READ ONLY' : 'SHARED STORY · READ ONLY'}</p><h1>{share.title}</h1>{share.blurb && <p className="shared-reader-blurb">{share.blurb}</p>}<p className="writer-help">{betaRoundId ? `By ${share.owner_name}. This draft is frozen for this beta round.` : owned ? 'Read your current saved draft without editing it.' : `By ${share.owner_name}. You’re reading the author’s current draft.`}</p></div>}<div className="shared-reader-actions">{!owned && share.allow_import && <button type="button" className="sharing-primary" onClick={() => { imported.reset(); setImportFingerprint(document.data.base_fingerprint) }}>Import a copy</button>}</div></header>
    <div className="reader-toolbar"><button type="button" className="share-story-button" aria-expanded={chaptersOpen} onClick={() => setChaptersOpen(!chaptersOpen)}>Chapters</button>{/* In the workspace the Timeline is a side panel; shared readers get it here. */}{!embedded && !betaRoundId && <><button type="button" className="share-story-button" aria-pressed={view === 'manuscript'} onClick={() => { setTarget(undefined); setView('manuscript') }}>Manuscript</button><button type="button" className="share-story-button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</button></>}<span className="writer-toolbar-spacer" /><button type="button" className="share-story-button" aria-pressed={focus} onClick={() => { setFocus(!focus); setContextOpen(false); setChaptersOpen(false); setView('manuscript') }}>{focus ? 'Exit focus' : 'Focus'}</button>{!betaRoundId && <button type="button" className="share-story-button" aria-expanded={contextOpen} onClick={() => setContextOpen(!contextOpen)}>Context</button>}</div>
    <div className={`shared-reader-layout ${contextOpen && !focus ? 'reader-with-context' : ''}`}>
      <nav aria-label="Shared story chapters" className={`reader-chapters ${chaptersOpen ? 'reader-chapters-open' : ''}`}><p className="eyebrow">CHAPTERS</p>{chapters.map(item => <button key={value(item, 'id')} type="button" aria-current={chapter?.id === item.id ? 'page' : undefined} onClick={() => chooseChapter(value(item, 'id'))}><small>Chapter {value(item, 'number')}</small><strong>{value(item, 'title') || 'Untitled chapter'}</strong></button>)}{rows('scene').some(item => item.chapter_id === null) && <button type="button" aria-current={!chapter ? 'page' : undefined} onClick={() => chooseChapter('unfiled')}>Unfiled writing</button>}</nav>
      <article className={`reader-manuscript ${view === 'manuscript' ? 'reader-book-shell' : ''}`} aria-label="Shared manuscript">
        {view === 'manuscript' ? <ManuscriptReading structure={structure} storyId={betaRoundId ? `beta:${betaRoundId}` : storyId} contextLabel={betaRoundId ? "Leave scene feedback" : undefined} contextAvailable={!betaRoundId || !!onBetaFeedback} accountId={me.data?.id ?? 'signed-in'} target={target} onPassage={(chapterId, sceneId) => { setChapterId(chapterId); setSceneId(sceneId || null) }} onContext={(chapterId, sceneId) => { if (betaRoundId) { onBetaFeedback?.(chapterId, sceneId); return } setChapterId(chapterId); setSceneId(sceneId); setContextOpen(true); setFocus(false) }} /> : <><h2>Story timeline</h2><ReadOnlyTimeline entries={document.data.timeline?.entries ?? []} onOpenScene={(sceneId) => { const linked = lookup('scene', sceneId); if (linked) { setChapterId(value(linked, 'chapter_id') || 'unfiled'); setSceneId(value(linked, 'id')); setTarget({ sceneId: value(linked, 'id'), sequence: ++sequence.current }); setView('manuscript') } }} /></>}
      </article>
      {contextOpen && !focus && <aside className="reader-context" aria-label="Read-only story context"><div className="sharing-heading"><h2>Story context</h2><button type="button" aria-label="Close story context" className="share-story-button" onClick={() => setContextOpen(false)}>×</button></div><p className="writer-help">{owned ? 'Reading context only. Switch to Write or Design to make changes.' : 'Context only. Changes to this story belong to its author.'}</p><h3>{value(scene, 'title') || 'Current scene'}</h3><dl className="reader-context-fields">{[['POV', value(lookup('character', scene?.pov_character_id), 'name')], ['People', participants.map(person => value(person, 'name')).join(', ')], ['Location', value(lookup('location', scene?.location_id), 'name') || value(scene, 'location')], ['Story time', value(scene, 'time_label')], ['Goal', value(scene, 'goal')], ['Conflict', value(scene, 'conflict')], ['Outcome', value(scene, 'outcome')]].filter(([, text]) => Boolean(text)).map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
        <ReadOnlyReferenceImages images={rows('story_image')} entity="scene" entityId={value(scene, 'id')} /><ReadOnlyReferenceImages images={rows('story_image')} entity="location" entityId={value(scene, 'location_id')} /><h3>Beats in this chapter / scene</h3>{beats.length ? beats.map(beat => <div key={value(beat, 'id')} className="reader-context-card"><strong>{value(beat, 'label')}</strong><p>{value(beat, 'description')}</p></div>) : <p className="writer-help">No beats linked here yet.</p>}
        <h3>Arc stages advanced here</h3>{arcStages.length ? arcStages.map(stage => <div key={value(stage, 'id')} className="reader-context-card"><strong>{arcOwner(lookup('arc', stage.arc_id))}: {value(stage, 'label')}</strong><p>{value(stage, 'description')}</p></div>) : <p className="writer-help">No arc stages linked to this scene.</p>}
        <details><summary>All arcs ({rows('arc').length})</summary>{rows('arc').map(arc => <div key={value(arc, 'id')} className="reader-context-card"><strong>{arcOwner(arc)}</strong><ol>{ordered(rows('arc_stage').filter(stage => stage.arc_id === arc.id)).map(stage => <li key={value(stage, 'id')}>{value(stage, 'label')}{value(stage, 'description') && <p>{value(stage, 'description')}</p>}</li>)}</ol><p>{value(arc, 'resolution')}</p></div>)}</details>
        <details><summary>All beats ({rows('beat').length})</summary>{rows('beat').map(beat => <div key={value(beat, 'id')} className="reader-context-card"><strong>{value(beat, 'label')}</strong><p>{value(lookup('act', beat.act_id), 'title')}</p><p>{value(beat, 'description')}</p></div>)}</details>
        <details><summary>Characters ({rows('character').length})</summary>{rows('character').map(person => <div key={value(person, 'id')} className="reader-context-card"><strong>{value(person, 'name')} · {value(person, 'role')}</strong><ReadOnlyReferenceImages images={rows('story_image')} entity="character" entityId={value(person, 'id')} />{['want', 'need', 'misbelief', 'wound'].filter(field => person[field]).map(field => <p key={field}><b>{field}: </b>{value(person, field)}</p>)}</div>)}</details>
        <details><summary>Glossary ({rows('glossary_entry').length})</summary>{[...rows('glossary_entry')].sort((a, b) => value(a, 'term').localeCompare(value(b, 'term'))).map(item => <div key={value(item, 'id')} className="reader-context-card"><strong>{value(item, 'term')}</strong>{Array.isArray(item.aliases) && item.aliases.length > 0 && <p>{item.aliases.join(' · ')}</p>}<p>{value(item, 'definition')}</p><ReadOnlyReferenceImages images={rows('story_image')} entity="glossary" entityId={value(item, 'id')} /></div>)}</details>
        <details><summary>Threads ({rows('thread').length})</summary>{rows('thread').map(thread => <div key={value(thread, 'id')} className="reader-context-card"><strong>{value(thread, 'title')}</strong><p>{value(thread, 'type')}</p></div>)}</details>
      </aside>}
    </div>
    <dialog ref={importDialog} className="story-sharing-dialog" aria-labelledby="import-story-title" onClose={() => setImportFingerprint(null)}><h2 id="import-story-title">Import an independent copy?</h2><p className="writer-help">Copy “{share.title}” into your stories with its current prose, structure, arcs, and timeline. You can edit your copy. The original stays with {share.owner_name}; later changes won’t sync. Private notes, past versions, and AI conversations aren’t imported.</p>{imported.isError && <p role="alert" className="writer-error">{errorText(imported.error)}</p>}<div className="shared-reader-actions"><button type="button" className="share-story-button" disabled={imported.isPending} onClick={() => setImportFingerprint(null)}>Cancel</button><button type="button" className="sharing-primary" disabled={imported.isPending || !importFingerprint} onClick={() => { if (importFingerprint) imported.mutate(importFingerprint) }}>{imported.isPending ? 'Importing…' : 'Import copy'}</button>{imported.isError && <button type="button" className="share-story-button" onClick={() => { setImportFingerprint(null); void document.refetch() }}>Refresh shared story</button>}</div></dialog>
  </Container>
}
