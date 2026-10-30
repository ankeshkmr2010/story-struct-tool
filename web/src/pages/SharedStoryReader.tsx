import { ReadOnlyReferenceImages } from '../components/StoryImages'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { orderChapters, orderScenes } from '../api/ordering'
import { ManuscriptReading, type ReadingTarget, type ReadingPosition } from '../components/ManuscriptReading'
import { SANDBOX_ID } from '../sandbox/storage'
import { ReadOnlyTimeline } from '../components/ReadOnlyTimeline'
import { useStoryLiveUpdates } from '../components/useStoryLiveUpdates'
import { t } from '../i18n'

type Row = Record<string, unknown>
const value = (row: Row | undefined, field: string) => row?.[field] == null ? '' : String(row[field])
const ordered = (rows: Row[]) => orderScenes(rows)

export default function SharedStoryReader() {
  const { storyId = '' } = useParams()
  return <StoryReader key={storyId} storyId={storyId} />
}

export function StoryReader({ storyId, owned = false, embedded = false, openTarget, betaRoundId, onBetaFeedback, initialPosition, onPosition, beta }: { beta?: { back: { to: string; label: string }; details: ReactNode; actions: ReactNode }; storyId: string; owned?: boolean; embedded?: boolean; openTarget?: ReadingTarget; betaRoundId?: string; onBetaFeedback?: (chapterId: string, sceneId: string) => void; initialPosition?: ReadingPosition | null; onPosition?: (position: ReadingPosition) => void }) {
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

  if (document.isPending || me.isPending) return <p className="p-8">{t('Loading shared story…')}</p>
  if (document.isError) return <section className="shared-reader-page"><Link to="/library">{t('← Your stories')}</Link><h1 className="mt-6">{owned ? t('Reader unavailable') : t('Shared story unavailable')}</h1><p role="alert" className="writer-error">{errorText(document.error)}</p><p className="writer-help">{owned ? t('Refresh your story to read the latest saved manuscript.') : t('Use the account the author shared with. Access may have been revoked or the story moved to Trash.')}</p></section>

  const { share, structure } = document.data
  const rows = (kind: string): Row[] => structure[kind] ?? []
  const readerCover = rows('story_image').find(row => row.role === 'cover' && row.url)
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
    return [value(lookup('character', relationship?.character_a_id), 'name'), value(lookup('character', relationship?.character_b_id), 'name')].filter(Boolean).join(' & ') || t('Arc')
  }
  const chooseChapter = (id: string) => { setChapterId(id); setSceneId(null); setTarget({ chapterId: id, sequence: ++sequence.current }); setView('manuscript'); setChaptersOpen(false) }

  const Container = embedded ? 'section' : 'main'
  return <Container className={`shared-reader-page ${embedded ? 'reader-embedded' : ''} ${focus ? 'reader-focus' : ''}`}>
    {!embedded && <Link to={beta?.back.to ?? "/library"} className="writer-help">{beta?.back.label ?? t('← Your stories')}</Link>}
    <header className={`shared-reader-header${readerCover && !embedded ? ' has-cover' : ''}`}>{!embedded && readerCover && <img className="reader-cover" src={String(readerCover.url)} alt={String(readerCover.alt || '')} />}{!embedded && <div><p className="eyebrow">{betaRoundId ? t('BETA MANUSCRIPT · READ ONLY') : owned ? t('READ YOUR STORY · READ ONLY') : t('SHARED STORY · READ ONLY')}</p><h1>{share.title}</h1>{share.blurb && !beta && <p className="shared-reader-blurb">{share.blurb}</p>}<p className="writer-help">{betaRoundId ? t('By {0}. This draft is frozen for this beta round.', share.owner_name) : owned ? t('Read your current saved draft without editing it.') : t('By {0}. You’re reading the author’s current draft.', share.owner_name)}</p>{beta?.details}</div>}<div className="shared-reader-actions">{beta?.actions}{!owned && share.allow_import && <button type="button" className="sharing-primary" onClick={() => { imported.reset(); setImportFingerprint(document.data.base_fingerprint) }}>{t('Import a copy')}</button>}</div></header>
    <div className="reader-toolbar"><button type="button" className="share-story-button" aria-expanded={chaptersOpen} onClick={() => setChaptersOpen(!chaptersOpen)}>{t('Chapters')}</button>{/* In the workspace the Timeline is a side panel; shared readers get it here. */}{!embedded && !betaRoundId && <><button type="button" className="share-story-button" aria-pressed={view === 'manuscript'} onClick={() => { setTarget(undefined); setView('manuscript') }}>{t('Manuscript')}</button><button type="button" className="share-story-button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>{t('Timeline')}</button></>}<span className="writer-toolbar-spacer" /><button type="button" className="share-story-button" aria-pressed={focus} onClick={() => { setFocus(!focus); setContextOpen(false); setChaptersOpen(false); setView('manuscript') }}>{focus ? t('Exit focus') : t('Focus')}</button>{!betaRoundId && <button type="button" className="share-story-button" aria-expanded={contextOpen} onClick={() => setContextOpen(!contextOpen)}>{t('Context')}</button>}</div>
    <div className={`shared-reader-layout ${contextOpen && !focus ? 'reader-with-context' : ''}`}>
      <nav aria-label={t('Shared story chapters')} className={`reader-chapters ${chaptersOpen ? 'reader-chapters-open' : ''}`}><p className="eyebrow">{t('CHAPTERS')}</p>{chapters.map(item => <button key={value(item, 'id')} type="button" aria-current={chapter?.id === item.id ? 'page' : undefined} onClick={() => chooseChapter(value(item, 'id'))}><small>{t('Chapter {0}', value(item, 'number'))}</small><strong>{value(item, 'title') || t('Untitled chapter')}</strong></button>)}{rows('scene').some(item => item.chapter_id === null) && <button type="button" aria-current={!chapter ? 'page' : undefined} onClick={() => chooseChapter('unfiled')}>{t('Unfiled writing')}</button>}</nav>
      <article className={`reader-manuscript ${view === 'manuscript' ? 'reader-book-shell' : ''}`} aria-label={t('Shared manuscript')}>
        {view === 'manuscript' ? <ManuscriptReading initialPosition={initialPosition} onPosition={onPosition} structure={structure} storyId={betaRoundId ? `beta:${betaRoundId}` : storyId} contextLabel={betaRoundId ? t('Leave scene feedback') : undefined} contextAvailable={!betaRoundId} accountId={me.data?.id ?? 'signed-in'} target={target} onPassage={(chapterId, sceneId) => { setChapterId(chapterId); setSceneId(sceneId || null) }} onContext={(chapterId, sceneId) => { if (betaRoundId) { onBetaFeedback?.(chapterId, sceneId); return } setChapterId(chapterId); setSceneId(sceneId); setContextOpen(true); setFocus(false) }} /> : <><h2>{t('Story timeline')}</h2><ReadOnlyTimeline entries={document.data.timeline?.entries ?? []} onOpenScene={(sceneId) => { const linked = lookup('scene', sceneId); if (linked) { setChapterId(value(linked, 'chapter_id') || 'unfiled'); setSceneId(value(linked, 'id')); setTarget({ sceneId: value(linked, 'id'), sequence: ++sequence.current }); setView('manuscript') } }} /></>}
      </article>
      {contextOpen && !focus && <aside className="reader-context" aria-label={t('Read-only story context')}><div className="sharing-heading"><h2>{t('Story context')}</h2><button type="button" aria-label={t('Close story context')} className="share-story-button" onClick={() => setContextOpen(false)}>×</button></div><p className="writer-help">{owned ? t('Reading context only. Switch to Write or Design to make changes.') : t('Context only. Changes to this story belong to its author.')}</p><h3>{value(scene, 'title') || t('Current scene')}</h3><dl className="reader-context-fields">{[[t('POV'), value(lookup('character', scene?.pov_character_id), 'name')], [t('People'), participants.map(person => value(person, 'name')).join(', ')], [t('Location'), value(lookup('location', scene?.location_id), 'name') || value(scene, 'location')], [t('Story time'), value(scene, 'time_label')], [t('Goal'), value(scene, 'goal')], [t('Conflict'), value(scene, 'conflict')], [t('Outcome'), value(scene, 'outcome')]].filter(([, text]) => Boolean(text)).map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
        <ReadOnlyReferenceImages images={rows('story_image')} entity="scene" entityId={value(scene, 'id')} /><ReadOnlyReferenceImages images={rows('story_image')} entity="location" entityId={value(scene, 'location_id')} /><h3>{t('Beats in this chapter / scene')}</h3>{beats.length ? beats.map(beat => <div key={value(beat, 'id')} className="reader-context-card"><strong>{value(beat, 'label')}</strong><p>{value(beat, 'description')}</p></div>) : <p className="writer-help">{t('No beats linked here yet.')}</p>}
        <h3>{t('Arc stages advanced here')}</h3>{arcStages.length ? arcStages.map(stage => <div key={value(stage, 'id')} className="reader-context-card"><strong>{arcOwner(lookup('arc', stage.arc_id))}: {value(stage, 'label')}</strong><p>{value(stage, 'description')}</p></div>) : <p className="writer-help">{t('No arc stages linked to this scene.')}</p>}
        <details><summary>{t('All arcs ({0})', rows('arc').length)}</summary>{rows('arc').map(arc => <div key={value(arc, 'id')} className="reader-context-card"><strong>{arcOwner(arc)}</strong><ol>{ordered(rows('arc_stage').filter(stage => stage.arc_id === arc.id)).map(stage => <li key={value(stage, 'id')}>{value(stage, 'label')}{value(stage, 'description') && <p>{value(stage, 'description')}</p>}</li>)}</ol><p>{value(arc, 'resolution')}</p></div>)}</details>
        <details><summary>{t('All beats ({0})', rows('beat').length)}</summary>{rows('beat').map(beat => <div key={value(beat, 'id')} className="reader-context-card"><strong>{value(beat, 'label')}</strong><p>{value(lookup('act', beat.act_id), 'title')}</p><p>{value(beat, 'description')}</p></div>)}</details>
        <details><summary>{t('Characters ({0})', rows('character').length)}</summary>{rows('character').map(person => <div key={value(person, 'id')} className="reader-context-card"><strong>{value(person, 'name')} · {value(person, 'role')}</strong><ReadOnlyReferenceImages images={rows('story_image')} entity="character" entityId={value(person, 'id')} />{['want', 'need', 'misbelief', 'wound'].filter(field => person[field]).map(field => <p key={field}><b>{field}: </b>{value(person, field)}</p>)}</div>)}</details>
        <details><summary>{t('Glossary ({0})', rows('glossary_entry').length)}</summary>{[...rows('glossary_entry')].sort((a, b) => value(a, 'term').localeCompare(value(b, 'term'))).map(item => <div key={value(item, 'id')} className="reader-context-card"><strong>{value(item, 'term')}</strong>{Array.isArray(item.aliases) && item.aliases.length > 0 && <p>{item.aliases.join(' · ')}</p>}<p>{value(item, 'definition')}</p><ReadOnlyReferenceImages images={rows('story_image')} entity="glossary" entityId={value(item, 'id')} /></div>)}</details>
        <details><summary>{t('Threads ({0})', rows('thread').length)}</summary>{rows('thread').map(thread => <div key={value(thread, 'id')} className="reader-context-card"><strong>{value(thread, 'title')}</strong><p>{value(thread, 'type')}</p></div>)}</details>
      </aside>}
    </div>
    <dialog ref={importDialog} className="story-sharing-dialog" aria-labelledby="import-story-title" onClose={() => setImportFingerprint(null)}><h2 id="import-story-title">{t('Import an independent copy?')}</h2><p className="writer-help">{t('Copy “{0}” into your stories with its current prose, structure, arcs, and timeline. You can edit your copy. The original stays with {1}; later changes won’t sync. Private notes, past versions, and AI conversations aren’t imported.', share.title, share.owner_name)}</p>{imported.isError && <p role="alert" className="writer-error">{errorText(imported.error)}</p>}<div className="shared-reader-actions"><button type="button" className="share-story-button" disabled={imported.isPending} onClick={() => setImportFingerprint(null)}>{t('Cancel')}</button><button type="button" className="sharing-primary" disabled={imported.isPending || !importFingerprint} onClick={() => { if (importFingerprint) imported.mutate(importFingerprint) }}>{imported.isPending ? t('Importing…') : t('Import copy')}</button>{imported.isError && <button type="button" className="share-story-button" onClick={() => { setImportFingerprint(null); void document.refetch() }}>{t('Refresh shared story')}</button>}</div></dialog>
  </Container>
}
