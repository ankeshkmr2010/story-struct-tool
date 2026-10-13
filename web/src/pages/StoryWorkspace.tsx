import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, type SearchContext, type SearchHit } from '../api/client'
import { StorySearch } from '../components/StorySearch'
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
import { StoryGrid } from '../components/StoryGrid'
import { ProposalInbox } from '../components/ProposalInbox'
import { OutlineCatchup } from '../components/OutlineCatchup'
import { StoryEvaluation } from '../components/StoryEvaluation'
import { TutorialWalkthrough } from '../components/TutorialWalkthrough'
import { StoryVersions } from '../components/StoryVersions'
import { AuthorshipPanel } from '../components/AuthorshipPanel'
import { StorySharing } from '../components/StorySharing'
import { DownloadMenu } from '../components/DownloadMenu'
import { useStoryLiveUpdates } from '../components/useStoryLiveUpdates'
import { HelpTip } from '../components/HelpTip'
const StoryWriter = lazy(() => import('../components/StoryWriter').then(m => ({ default: m.StoryWriter })))
const StoryReader = lazy(() => import('./SharedStoryReader').then(m => ({ default: m.StoryReader })))

// Premise settings in plain words: a label for each choice and one line on what it means (T5).
type Choice = { value: string; label: string; description: string }
const POV_OPTIONS: Choice[] = [
  { value: 'first', label: 'First person', description: '"I" tells the story; readers know only what the narrator knows.' },
  { value: 'third_limited', label: 'Third person, close', description: '"She" or "he", staying inside one character at a time.' },
  { value: 'third_omniscient', label: 'Third person, all-knowing', description: 'A narrator who can see into anyone\'s head.' },
  { value: 'second', label: 'Second person', description: '"You" are the main character.' },
  { value: 'mixed', label: 'Mixed', description: 'Different viewpoints in different parts of the book.' },
]
const FRAMEWORK_OPTIONS: Choice[] = [
  { value: 'three_act', label: 'Three acts', description: 'Setup, confrontation, resolution: the classic story shape.' },
  { value: 'save_the_cat', label: 'Save the Cat', description: '15 named beats, from Opening Image to Final Image.' },
  { value: 'custom', label: 'Custom', description: 'Your own acts and beats; nothing is pre-filled.' },
]
const MODE_OPTIONS: Choice[] = [
  { value: 'plotter', label: 'Plotter (plan first)', description: 'Levels after the first unfinished one are dimmed and show what they still need. Nothing is locked.' },
  { value: 'hybrid', label: 'Hybrid', description: 'Every level is open; gaps show as gentle nudges.' },
  { value: 'pantser', label: 'Pantser (write first)', description: 'Gaps are hidden. Work on whatever you like.' },
]
const describe = (choices: Choice[], value: string | null) => choices.find((choice) => choice.value === value)?.description
const choiceList = (choices: Choice[]) => <ul className="space-y-1">{choices.map((choice) => <li key={choice.value}><strong>{choice.label}:</strong> {choice.description}</li>)}</ul>

// Places are reference data, not a rung. The sentinel keeps them out of the ladder's
// readiness logic entirely.
// Full-width Design pages; Plan levels are 1-8. Timeline, Places, Glossary and the
// assistant are reference panels beside Write, Read or Design instead.
const INBOX_VIEW = 104
const GRID_VIEW = 105
const CATCHUP_VIEW = 106
const HISTORY_VIEW = 107
const EVALUATE_VIEW = 108

type RefPanel = 'timeline' | 'places' | 'glossary' | 'assistant'
const REF_PANELS: [RefPanel, string][] = [['timeline', 'Timeline'], ['places', 'Places'], ['glossary', 'Glossary'], ['assistant', 'Assistant']]

export default function StoryWorkspace() {
  const { storyId = '' } = useParams()
  return <Workspace key={storyId} />
}

