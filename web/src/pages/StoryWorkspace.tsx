import { Suspense, lazy, useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { Ladder, type AuthoringMode } from '../components/Ladder'
import { ChapterBriefCard } from '../components/ChapterBriefCard'
import { InsightsPanel } from '../components/InsightsPanel'
import { PlacesPanel } from '../components/PlacesPanel'
import { GlossaryPanel } from '../components/GlossaryPanel'
import { CharactersPanel } from '../components/CharactersPanel'
import { ActsPanel, BeatsPanel, EventsPanel, ThreadsPanel } from '../components/StructurePanels'
import { AddForm, Chip, DeleteButton, InlineNumber, InlineSelect, InlineText } from '../components/fields'
import { SceneDetails } from '../components/SceneDetails'
import { StoryTimeline } from '../components/StoryTimeline'
import { AuthoringAssistant } from '../components/AuthoringAssistant'
import { ProposalInbox, isTestRun } from '../components/ProposalInbox'
import { TutorialWalkthrough } from '../components/TutorialWalkthrough'
import { StoryVersions } from '../components/StoryVersions'
import { AuthorshipPanel } from '../components/AuthorshipPanel'
import { StorySharing } from '../components/StorySharing'
import { useStoryLiveUpdates } from '../components/useStoryLiveUpdates'
// Lazy: CodeMirror is the largest dependency in the app and is only needed once the
// author reaches level 8, so it should not sit in the initial bundle.
const SceneEditor = lazy(() =>
  import('../components/SceneEditor').then((m) => ({ default: m.SceneEditor })),
)
const StoryWriter = lazy(() => import('../components/StoryWriter').then(m => ({ default: m.StoryWriter })))
const StoryReader = lazy(() => import('./SharedStoryReader').then(m => ({ default: m.StoryReader })))

const MODES: AuthoringMode[] = ['plotter', 'hybrid', 'pantser']

// Places are reference data, not a rung. The sentinel keeps them out of the ladder's
// readiness logic entirely.
const PLACES_VIEW = 100
const TIMELINE_VIEW = 101
const ASSISTANT_VIEW = 102
const GLOSSARY_VIEW = 103
const INBOX_VIEW = 104

export default function StoryWorkspace() {
  const { storyId = '' } = useParams()
  return <Workspace key={storyId} />
}

function Workspace() {
  const { storyId = '' } = useParams()
  const qc = useQueryClient()
  const live = useStoryLiveUpdates(storyId)
  const [level, setLevel] = useState(1)
  const [tab, setTab] = useState<'write' | 'read' | 'design'>(() => {
    try { const saved = localStorage.getItem(`storytool-workspace:${storyId}`); return saved === 'write' || saved === 'read' ? saved : 'design' } catch { return 'design' }
  })
  const [writerOpened, setWriterOpened] = useState(tab === 'write')
  const [tabError, setTabError] = useState<string | null>(null)
  const writerFlush = useRef<() => Promise<boolean>>(async () => true)
  const registerFlush = useCallback((flush: () => Promise<boolean>) => { writerFlush.current = flush }, [])
  const changeTab = async (next: 'write' | 'read' | 'design') => {
    if (next === tab) return
    if (tab === 'write' && !await writerFlush.current()) { setTabError('Your writing has not saved yet. Retry the save before switching workspaces.'); return }
    setTabError(null); setTab(next)
    if (next === 'write') {
      setWriterOpened(true)
      void qc.invalidateQueries({ queryKey: ['content', storyId] })
    }
    if (next === 'read') void qc.invalidateQueries({ queryKey: ['reading-document', storyId] })
    try { localStorage.setItem(`storytool-workspace:${storyId}`, next) } catch { /* Preference storage is optional. */ }
  }

  const story = useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) })
  const ladder = useQuery({ queryKey: ['ladder', storyId], queryFn: () => api.getLadder(storyId) })
  const pending = useQuery({ queryKey: ['ai-runs', storyId, 'pending'], queryFn: () => api.listAIRuns(storyId, 'proposed', 200) })
  const pendingRuns = pending.data?.filter((run) => !isTestRun(run)).length ?? 0
  const health = useQuery({
    queryKey: ['health', storyId, level],
    queryFn: () => api.getHealth(storyId, Math.min(level, 8)),
  })
  const characters = useQuery({
    queryKey: ['characters', storyId],
    queryFn: () => api.listCharacters(storyId),
  })
  const acts = useQuery({ queryKey: ['acts', storyId], queryFn: () => api.listActs(storyId) })
  const beats = useQuery({ queryKey: ['beats', storyId], queryFn: () => api.listBeats(storyId) })
  const chapters = useQuery({
    queryKey: ['chapters', storyId],
    queryFn: () => api.listChapters(storyId),
  })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })

  const [chapterId, setChapterId] = useState<string | null>(null)
  const selectedChapter = chapters.data?.find((chapter) => chapter.id === chapterId)?.id ?? chapters.data?.[0]?.id ?? null
  const chapter = chapters.data?.find((item) => item.id === selectedChapter)
  const chapterIndex = chapters.data?.findIndex((item) => item.id === selectedChapter) ?? -1

  const brief = useQuery({
    queryKey: ['brief', storyId, selectedChapter],
    queryFn: () => api.getBrief(storyId, selectedChapter!),
    enabled: Boolean(selectedChapter),
  })

  const [sceneId, setSceneId] = useState<string | null>(null)
  const selectedScene = scenes.data?.find((s) => s.id === sceneId)
    ?? scenes.data?.find((s) => s.chapter_id === selectedChapter)
    ?? scenes.data?.[0]
    ?? null
  const sceneSiblings = scenes.data?.filter((item) => item.chapter_id === selectedScene?.chapter_id) ?? []
  const sceneIndex = sceneSiblings.findIndex((item) => item.id === selectedScene?.id)
  const sceneBrief = useQuery({
    queryKey: ['brief', storyId, selectedScene?.chapter_id],
    queryFn: () => api.getBrief(storyId, selectedScene!.chapter_id!),
    enabled: Boolean(selectedScene?.chapter_id),
  })

  const progress = useQuery({
    queryKey: ['progress', storyId],
    queryFn: () => api.getProgress(storyId),
  })

  // Any write can change readiness and health, so invalidate both every time.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ladder', storyId] })
    void qc.invalidateQueries({ queryKey: ['health', storyId] })
  }

  const updateStory = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateStory(storyId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['story', storyId] })
      refresh()
    },
  })

  const addChapter = useMutation({
    mutationFn: (title: string) =>
      api.createChapter(storyId, {
        number: Math.max(0, ...(chapters.data ?? []).map((chapter) => chapter.number)) + 1,
        title,
        // Continue in the selected chapter's act, or use the last act for a new story.
        act_id: chapter?.act_id ?? acts.data?.at(-1)?.id,
        sort_key: Math.max(0, ...(chapters.data ?? []).map((chapter) => chapter.sort_key)) + 100,
      }),
    onSuccess: (created) => {
      setChapterId(created.id)
      void qc.invalidateQueries({ queryKey: ['chapters', storyId] })
      refresh()
    },
  })

  const updateChapter = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateChapter(storyId, selectedChapter!, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chapters', storyId] })
      void qc.invalidateQueries({ queryKey: ['brief', storyId] })
      refresh()
    },
  })
  const deleteChapter = useMutation({
    mutationFn: () => api.deleteChapter(storyId, selectedChapter!),
    onSuccess: () => {
      setChapterId(null)
      void qc.invalidateQueries({ queryKey: ['chapters', storyId] })
      void qc.invalidateQueries({ queryKey: ['scenes', storyId] })
      void qc.invalidateQueries({ queryKey: ['brief', storyId] })
      refresh()
    },
  })
  const moveChapter = useMutation({
    mutationFn: ({ id, before, after }: { id: string; before?: string; after?: string }) =>
      api.moveChapter(storyId, id, { before_chapter_id: before, after_chapter_id: after }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chapters', storyId] })
      void qc.invalidateQueries({ queryKey: ['continuity', storyId] })
      refresh()
    },
  })

  const addScene = useMutation({
    mutationFn: (title: string) =>
      api.createScene(storyId, {
        title,
        chapter_id: selectedChapter ?? undefined,
        sort_key: Math.max(0, ...(scenes.data ?? []).filter((scene) => scene.chapter_id === selectedChapter).map((scene) => scene.sort_key)) + 100,
      }),
    onSuccess: (created) => {
      setSceneId(created.id)
      void qc.invalidateQueries({ queryKey: ['scenes', storyId] })
      void qc.invalidateQueries({ queryKey: ['brief', storyId] })
      refresh()
    },
  })

  const linkBeat = useMutation({
    mutationFn: (beatId: string) => api.linkChapterBeat(storyId, selectedChapter!, beatId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['brief', storyId] })
      refresh()
    },
  })
  const moveScene = useMutation({
    mutationFn: ({ id, before, after }: { id: string; before?: string; after?: string }) =>
      api.moveScene(storyId, id, { before_scene_id: before, after_scene_id: after }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', storyId] })
      void qc.invalidateQueries({ queryKey: ['brief', storyId] })
      void qc.invalidateQueries({ queryKey: ['continuity', storyId] })
    },
  })
  const unlinkBeat = useMutation({
    mutationFn: (beatId: string) => api.unlinkChapterBeat(storyId, selectedChapter!, beatId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['brief', storyId] })
      refresh()
    },
  })

  if (story.isPending || ladder.isPending) {
    return <p className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
  }
  if (story.isError) {
    return <p className="p-8 text-sm text-red-600 dark:text-red-300">{(story.error as Error).message}</p>
  }

  return (
    <main className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <Link to="/library" className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
        ← all stories
      </Link>

      <header className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{story.data.title}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {story.data.structure_framework.replace('_', ' ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {progress.data && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {progress.data.word_count.toLocaleString()} words ·{' '}
              {progress.data.drafted_scene_count}/{progress.data.scene_count} scenes drafted
            </span>
          )}
          {/* Export is first-class: this tool augments a writer's process, so the words
              must always be able to leave. */}
          <a
            href={api.manuscriptUrl(storyId)}
            className="rounded border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950"
          >
            Export .md
          </a>
          <StoryVersions storyId={storyId} />
          <AuthorshipPanel storyId={storyId} />
          <StorySharing storyId={storyId} title={story.data.title} blurb={story.data.blurb} beforeOpen={() => tab === 'write' ? writerFlush.current() : Promise.resolve(true)} />
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            Mode
            <select
              aria-label="Authoring mode"
              value={story.data.authoring_mode}
              onChange={(event) => updateStory.mutate({ authoring_mode: event.target.value })}
              className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs capitalize text-slate-700 dark:text-slate-200"
            >
              {MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </label>
        </div>
      </header>

      <div className="story-workspace-tabs" role="tablist" aria-label="Story workspace" onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const tabs = ['write', 'read', 'design'] as const
          const next = event.key === 'Home' ? 'write' : event.key === 'End' ? 'design' : tabs[(tabs.indexOf(tab) + (event.key === 'ArrowLeft' ? 2 : 1)) % tabs.length]
          void changeTab(next)
          document.getElementById(`workspace-tab-${next}`)?.focus()
        }
      }}>
        {(['write', 'read', 'design'] as const).map(item => <button key={item} id={`workspace-tab-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls={`workspace-panel-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => { void changeTab(item) }}>{item === 'write' ? 'Write' : item === 'read' ? 'Read' : 'Design'}</button>)}
      </div>
      {tabError && <p role="alert" className="writer-error">{tabError}</p>}
      <p className="live-update-status" role="status">{live.isError ? 'Live updates paused.' : 'Live · checks for changes every 5 seconds.'}{live.isError && <button type="button" onClick={() => { void live.refetch() }}>Retry</button>}</p>
      <div id="workspace-panel-write" role="tabpanel" aria-labelledby="workspace-tab-write" hidden={tab !== 'write'}>
        {writerOpened && <Suspense fallback={<p className="p-6">Loading writing workspace…</p>}><StoryWriter storyId={storyId} registerFlush={registerFlush} /></Suspense>}
      </div>
      <div id="workspace-panel-read" role="tabpanel" aria-labelledby="workspace-tab-read" hidden={tab !== 'read'}>
        {tab === 'read' && <Suspense fallback={<p className="p-6">Loading reader…</p>}><StoryReader storyId={storyId} owned embedded /></Suspense>}
      </div>
      <div id="workspace-panel-design" role="tabpanel" aria-labelledby="workspace-tab-design" hidden={tab !== 'design'}>

      {story.data.genre === 'Tutorial · timelines and arcs' && <TutorialWalkthrough onTimeline={() => setLevel(TIMELINE_VIEW)} onCharacters={() => setLevel(3)} onScenes={() => setLevel(8)} onPractice={() => { const practice = scenes.data?.find((item) => item.title?.startsWith('Practice placeholder')); if (practice) { setSceneId(practice.id); setChapterId(practice.chapter_id) }; setLevel(8) }} />}
      <div className={`mt-6 grid grid-cols-1 gap-5 md:grid-cols-[170px_minmax(0,1fr)] ${level === TIMELINE_VIEW || level === ASSISTANT_VIEW || level === INBOX_VIEW ? 'xl:grid-cols-[180px_minmax(0,1fr)]' : 'xl:grid-cols-[180px_minmax(0,1fr)_260px]'}`}>
        <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <button type="button" onClick={() => setLevel(TIMELINE_VIEW)} className={`mb-4 w-full rounded-md px-3 py-2 text-left text-sm font-medium ${level === TIMELINE_VIEW ? 'bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-950' : 'workspace-shortcut'}`}>Story timeline →</button>
          <button type="button" onClick={() => setLevel(INBOX_VIEW)} className={`mb-4 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium ${level === INBOX_VIEW ? 'bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-950' : 'workspace-shortcut'}`}>Agent changes →{pendingRuns > 0 && <span aria-label={`${pendingRuns} pending`} className="rounded-full bg-amber-500 px-2 text-xs font-semibold text-white">{pendingRuns}</span>}</button>
          <button type="button" onClick={() => setLevel(ASSISTANT_VIEW)} className={`mb-4 w-full rounded-md px-3 py-2 text-left text-sm font-medium ${level === ASSISTANT_VIEW ? 'bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-950' : 'workspace-shortcut'}`}>Story assistant →</button>
          <button type="button" onClick={() => setLevel(GLOSSARY_VIEW)} className={`mb-4 w-full rounded-md px-3 py-2 text-left text-sm font-medium ${level === GLOSSARY_VIEW ? 'bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-950' : 'workspace-shortcut'}`}>Glossary →</button>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Levels
          </h2>
          {ladder.data && (
            <Ladder
              ladder={ladder.data}
              mode={story.data.authoring_mode as AuthoringMode}
              activeLevel={level}
              onSelect={setLevel}
            />
          )}

          <h2 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Reference
          </h2>
          <button
            onClick={() => setLevel(PLACES_VIEW)}
            className={[
              'w-full rounded-md px-3 py-2 text-left text-sm transition',
              level === PLACES_VIEW ? 'bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-950' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
            ].join(' ')}
          >
            Places
          </button>
        </aside>

        <section className="min-w-0">
          {level === TIMELINE_VIEW && <StoryTimeline storyId={storyId} onOpenScene={(id) => { setSceneId(id || null); setLevel(8) }} />}
          {level === ASSISTANT_VIEW && <AuthoringAssistant storyId={storyId} />}
          {level === INBOX_VIEW && <ProposalInbox storyId={storyId} />}
          {level === GLOSSARY_VIEW && <GlossaryPanel storyId={storyId} />}
          {level === 1 && (
            <Panel title="Premise" hint="The story's starting point and settings.">
              <div className="space-y-3">
                <label className="block text-xs text-slate-500 dark:text-slate-400">Title<InlineText value={story.data.title} placeholder="Story title" onSave={(title) => updateStory.mutateAsync({ title })} /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400">Blurb · shown to readers<InlineText value={story.data.blurb} placeholder="A reader-facing pitch for your story" onSave={(blurb) => updateStory.mutateAsync({ blurb })} multiline /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400">Premise<InlineText value={story.data.premise} placeholder="What is this story?" onSave={(premise) => updateStory.mutateAsync({ premise })} multiline /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400">Genre<InlineText value={story.data.genre} placeholder="Genre" onSave={(genre) => updateStory.mutateAsync({ genre })} /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400">Point of view<InlineSelect value={story.data.pov_style} options={['first', 'third_limited', 'third_omniscient', 'second', 'mixed']} onSave={(pov_style) => updateStory.mutateAsync({ pov_style })} /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400">Framework<InlineSelect value={story.data.structure_framework} options={['three_act', 'save_the_cat', 'custom']} onSave={(structure_framework) => updateStory.mutateAsync({ structure_framework })} /></label>
              </div>
              <details className="mt-5 rounded border border-slate-200 p-3 dark:border-slate-700"><summary className="cursor-pointer text-sm font-medium">World, style, theme, and notes</summary><div className="mt-3 space-y-3">
                <label className="block text-xs">World rules (one per line)<InlineText value={story.data.world_rules?.join('\n') ?? null} placeholder="What is possible in this world?" onSave={value => updateStory.mutateAsync({ world_rules: value?.split('\n').map(item => item.trim()).filter(Boolean) ?? [] })} multiline /></label>
                <label className="block text-xs">Style rules (one per line)<InlineText value={story.data.style_rules?.join('\n') ?? null} placeholder="Voice, tense, prose constraints" onSave={value => updateStory.mutateAsync({ style_rules: value?.split('\n').map(item => item.trim()).filter(Boolean) ?? [] })} multiline /></label>
                <label className="block text-xs">Thematic statement<InlineText value={story.data.thematic_statement} placeholder="What does this story explore?" onSave={thematic_statement => updateStory.mutateAsync({ thematic_statement })} multiline /></label>
                <label className="block text-xs">Motifs (one per line)<InlineText value={story.data.motifs?.join('\n') ?? null} placeholder="Recurring images or ideas" onSave={value => updateStory.mutateAsync({ motifs: value?.split('\n').map(item => item.trim()).filter(Boolean) ?? [] })} multiline /></label>
                <label className="block text-xs">Private story notes<InlineText value={story.data.notes} placeholder="Reference and working notes; keep the premise one sentence" onSave={notes => updateStory.mutateAsync({ notes })} multiline /></label>
              </div></details>
            </Panel>
          )}

          {level === 2 && <EventsPanel storyId={storyId} />}
          {level === 3 && <CharactersPanel storyId={storyId} />}
          {level === 4 && <ActsPanel storyId={storyId} framework={story.data.structure_framework} />}
          {level === 5 && <BeatsPanel storyId={storyId} framework={story.data.structure_framework} />}
          {level === 6 && <ThreadsPanel storyId={storyId} />}

          {level === 7 && (
            <Panel title="Chapters" hint="Containers that exist to fulfil specific beats.">
              <AddForm
                placeholder="Chapter title…"
                onAdd={(title) => addChapter.mutateAsync(title)}
                pending={addChapter.isPending}
              />

              {(chapters.data?.length ?? 0) > 0 && (
                <div className="mt-3 flex min-w-0 items-center gap-2">
                  <select aria-label="Select chapter" value={selectedChapter ?? ''} onChange={(event) => setChapterId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200">
                    {chapters.data?.map((item) => <option key={item.id} value={item.id}>{item.number}. {item.title ?? 'Untitled'}</option>)}
                  </select>
                  <button type="button" aria-label="Move chapter up" title="Move chapter up" disabled={!selectedChapter || chapterIndex <= 0 || moveChapter.isPending} onClick={() => moveChapter.mutate({ id: selectedChapter!, before: chapters.data?.[chapterIndex - 1]?.id })} className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-30">↑</button>
                  <button type="button" aria-label="Move chapter down" title="Move chapter down" disabled={!selectedChapter || chapterIndex >= (chapters.data?.length ?? 0) - 1 || moveChapter.isPending} onClick={() => moveChapter.mutate({ id: selectedChapter!, after: chapters.data?.[chapterIndex + 1]?.id })} className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-30">↓</button>
                </div>
              )}

              {chapter && (
                <details className="mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-950">
                    <span>Chapter details</span>
                    <span className="truncate text-xs font-normal text-slate-400">Draft: {chapter.status} · {chapter.title ?? 'Untitled'}</span>
                  </summary>
                  <div className="border-t border-slate-100 dark:border-slate-800 p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Structure</h3>
                    <div className="flex items-center gap-2"><Chip complete={chapter.completeness.is_complete} missing={chapter.completeness.missing} /><DeleteButton onConfirm={() => deleteChapter.mutate()} what="chapter" /></div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-500 dark:text-slate-400">Number<InlineNumber value={chapter.number} min={1} onSave={(number) => updateChapter.mutateAsync({ number })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Title<InlineText value={chapter.title} placeholder="Chapter title" onSave={(title) => updateChapter.mutateAsync({ title })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Act<InlineSelect value={chapter.act_id} options={(acts.data ?? []).map((act) => ({ value: act.id, label: `${act.number}. ${act.title ?? 'Untitled'}` }))} onSave={(act_id) => updateChapter.mutateAsync({ act_id })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">POV character<InlineSelect value={chapter.pov_character_id} options={(characters.data ?? []).map((character) => ({ value: character.id, label: character.name }))} onSave={(pov_character_id) => updateChapter.mutateAsync({ pov_character_id })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Draft status<InlineSelect value={chapter.status} options={['placeholder', 'outlined', 'drafted', 'revised']} onSave={(status) => updateChapter.mutateAsync({ status })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Emotional shift from<InlineText value={chapter.emotional_shift_from} placeholder="from" onSave={(emotional_shift_from) => updateChapter.mutateAsync({ emotional_shift_from })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Emotional shift to<InlineText value={chapter.emotional_shift_to} placeholder="to" onSave={(emotional_shift_to) => updateChapter.mutateAsync({ emotional_shift_to })} /></label>
                  </div>
                  {(['epigraph', 'opening_note', 'closing_note'] as const).map(field => <label key={field} className="mt-2 block text-xs text-slate-500 dark:text-slate-400">{field === 'epigraph' ? 'Epigraph' : field === 'opening_note' ? 'Opening note' : 'Closing note'}<InlineText value={chapter[field]} placeholder="Optional reader-facing chapter text" onSave={value => updateChapter.mutateAsync({ [field]: value })} multiline /></label>)}
                  <label className="mt-2 block text-xs text-slate-500 dark:text-slate-400">Summary<InlineText value={chapter.summary} placeholder="What does this chapter do?" onSave={(summary) => updateChapter.mutateAsync({ summary })} multiline /></label>
                  </div>
                </details>
              )}

              {brief.data && (
                <div className="mt-4">
                  <ChapterBriefCard brief={brief.data} />

                  {/* Declaring what a chapter owes is the one upward reference the
                      author makes by hand; everything else is derived from it. */}
                  <details className="mt-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-950">
                      Beat assignments · {brief.data.beats.length} linked
                    </summary>
                    <div className="border-t border-slate-100 dark:border-slate-800 p-3">
                    <p className="mb-1.5 text-xs text-slate-400">Declare a beat this chapter fulfils:</p>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {brief.data.beats.map((beat) => (
                        <button key={beat.beat_id} onClick={() => unlinkBeat.mutate(beat.beat_id)} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-700 dark:hover:text-red-300" title="Remove beat from chapter">
                          {beat.label} ×
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {beats.data
                        ?.filter(
                          (beat) => !brief.data?.beats.some((b) => b.beat_id === beat.id),
                        )
                        .map((beat) => (
                          <button
                            key={beat.id}
                            onClick={() => linkBeat.mutate(beat.id)}
                            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950"
                          >
                            + {beat.label}
                          </button>
                        ))}
                    </div>
                    </div>
                  </details>
                </div>
              )}

              {chapters.data?.length === 0 && <Empty>No chapters yet.</Empty>}
            </Panel>
          )}

          {level === PLACES_VIEW && <PlacesPanel storyId={storyId} />}

          {level === 8 && (
            <Panel
              title="Scenes"
              hint={
                selectedChapter
                  ? 'New scenes attach to the chapter selected at level 7.'
                  : 'No chapter selected — scenes will be created unattached, which is legal.'
              }
            >
              <AddForm
                placeholder="Scene title…"
                onAdd={(title) => addScene.mutateAsync(title)}
                pending={addScene.isPending}
              />
              {(scenes.data?.length ?? 0) > 0 && (
                <div className="mt-3 flex min-w-0 items-center gap-2">
                  <select aria-label="Select scene" value={selectedScene?.id ?? ''} onChange={(event) => setSceneId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200">
                    {scenes.data?.map((item) => <option key={item.id} value={item.id}>{chapters.data?.find((chapter) => chapter.id === item.chapter_id)?.number ?? '—'} · {item.title ?? 'Untitled'}{item.word_count > 0 ? ` · ${item.word_count} words` : ''}</option>)}
                  </select>
                  <button type="button" aria-label="Move scene up" title="Move scene up within chapter" disabled={!selectedScene || sceneIndex <= 0 || moveScene.isPending} onClick={() => moveScene.mutate({ id: selectedScene!.id, before: sceneSiblings[sceneIndex - 1]?.id })} className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-30">↑</button>
                  <button type="button" aria-label="Move scene down" title="Move scene down within chapter" disabled={!selectedScene || sceneIndex >= sceneSiblings.length - 1 || moveScene.isPending} onClick={() => moveScene.mutate({ id: selectedScene!.id, after: sceneSiblings[sceneIndex + 1]?.id })} className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-30">↓</button>
                </div>
              )}

              {selectedScene && <SceneDetails key={selectedScene.id} storyId={storyId} scene={selectedScene} onDeleted={() => setSceneId(null)} />}

              {selectedScene && (
                <div className="mt-4">
                  <Suspense
                    fallback={<p className="text-sm text-slate-400">Loading editor…</p>}
                  >
                  <SceneEditor
                    key={selectedScene.id}
                    storyId={storyId}
                    scene={selectedScene}
                    brief={sceneBrief.data}
                  />
                  </Suspense>
                </div>
              )}

              {scenes.data?.length === 0 && <Empty>No scenes yet.</Empty>}
            </Panel>
          )}
        </section>

        {level !== TIMELINE_VIEW && level !== ASSISTANT_VIEW && level !== INBOX_VIEW && <aside className="min-w-0 md:col-start-2 xl:col-start-auto xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto">
          <InsightsPanel storyId={storyId} health={health.data} />
        </aside>}
      </div>
      </div>
    </main>
  )
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mb-3 text-xs text-slate-400">{hint}</p>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-slate-400">{children}</p>
}