function Workspace() {
  const { storyId = '' } = useParams()
  const qc = useQueryClient()
  const live = useStoryLiveUpdates(storyId)
  // The live line stays a quiet dot and only speaks for a few seconds after the story changes.
  const [justUpdated, setJustUpdated] = useState(false)
  useEffect(() => {
    if (!live.changedAt) return
    setJustUpdated(true)
    const timer = setTimeout(() => setJustUpdated(false), 4000)
    return () => clearTimeout(timer)
  }, [live.changedAt])
  const [savedSearchContext] = useState(() => {
    try { return localStorage.getItem(`storytool-search-open:${storyId}`) === 'true' ? JSON.parse(localStorage.getItem(`storytool-search-context:${storyId}`) || '{}') : {} } catch { return {} }
  })
  const [level, setLevel] = useState(() => [1, 2, 3, 4, 5, 6, 7, 8, INBOX_VIEW, GRID_VIEW, CATCHUP_VIEW, HISTORY_VIEW, EVALUATE_VIEW].includes(savedSearchContext.level) ? savedSearchContext.level as number : 1)
  // Levels 1-8 are the Plan; ids from 104 up are full-width Design pages (Grid, History, …).
  const isView = level >= INBOX_VIEW
  const planLevel = useRef(1)
  // Picking a level shows its section; on phones that section sits below the list, so bring it into view.
  const levelSection = useRef<HTMLElement>(null)
  const selectLevel = (next: number) => {
    setLevel(next)
    requestAnimationFrame(() => {
      const top = levelSection.current?.getBoundingClientRect().top
      if (top !== undefined && (top < 0 || top > window.innerHeight * 0.4)) levelSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  if (!isView) planLevel.current = level
  const [historyTab, setHistoryTab] = useState<'versions' | 'authorship'>('versions')
  const [tab, setTab] = useState<'write' | 'read' | 'design'>(() => {
    if (['write', 'read', 'design'].includes(savedSearchContext.tab)) return savedSearchContext.tab
    try { const saved = localStorage.getItem(`storytool-workspace:${storyId}`); return saved === 'write' || saved === 'read' ? saved : 'design' } catch { return 'design' }
  })
  const [writerOpened, setWriterOpened] = useState(tab === 'write')
  const [tabError, setTabError] = useState<string | null>(null)
  const writerFlush = useRef<() => Promise<boolean>>(async () => true)
  const registerFlush = useCallback((flush: () => Promise<boolean>) => { writerFlush.current = flush }, [])
  const changeTab = async (next: 'write' | 'read' | 'design') => {
    if (next === tab) return true
    if (tab === 'write' && !await writerFlush.current()) { setTabError('Your writing has not saved yet. Retry the save before switching workspaces.'); return false }
    setTabError(null); setTab(next)
    if (next === 'write') {
      setWriterOpened(true)
      void qc.invalidateQueries({ queryKey: ['content', storyId] })
    }
    if (next === 'read') void qc.invalidateQueries({ queryKey: ['reading-document', storyId] })
    try { localStorage.setItem(`storytool-workspace:${storyId}`, next) } catch { /* Preference storage is optional. */ }
    return true
  }
  // Design pages (Grid, History, …) need the full width; the header's Agent changes badge opens one from any tab.
  const openView = async (view: number) => { if (await changeTab('design')) setLevel(view) }
  const viewItem = (view: number, label: ReactNode) => <button type="button" aria-current={level === view ? 'page' : undefined} onClick={() => setLevel(view)}>{label}</button>
  // Reference panels sit beside the text in every tab, so looking something up never leaves the page.
  const [refPanel, setRefPanel] = useState<RefPanel | null>(() => REF_PANELS.some(([key]) => key === savedSearchContext.refPanel) ? savedSearchContext.refPanel : null)
  const [searchOpen, setSearchOpen] = useState(() => {
    try { return localStorage.getItem(`storytool-search-open:${storyId}`) === 'true' } catch { return false }
  })
  const [searchText, setSearchText] = useState('')
  const [searchEntry, setSearchEntry] = useState<{ q: string; sequence: number; context: SearchContext } | undefined>()
  const searchSequence = useRef(0)
  const [searchParams] = useSearchParams()
  const handledSearchTarget = useRef('')
  const hasPanel = Boolean(refPanel || searchOpen)
  const searchContext: SearchContext | null = refPanel === 'places' ? 'location'
    : refPanel === 'glossary' ? 'glossary_entry' : refPanel === 'timeline' ? 'timeline'
    : refPanel === 'assistant' ? null : tab !== 'design' ? 'prose'
    : ({ 1: 'story', 2: 'event', 3: 'character', 4: 'act', 5: 'beat', 6: 'thread', 7: 'chapter', 8: 'scene', [GRID_VIEW]: 'scene' } as Record<number, SearchContext>)[level] ?? null
  useEffect(() => {
    setSearchEntry(undefined)
    try { setSearchText(searchContext ? JSON.parse(localStorage.getItem(`storytool-search:${storyId}:${searchContext}`) || '{}').q || '' : '') } catch { setSearchText('') }
  }, [storyId, searchContext])
  useEffect(() => {
    try { localStorage.setItem(`storytool-search-open:${storyId}`, String(searchOpen)) } catch { /* Optional browser storage. */ }
  }, [storyId, searchOpen])
  // Restore the search's source context on refresh as well as its query and filters.
  useEffect(() => {
    if (!searchOpen) return
    try { localStorage.setItem(`storytool-search-context:${storyId}`, JSON.stringify({ tab, level, refPanel })) } catch { /* Optional browser storage. */ }
  }, [storyId, searchOpen, tab, level, refPanel])
  useEffect(() => {
    if (!searchOpen) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSearchOpen(false); document.getElementById('story-search-toggle')?.focus() } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [searchOpen])
  const [writerScene, setWriterScene] = useState<{ id: string; at: number } | null>(null)
  const [readerScene, setReaderScene] = useState<{ sceneId: string; sequence: number } | undefined>()
  const revealSearchTarget = async (id: string) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const target = document.getElementById(id)
      if (target) {
        target.querySelectorAll('details').forEach(detail => { detail.open = true })
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true })
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Could not open this item. Refresh results and try again.')
  }
  const openSearchHit = async (hit: SearchHit) => {
    if (tab === 'write' && !await writerFlush.current()) throw new Error('Your writing has not saved yet. Retry the save before opening a result.')
    const target = await api.searchTarget(storyId, hit)
    const narrow = window.matchMedia('(max-width: 1100px)').matches
    if (hit.matches.some(match => match.field === 'content')) {
      if (tab === 'read') setReaderScene({ sceneId: hit.id, sequence: Date.now() })
      else if (await changeTab('write')) setWriterScene({ id: hit.id, at: Date.now() })
      if (narrow) { setSearchOpen(false); setRefPanel(null) }
      return
    }
    if (hit.entity === 'location' || hit.entity === 'glossary_entry') {
      setRefPanel(hit.entity === 'location' ? 'places' : 'glossary'); setSearchOpen(false)
      await revealSearchTarget(`search-${hit.entity}-${hit.id}`)
      return
    }
    const destination = ({ story: 1, event: 2, character: 3, act: 4, beat: 5, thread: 6, chapter: 7, scene: 8 } as Record<string, number>)[hit.entity]
    if (!destination) throw new Error('This item has no editing destination.')
    if (!await changeTab('design')) throw new Error('Save your writing before opening this item.')
    setLevel(destination)
    if (hit.entity === 'chapter') setChapterId(hit.id)
    if (hit.entity === 'scene') { setChapterId(target.chapter_id ?? null); setSceneId(hit.id) }
    if (narrow) { setSearchOpen(false); setRefPanel(null) }
    const collection = hit.entity === 'character' ? 'characters' : hit.entity === 'event' ? 'events' : `${hit.entity}s`
    void qc.invalidateQueries({ queryKey: [collection, storyId] })
    await revealSearchTarget(hit.entity === 'character' ? `character-${hit.id}`
      : ['story', 'chapter', 'scene'].includes(hit.entity) ? 'story-search-design-section' : `search-${hit.entity}-${hit.id}`)
  }
  const searchOpenAction = useRef(openSearchHit)
  useEffect(() => { searchOpenAction.current = openSearchHit }, [openSearchHit])
  const openScene = (id: string) => {
    if (!id) return
    // Below 1100px the panel covers the text, so close it to show where the jump landed.
    if (window.matchMedia('(max-width: 1100px)').matches) setRefPanel(null)
    if (tab === 'write') setWriterScene({ id, at: Date.now() })
    else if (tab === 'read') document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else { const scene = scenes.data?.find(item => item.id === id); setChapterId(scene?.chapter_id ?? null); setSceneId(id); setLevel(8) }
  }
  // Characters live in Design → Characters; open it and bring that character's card into view.
  const openCharacter = async (id: string) => {
    if (!await changeTab('design')) return
    if (window.matchMedia('(max-width: 1100px)').matches) setRefPanel(null)
    setLevel(3)
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 150))
      const card = document.getElementById(`character-${id}`)
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    }
  }

  const story = useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) })
  const ladder = useQuery({ queryKey: ['ladder', storyId], queryFn: () => api.getLadder(storyId) })
  const pending = useQuery({ queryKey: ['ai-runs', storyId, 'pending'], queryFn: () => api.listAIRuns(storyId, 'proposed', 200) })
  const pendingRuns = pending.data?.length ?? 0
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
  useEffect(() => {
    const entity = searchParams.get('search_entity'), id = searchParams.get('search_id')
    const field = searchParams.get('search_field') || 'title'
    if (!entity || !id || story.isPending || story.isError || scenes.isPending) return
    const key = `${entity}:${id}:${field}`
    if (handledSearchTarget.current === key) return
    handledSearchTarget.current = key
    void searchOpenAction.current({ story_id: storyId, story_title: story.data!.title, entity, id, title: '', matches: [{ field, excerpt: '' }] }).catch(error => setTabError(String(error)))
  }, [searchParams, story.isPending, story.isError, scenes.isPending, story.data?.title, storyId])
  const selectedScene = scenes.data?.find((s) => s.id === sceneId)
    ?? scenes.data?.find((s) => s.chapter_id === selectedChapter)
    ?? scenes.data?.[0]
    ?? null
  const sceneSiblings = scenes.data?.filter((item) => item.chapter_id === selectedScene?.chapter_id) ?? []
  const sceneIndex = sceneSiblings.findIndex((item) => item.id === selectedScene?.id)

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
        // A story's first chapter opens Act 1; later ones continue in the selected chapter's act, else the last act.
        act_id: (chapters.data?.length ?? 0) === 0 ? acts.data?.[0]?.id : chapter?.act_id ?? acts.data?.at(-1)?.id,
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
    <main className="workspace-page mx-auto max-w-[1600px] overflow-x-clip p-4 sm:p-6 lg:p-8">
      <Link to="/library" className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
        ← all stories
      </Link>

      <header className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl dark:text-slate-100">{story.data.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {progress.data && (
            <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
              {progress.data.word_count.toLocaleString()} words ·{' '}
              {progress.data.drafted_scene_count}/{progress.data.scene_count} scenes drafted
            </span>
          )}
          <StorySharing storyId={storyId} title={story.data.title} blurb={story.data.blurb} beforeOpen={() => tab === 'write' ? writerFlush.current() : Promise.resolve(true)} />
          {/* Export is first-class: this tool augments a writer's process, so the words
              must always be able to leave. */}
          <DownloadMenu storyId={storyId} />
        </div>
      </header>

      <div className="workspace-bar">
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
        <form role="search" className="workspace-search-entry" onSubmit={event => { event.preventDefault(); if (searchContext && searchText.trim()) { setSearchEntry({ q: searchText.trim(), sequence: ++searchSequence.current, context: searchContext }); setSearchOpen(true) } }}>
          <input id="story-search-toggle" type="search" enterKeyHint="search" aria-label="Search current section" aria-controls="story-search-panel" placeholder="Search this section…" maxLength={300} value={searchText} onChange={event => setSearchText(event.target.value)} disabled={!searchContext} />
        </form>
        <div className="workspace-reference-controls">
        <p className={`live-update-status in-bar${live.activity.isError ? ' is-paused' : ''}`} role="status">{live.activity.isError ? <>Live updates paused.<button type="button" onClick={() => { void live.activity.refetch() }}>Retry</button></> : <><span className="group relative inline-flex cursor-help items-center p-1.5 -m-1.5" tabIndex={0} aria-label="Live updates on"><span className="live-dot" /><span role="tooltip" className="pointer-events-none absolute left-0 top-6 z-30 hidden w-64 rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-700 shadow-lg group-hover:block group-focus:block dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Live: changes from agents and other tabs appear here on their own. No need to refresh.</span></span>{justUpdated && <span className="live-updated">Updated just now</span>}</>}</p>
        <div className="workspace-ref-toggles" role="group" aria-label="Reference panels">
          {pendingRuns > 0 && <button type="button" className="workspace-ref-alert" onClick={() => { void openView(INBOX_VIEW) }}>Agent changes<span className="workspace-nav-badge" aria-label={`${pendingRuns} pending`}>{pendingRuns}</span></button>}
          {REF_PANELS.map(([key, label]) => <button key={key} type="button" aria-pressed={refPanel === key} onClick={() => setRefPanel(refPanel === key ? null : key)}>{label}</button>)}
        </div>
        </div>
      </div>
      {tabError && <p role="alert" className="writer-error">{tabError}</p>}
      <div className={`workspace-body${hasPanel ? ' has-panel' : ''}`}>
      <div className="min-w-0">
      <div id="workspace-panel-write" role="tabpanel" aria-labelledby="workspace-tab-write" hidden={tab !== 'write'}>
        {writerOpened && <Suspense fallback={<p className="p-6">Loading writing workspace…</p>}><StoryWriter storyId={storyId} registerFlush={registerFlush} openScene={writerScene} panelOpen={hasPanel} onContextOpen={() => { setRefPanel(null); setSearchOpen(false) }} /></Suspense>}
      </div>
      <div id="workspace-panel-read" role="tabpanel" aria-labelledby="workspace-tab-read" hidden={tab !== 'read'}>
        {tab === 'read' && <Suspense fallback={<p className="p-6">Loading reader…</p>}><StoryReader storyId={storyId} owned embedded openTarget={readerScene} /></Suspense>}
      </div>
      <div id="workspace-panel-design" role="tabpanel" aria-labelledby="workspace-tab-design" hidden={tab !== 'design'}>
      <nav aria-label="Design pages" className="workspace-views">
        <div><button type="button" aria-current={!isView ? 'page' : undefined} onClick={() => setLevel(planLevel.current)}>Plan</button>{viewItem(GRID_VIEW, 'Grid')}</div>
        <div>
          {viewItem(INBOX_VIEW, <>Agent changes{pendingRuns > 0 && <span className="workspace-nav-badge" aria-label={`${pendingRuns} pending`}>{pendingRuns}</span>}</>)}
          {viewItem(HISTORY_VIEW, 'History')}
          {viewItem(CATCHUP_VIEW, 'Catch up')}
          {viewItem(EVALUATE_VIEW, 'Evaluate')}
        </div>
      </nav>

      {story.data.genre === 'Tutorial · timelines and arcs' && <TutorialWalkthrough onTimeline={() => setRefPanel('timeline')} onCharacters={() => setLevel(3)} onScenes={() => setLevel(8)} onPractice={() => { const practice = scenes.data?.find((item) => item.title?.startsWith('Practice placeholder')); if (practice) { setSceneId(practice.id); setChapterId(practice.chapter_id) }; setLevel(8) }} />}
      <div className={`mt-6 grid grid-cols-1 gap-5 ${isView ? '' : hasPanel ? 'md:grid-cols-[170px_minmax(0,1fr)]' : 'md:grid-cols-[170px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_260px]'}`}>
        {!isView && <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <nav aria-label="Story design" className="workspace-nav">
            <h2>Plan</h2>
            {ladder.data && (
              <Ladder
                ladder={ladder.data}
                mode={story.data.authoring_mode as AuthoringMode}
                activeLevel={level}
                onSelect={selectLevel}
              />
            )}
          </nav>
        </aside>}

        <section ref={levelSection} id="story-search-design-section" className="min-w-0 scroll-mt-4">
          {level === INBOX_VIEW && <ProposalInbox storyId={storyId} />}
          {level === CATCHUP_VIEW && <OutlineCatchup storyId={storyId} onOpenInbox={() => setLevel(INBOX_VIEW)} />}
          {level === EVALUATE_VIEW && <StoryEvaluation storyId={storyId} onOpenInbox={() => setLevel(INBOX_VIEW)} onOpenScene={(scene) => { setChapterId(scene.chapter_id); setSceneId(scene.id); setLevel(8) }} onOpenThreads={() => setLevel(6)} onOpenCharacters={() => setLevel(3)} />}
          {level === GRID_VIEW && <StoryGrid storyId={storyId} onOpenInbox={() => setLevel(INBOX_VIEW)} onOpenScene={(scene) => { setChapterId(scene.chapter_id ?? null); setSceneId(scene.id); setLevel(8) }} />}
          {level === HISTORY_VIEW && <div>
            <div className="history-tabs" role="tablist" aria-label="History">
              <button type="button" role="tab" aria-selected={historyTab === 'versions'} onClick={() => setHistoryTab('versions')}>Versions</button>
              <button type="button" role="tab" aria-selected={historyTab === 'authorship'} onClick={() => setHistoryTab('authorship')}>Who wrote what</button>
            </div>
            {historyTab === 'versions' ? <StoryVersions storyId={storyId} /> : <AuthorshipPanel storyId={storyId} />}
          </div>}
          {level === 1 && (
            <Panel title="Premise" hint="The story's starting point and settings." help="The premise is the core idea: who wants what, what stands in the way, and why it matters. Every later level builds on it.">
              <div className="space-y-5">
                <label className="block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Title</span><InlineText value={story.data.title} placeholder="Story title" onSave={(title) => updateStory.mutateAsync({ title })} /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Blurb · shown to readers</span><InlineText value={story.data.blurb} placeholder="A reader-facing pitch for your story" onSave={(blurb) => updateStory.mutateAsync({ blurb })} multiline /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Premise</span><InlineText value={story.data.premise} placeholder="What is this story?" onSave={(premise) => updateStory.mutateAsync({ premise })} multiline /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Genre</span><InlineText value={story.data.genre} placeholder="Genre" onSave={(genre) => updateStory.mutateAsync({ genre })} /></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Point of view</span><HelpTip label="point of view">Whose eyes the reader sees the story through.{choiceList(POV_OPTIONS)}</HelpTip><span className="mt-1 block max-w-xs"><InlineSelect value={story.data.pov_style} options={POV_OPTIONS} onSave={(pov_style) => updateStory.mutateAsync({ pov_style })} /></span><span className="help-text mt-1 block">{describe(POV_OPTIONS, story.data.pov_style)}</span></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Framework</span><HelpTip label="a framework">The story shape used to seed your acts and beats. You can change any of them afterwards.{choiceList(FRAMEWORK_OPTIONS)}</HelpTip><span className="mt-1 block max-w-xs"><InlineSelect value={story.data.structure_framework} options={FRAMEWORK_OPTIONS} onSave={(structure_framework) => updateStory.mutateAsync({ structure_framework })} /></span><span className="help-text mt-1 block">{describe(FRAMEWORK_OPTIONS, story.data.structure_framework)}</span></label>
                <label className="block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Mode</span><HelpTip label="mode">How much the plan guides you. It only changes what is flagged; nothing is ever blocked.{choiceList(MODE_OPTIONS)}</HelpTip><span className="mt-1 block max-w-xs"><InlineSelect value={story.data.authoring_mode} options={MODE_OPTIONS} onSave={(authoring_mode) => updateStory.mutateAsync({ authoring_mode })} /></span><span className="help-text mt-1 block">{describe(MODE_OPTIONS, story.data.authoring_mode)}</span></label>
              </div>
              <details className="mt-5 rounded border border-slate-200 p-3 dark:border-slate-700"><summary className="cursor-pointer text-sm font-medium">World, style, theme, and notes</summary><div className="mt-3 space-y-3">
                <label className="block text-xs"><span className="field-label">World rules</span> (one per line)<InlineText value={story.data.world_rules?.join('\n') ?? null} placeholder="What is possible in this world?" onSave={value => updateStory.mutateAsync({ world_rules: value?.split('\n').map(item => item.trim()).filter(Boolean) ?? [] })} multiline /></label>
                <label className="block text-xs"><span className="field-label">Style rules</span> (one per line)<InlineText value={story.data.style_rules?.join('\n') ?? null} placeholder="Voice, tense, prose constraints" onSave={value => updateStory.mutateAsync({ style_rules: value?.split('\n').map(item => item.trim()).filter(Boolean) ?? [] })} multiline /></label>
                <label className="block text-xs"><span className="field-label">Thematic statement</span><InlineText value={story.data.thematic_statement} placeholder="What does this story explore?" onSave={thematic_statement => updateStory.mutateAsync({ thematic_statement })} multiline /></label>
                <label className="block text-xs"><span className="field-label">Motifs</span> (one per line)<InlineText value={story.data.motifs?.join('\n') ?? null} placeholder="Recurring images or ideas" onSave={value => updateStory.mutateAsync({ motifs: value?.split('\n').map(item => item.trim()).filter(Boolean) ?? [] })} multiline /></label>
                <label className="block text-xs"><span className="field-label">Private story notes</span><InlineText value={story.data.notes} placeholder="Reference and working notes; keep the premise one sentence" onSave={notes => updateStory.mutateAsync({ notes })} multiline /></label>
              </div></details>
            </Panel>
          )}

          {level === 2 && <EventsPanel storyId={storyId} />}
          {level === 3 && <CharactersPanel storyId={storyId} />}
          {level === 4 && <ActsPanel storyId={storyId} framework={story.data.structure_framework} />}
          {level === 5 && <BeatsPanel storyId={storyId} framework={story.data.structure_framework} />}
          {level === 6 && <ThreadsPanel storyId={storyId} />}

          {level === 7 && (
            <Panel title="Chapters" hint="Containers that exist to fulfil specific beats." help="Chapters are the units readers see. Each one belongs to an act, has a point-of-view character, and should deliver at least one beat.">
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
                    <h3 className="section-title">Structure</h3>
                    <div className="flex items-center gap-2"><Chip complete={chapter.completeness.is_complete} missing={chapter.completeness.missing} /><DeleteButton onConfirm={() => deleteChapter.mutate()} what="chapter" /></div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Number</span><InlineNumber value={chapter.number} min={1} onSave={(number) => updateChapter.mutateAsync({ number })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Title</span><InlineText value={chapter.title} placeholder="Chapter title" onSave={(title) => updateChapter.mutateAsync({ title })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Act</span><InlineSelect value={chapter.act_id} options={(acts.data ?? []).map((act) => ({ value: act.id, label: `${act.number}. ${act.title ?? 'Untitled'}` }))} onSave={(act_id) => updateChapter.mutateAsync({ act_id })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400"><span className="field-label">POV character</span><InlineSelect value={chapter.pov_character_id} options={(characters.data ?? []).map((character) => ({ value: character.id, label: character.name }))} onSave={(pov_character_id) => updateChapter.mutateAsync({ pov_character_id })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Draft status</span><InlineSelect value={chapter.status} options={['placeholder', 'outlined', 'drafted', 'revised']} onSave={(status) => updateChapter.mutateAsync({ status })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Emotional shift from</span><InlineText value={chapter.emotional_shift_from} placeholder="from" onSave={(emotional_shift_from) => updateChapter.mutateAsync({ emotional_shift_from })} /></label>
                    <label className="text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Emotional shift to</span><InlineText value={chapter.emotional_shift_to} placeholder="to" onSave={(emotional_shift_to) => updateChapter.mutateAsync({ emotional_shift_to })} /></label>
                  </div>
                  {(['epigraph', 'opening_note', 'closing_note'] as const).map(field => <label key={field} className="mt-2 block text-xs text-slate-500 dark:text-slate-400">{field === 'epigraph' ? 'Epigraph' : field === 'opening_note' ? 'Opening note' : 'Closing note'}<InlineText value={chapter[field]} placeholder="Optional reader-facing chapter text" onSave={value => updateChapter.mutateAsync({ [field]: value })} multiline /></label>)}
                  <label className="mt-2 block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Summary</span><InlineText value={chapter.summary} placeholder="What does this chapter do?" onSave={(summary) => updateChapter.mutateAsync({ summary })} multiline /></label>
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


          {level === 8 && (
            <Panel
              title="Scenes"
              help="A scene is one continuous moment in one place, where something changes. Scenes sit in chapters and carry the prose you write."
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

              {/* Prose is written in Write only; Design keeps the scene's plan. */}
              {selectedScene && <button type="button" className="share-story-button mt-4" onClick={() => { void changeTab('write').then(ok => { if (ok) setWriterScene({ id: selectedScene.id, at: Date.now() }) }) }}>Open in Write →</button>}

              {scenes.data?.length === 0 && <Empty>No scenes yet.</Empty>}
            </Panel>
          )}
        </section>

        {!isView && !hasPanel && <aside className="min-w-0 md:col-start-2 xl:col-start-auto xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto">
          <InsightsPanel storyId={storyId} health={health.data} level={level} levelNames={Object.fromEntries((ladder.data?.levels ?? []).map(rung => [rung.level, rung.label]))} onOpenLevel={selectLevel} />
        </aside>}
      </div>
      </div>
      </div>
      <aside id="story-search-panel" hidden={!hasPanel} className="workspace-ref-panel" aria-label={searchOpen ? 'Search' : REF_PANELS.find(([key]) => key === refPanel)?.[1]}>
        <div className="workspace-ref-head"><h2>{searchOpen ? 'Search' : REF_PANELS.find(([key]) => key === refPanel)?.[1]}</h2><div>{!searchOpen && <button type="button" onClick={() => setSearchOpen(true)}>Search</button>}<button type="button" aria-label="Close panel" onClick={() => { if (searchOpen) setSearchOpen(false); else setRefPanel(null); document.getElementById('story-search-toggle')?.focus() }}>✕</button></div></div>
        <div hidden={!searchOpen}><StorySearch storyId={storyId} context={searchContext} active={searchOpen} onOpen={openSearchHit} externalInput entry={searchEntry?.context === searchContext ? searchEntry : undefined} onQueryChange={setSearchText} /></div>
        {!searchOpen && refPanel === 'timeline' && <StoryTimeline storyId={storyId} compact allowInsert={tab !== 'read'} onOpenScene={openScene} onOpenCharacter={(id) => { void openCharacter(id) }} />}
        {!searchOpen && refPanel === 'places' && <PlacesPanel storyId={storyId} />}
        {!searchOpen && refPanel === 'glossary' && <GlossaryPanel storyId={storyId} />}
        {!searchOpen && refPanel === 'assistant' && <AuthoringAssistant storyId={storyId} />}
      </aside>
      </div>
    </main>
  )
}

function Panel({
  title,
  hint,
  help,
  children,
}: {
  title: string
  hint: string
  /** Plain explanation of the level, shown in an ⓘ beside the title. */
  help?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="level-title">{title}{help && <HelpTip label={title.toLowerCase()}>{help}</HelpTip>}</h2>
      <p className="help-text mb-3">{hint}</p>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-slate-400">{children}</p>
}
