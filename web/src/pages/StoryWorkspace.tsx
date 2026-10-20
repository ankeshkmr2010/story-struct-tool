import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type SearchContext, type SearchHit, type StoryUpdate, type WorkspacePlace } from '../api/client'
import { useWorkspacePosition } from '../components/useWorkspacePosition'
import { SearchDialog } from '../components/StorySearch'
import { Ladder, type AuthoringMode } from '../components/Ladder'
import { ChapterBriefCard } from '../components/ChapterBriefCard'
import { InsightsPanel } from '../components/InsightsPanel'
import { PlacesPanel } from '../components/PlacesPanel'
import { GlossaryPanel } from '../components/GlossaryPanel'
import { BetaFeedbackPanel } from '../components/BetaFeedbackPanel'
import { OPEN_FEEDBACK_EVENT } from '../components/readerComments'
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
import { PlaceholderList } from '../components/PlaceholderList'
import { usePlaceholders } from '../components/usePlaceholders'
import { BesidePanel } from '../components/BesidePanel'
import { OPEN_BESIDE_EVENT, isBesideItem, type BesideTarget } from '../components/beside'
import { LANGUAGES, languageLabel } from '../components/languages'
import { TutorialWalkthrough } from '../components/TutorialWalkthrough'
import { StoryVersions } from '../components/StoryVersions'
import { AuthorshipPanel, DisclosureCard } from '../components/AuthorshipPanel'
import { StorySharing } from '../components/StorySharing'
import { DownloadMenu } from '../components/DownloadMenu'
import { Tabs } from '../ui/Tabs'
import { IconButton } from '../ui/primitives'
import { Menu, MenuItem } from '../ui/Menu'
import { ThemeToggle } from '../components/Theme'
import { AccountMenu } from '../components/AuthGate'
import { useStoryLiveUpdates } from '../components/useStoryLiveUpdates'
import { HelpTip } from '../components/HelpTip'
import { SANDBOX_ID, FIRST_SCENE, tourEvent, type Sandbox } from '../sandbox/storage'
import { SandboxHistory } from '../sandbox/History'
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
const PLACEHOLDERS_VIEW = 109

// One docked side panel; which tabs it offers depends on the mode (Context and Hints belong to Write).
type RefPanel = 'context' | 'hints' | 'insights' | 'feedback' | 'placeholders' | 'timeline' | 'places' | 'glossary' | 'assistant'
const REF_PANELS: [RefPanel, string][] = [['context', 'Context'], ['hints', 'Hints'], ['insights', 'Insights'], ['feedback', 'Feedback'], ['placeholders', 'TKs'], ['timeline', 'Timeline'], ['places', 'Places'], ['glossary', 'Glossary'], ['assistant', 'Assistant']]

export default function StoryWorkspace() {
  const { storyId = '' } = useParams()
  return <SavedWorkspace key={storyId} storyId={storyId} />
}

function SavedWorkspace({ storyId }: { storyId: string }) {
  const position = useQuery({ queryKey: ['workspace-position', storyId], queryFn: () => api.getWorkspacePosition(storyId), retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 0, gcTime: 0 })
  if (position.isPending) return <p className="p-6">Opening your story…</p>
  return <><Workspace storyId={storyId} initialPosition={position.data} syncPosition={!position.isError} />{position.isError && <p role="status" className="p-4">Your synced place could not be loaded. This session will not overwrite it. Reopen the story to retry.</p>}</>
}

export function Workspace({ storyId, sandboxStep, sandboxRun, sandboxHistory, initialPosition, syncPosition = false }: { storyId: string; sandboxStep?: number; sandboxRun?: number; sandboxHistory?: Sandbox; initialPosition?: WorkspacePlace | null; syncPosition?: boolean }) {
  const sandbox = storyId === SANDBOX_ID
  const placeholders = usePlaceholders(storyId, !sandbox)
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, enabled: !sandbox })
  const placeholderCount = placeholders.data?.findings.length ?? 0
  const openFeedback = useQuery({ queryKey: ['beta-feedback', storyId, 'open'], queryFn: () => api.betaFeedback(storyId), enabled: !sandbox, refetchInterval: 60_000 })
  const [feedbackFocus, setFeedbackFocus] = useState<string | null>(null)
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
  const [level, setLevel] = useState(() => initialPosition?.level ?? ([1, 2, 3, 4, 5, 6, 7, 8, INBOX_VIEW, GRID_VIEW, CATCHUP_VIEW, HISTORY_VIEW, EVALUATE_VIEW, PLACEHOLDERS_VIEW].includes(savedSearchContext.level) ? savedSearchContext.level as number : 1))
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
    if (initialPosition?.mode) return initialPosition.mode
    if (['write', 'read', 'design'].includes(savedSearchContext.tab)) return savedSearchContext.tab
    try { const saved = localStorage.getItem(`storytool-workspace:${storyId}`); return saved === 'write' || saved === 'read' ? saved : 'design' } catch { return 'design' }
  })
  const [writerOpened, setWriterOpened] = useState(tab === 'write')
  const [readerResume, setReaderResume] = useState(initialPosition?.reading)
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
    if (next === 'read') { setReaderResume(readingPosition.current); void qc.invalidateQueries({ queryKey: ['reading-document', storyId] }) }
    try { localStorage.setItem(`storytool-workspace:${storyId}`, next) } catch { /* Preference storage is optional. */ }
    return true
  }
  // Design pages (Grid, History, …) need the full width; the header's Agent changes badge opens one from any tab.
  const openView = async (view: number) => { if (await changeTab('design')) setLevel(view) }
  // Evaluate findings and placeholders open their exact passage in Write.
  const openPassage = (id: string, find: string, paragraph: number) => { void changeTab('write').then(ok => { if (ok) setWriterScene({ id, find, paragraph, at: Date.now() }) }) }
  const viewItem = (view: number, label: ReactNode) => <button type="button" data-view={view === GRID_VIEW ? 'grid' : undefined} aria-current={level === view ? 'page' : undefined} onClick={() => { setLevel(view); if (sandbox && view === HISTORY_VIEW) tourEvent('history'); if (sandbox && view === GRID_VIEW) tourEvent('grid') }}>{label}</button>
  // Reference panels sit beside the text in every tab, so looking something up never leaves the page.
  // The panel opens by default (Context in Write, Insights in Design); closing it is remembered for the visit.
  const [refPanel, setRefPanelPref] = useState<RefPanel | null>(() => REF_PANELS.some(([key]) => key === savedSearchContext.refPanel) ? savedSearchContext.refPanel : null)
  const [panelHidden, setPanelHidden] = useState(() => sandbox || window.matchMedia('(max-width: 1100px)').matches)
  const setRefPanel = (key: RefPanel | null) => { if (key) { setRefPanelPref(key); setPanelHidden(false) } else setPanelHidden(true) }
  // Write's reader-comment markers open the matching card in the Feedback panel.
  useEffect(() => {
    const open = (event: Event) => { setFeedbackFocus((event as CustomEvent<string>).detail); setRefPanelPref('feedback'); setPanelHidden(false) }
    window.addEventListener(OPEN_FEEDBACK_EVENT, open)
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, open)
  }, [])
  const [searchOpen, setSearchOpen] = useState(() => {
    try { return localStorage.getItem(`storytool-search-open:${storyId}`) === 'true' } catch { return false }
  })
  const [searchParams] = useSearchParams()
  const handledSearchTarget = useRef('')
  const navigate = useNavigate()
  const panelTabs = REF_PANELS.filter(([key]) => key === 'context' || key === 'hints' ? tab === 'write' : key === 'placeholders' ? tab === 'write' && !sandbox : key === 'insights' ? tab === 'design' && !sandbox : key === 'assistant' || key === 'feedback' ? !sandbox : true)
  const modePanel: RefPanel | null = tab === 'write' ? 'context' : tab === 'design' && !sandbox ? 'insights' : null
  const preferredPanel = panelTabs.some(([key]) => key === refPanel) ? refPanel : modePanel
  const activePanel = panelHidden ? null : preferredPanel
  // Something read-only beside the manuscript (a scene, character, place, term or image). It
  // takes the side panel's place while open and is remembered for the visit, per story.
  const besideKey = `storytool-beside:${storyId}`
  const [beside, setBesideState] = useState<BesideTarget | null>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(besideKey) || 'null'); return isBesideItem(saved) ? saved : null } catch { return null }
  })
  const setBeside = (target: BesideTarget | null) => {
    setBesideState(target)
    try { if (target && target.kind !== 'pick') sessionStorage.setItem(besideKey, JSON.stringify(target)); else sessionStorage.removeItem(besideKey) } catch { /* Optional browser storage. */ }
  }
  useEffect(() => {
    if (sandbox) return
    const open = (event: Event) => setBeside((event as CustomEvent<BesideTarget>).detail)
    window.addEventListener(OPEN_BESIDE_EVENT, open)
    return () => window.removeEventListener(OPEN_BESIDE_EVENT, open)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, sandbox])
  const hasPanel = Boolean(activePanel) || Boolean(beside)
  const [writerFocus, setWriterFocus] = useState(false)
  const [liveHints, setLiveHints] = useState(false)
  const [contextSlot, setContextSlot] = useState<HTMLElement | null>(null)
  const [hintsSlot, setHintsSlot] = useState<HTMLElement | null>(null)
  const selectPanel = (key: RefPanel) => { setRefPanel(key); if (key === 'context') { setSearchOpen(false); if (sandbox) tourEvent('context') } }
  const togglePanel = () => { if (beside) setBeside(null); else if (hasPanel) setRefPanel(null); else selectPanel(preferredPanel ?? 'timeline') }
  const openImages = async () => { if (!await writerFlush.current()) { setTabError('Save your writing before managing images.'); return } navigate(`/stories/${storyId}/images`) }
  useEffect(() => {
    const open = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true) } }
    window.addEventListener('keydown', open)
    return () => window.removeEventListener('keydown', open)
  }, [])
  const searchContext: SearchContext | null = activePanel === 'places' ? 'location'
    : activePanel === 'glossary' ? 'glossary_entry' : activePanel === 'timeline' ? 'timeline'
    : activePanel === 'assistant' ? null : tab !== 'design' ? 'prose'
    // Views without their own entity search the manuscript, so the launcher is never inert.
    : ({ 1: 'story', 2: 'event', 3: 'character', 4: 'act', 5: 'beat', 6: 'thread', 7: 'chapter', 8: 'scene', [GRID_VIEW]: 'scene' } as Record<number, SearchContext>)[level] ?? 'prose'
  useEffect(() => {
    try { localStorage.setItem(`storytool-search-open:${storyId}`, String(searchOpen)) } catch { /* Optional browser storage. */ }
  }, [storyId, searchOpen])
  // Restore the search's source context on refresh as well as its query and filters.
  useEffect(() => {
    if (!searchOpen) return
    try { localStorage.setItem(`storytool-search-context:${storyId}`, JSON.stringify({ tab, level, refPanel })) } catch { /* Optional browser storage. */ }
  }, [storyId, searchOpen, tab, level, refPanel])
  const [writerScene, setWriterScene] = useState<{ id: string; at: number; find?: string; paragraph?: number } | null>(null)
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
    document.querySelector<HTMLDialogElement>('dialog.story-search-dialog')?.close()
    const narrow = window.matchMedia('(max-width: 1100px)').matches
    if (hit.matches.some(match => match.field === 'content')) {
      if (tab === 'read' && !searchParams.get('image_ref')) setReaderScene({ sceneId: hit.id, sequence: Date.now() })
      else if (await changeTab('write')) {
        let find: string | undefined = searchParams.get('image_ref') || undefined
        if (sandbox) { try { find = JSON.parse(localStorage.getItem(`storytool-search:${storyId}:${searchContext}`) || '{}').q } catch { /* Selection remains optional. */ } }
        setWriterScene({ id: hit.id, at: Date.now(), find })
      }
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
  useEffect(() => { if (story.data?.title) document.title = `${story.data.title} · StoryTool` }, [story.data?.title])
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

  const [chapterId, setChapterId] = useState<string | null>(initialPosition?.chapter_id ?? null)
  const selectedChapter = chapters.data?.find((chapter) => chapter.id === chapterId)?.id ?? chapters.data?.[0]?.id ?? null
  const chapter = chapters.data?.find((item) => item.id === selectedChapter)
  const chapterIndex = chapters.data?.findIndex((item) => item.id === selectedChapter) ?? -1

  const brief = useQuery({
    queryKey: ['brief', storyId, selectedChapter],
    queryFn: () => api.getBrief(storyId, selectedChapter!),
    enabled: Boolean(selectedChapter),
  })

  const [sceneId, setSceneId] = useState<string | null>(initialPosition?.scene_id ?? null)
  const savePosition = useWorkspacePosition(storyId, initialPosition, { mode: tab, level: level as WorkspacePlace['level'], chapter_id: chapterId, scene_id: sceneId }, syncPosition && !sandbox, !!searchParams.get('search_id'))
  const readingPosition = useRef(initialPosition?.reading)
  const rememberReading = useCallback((reading: NonNullable<WorkspacePlace['reading']>) => { readingPosition.current = reading; savePosition({ reading }) }, [savePosition])
  const rememberChapter = useCallback((write_chapter_id: string) => { if (tab === 'write') savePosition({ write_chapter_id }) }, [tab, savePosition])
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

  useEffect(() => {
    if (!sandbox || !sandboxStep) return
    if (sandboxStep === 1) { void changeTab('read'); setReaderScene({ sceneId: FIRST_SCENE, sequence: Date.now() }) }
    if (sandboxStep === 2 || sandboxStep === 3) { void changeTab('write'); setWriterScene({ id: FIRST_SCENE, at: Date.now() }) }
    // "Open Context" must open Context, not whichever panel tab was used last.
    if (sandboxStep === 3) { setRefPanelPref('context'); setPanelHidden(true) }
    if (sandboxStep === 4) setRefPanel('timeline')
    if (sandboxStep === 5) {
      setRefPanel(null)
      void changeTab('write').then(ok => { if (ok) { localStorage.setItem(`storytool-search:${storyId}:prose`, JSON.stringify({ q: 'lantern', field: '', entity: '' })); setSearchOpen(true) } })
    }
    if (sandboxStep === 6) { setSearchOpen(false); setRefPanel(null) }
    // The plan for plotters: open Design on the first level; the tour then points at Grid.
    if (sandboxStep === 7) { setSearchOpen(false); void changeTab('design').then(ok => { if (ok) setLevel(1) }) }
    // The persisted step drives navigation once; ordinary browsing remains free.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxStep, sandbox, sandboxRun])
  // One bar instead of two: the workspace bar carries the site header's links while open.
  useEffect(() => {
    document.documentElement.classList.add('ws-active')
    return () => document.documentElement.classList.remove('ws-active')
  }, [])
  useEffect(() => {
    if (!sandbox) return
    window.storytoolTryFlush = () => writerFlush.current()
    const history = () => { void changeTab('design').then(ok => { if (ok) { setLevel(HISTORY_VIEW); tourEvent('history') } }) }
    window.addEventListener('storytool-try-history', history)
    return () => { delete window.storytoolTryFlush; window.removeEventListener('storytool-try-history', history) }
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
    <main data-workspace-story={storyId} data-workspace-ready={!chapters.isPending && !scenes.isPending ? true : undefined} className="workspace-page ws-page">
      {searchParams.get('sandbox_saved') === '1' && <p role="status" className="try-saved">Your Last Lantern is saved. <Link to="/library">Start your own story →</Link></p>}
      <header className="ws-bar">
        <Link to="/" className="ws-brand" aria-label="StoryTool home" title="StoryTool home"><img src="/branding/storytool.svg" alt="" width="26" height="26" /></Link>
        {!sandbox && <Link to="/library" className="ws-back" aria-label="All stories" title="All stories">‹</Link>}
        <div className="ws-title"><h1>{story.data.title}</h1>{progress.data && <span>{progress.data.word_count.toLocaleString()} words · {progress.data.drafted_scene_count}/{progress.data.scene_count} scenes drafted</span>}</div>
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
        <button id="story-search-toggle" type="button" className="workspace-search-entry search-launcher" aria-haspopup="dialog" onClick={() => setSearchOpen(true)} disabled={!searchContext}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><span>Search this section…</span>
        </button>
        <p className={`live-update-status in-bar${live.activity.isError ? ' is-paused' : ''}`} role="status">{live.activity.isError ? <>Live updates paused.<button type="button" onClick={() => { void live.activity.refetch() }}>Retry</button></> : <><span className="group relative inline-flex cursor-help items-center p-1.5 -m-1.5" tabIndex={0} aria-label="Live updates on"><span className="live-dot" /><span role="tooltip" className="pointer-events-none absolute left-0 top-6 z-30 hidden w-64 rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-700 shadow-lg group-hover:block group-focus:block dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Live: changes from agents and other tabs appear here on their own. No need to refresh.</span></span>{justUpdated && <span className="live-updated">Updated just now</span>}</>}</p>
          {pendingRuns > 0 && <button type="button" className="workspace-ref-alert" onClick={() => { void openView(INBOX_VIEW) }}>Agent changes<span className="workspace-nav-badge" aria-label={`${pendingRuns} pending`}>{pendingRuns}</span></button>}
        <div className="ws-bar-actions">
          {tab === 'write' && <IconButton label="Focus mode" onClick={() => setWriterFocus(true)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg></IconButton>}
          <IconButton label="History" aria-pressed={tab === 'design' && level === HISTORY_VIEW} onClick={() => { void openView(HISTORY_VIEW).then(() => { if (sandbox) tourEvent('history') }) }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg></IconButton>
          <IconButton label={hasPanel ? 'Hide side panel' : tab === 'write' ? 'Show context and side panel' : 'Show side panel'} aria-pressed={hasPanel} className={tab === 'write' && !hasPanel ? 'writer-context-toggle' : ''} onClick={togglePanel}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg></IconButton>
          {!sandbox && <StorySharing menu betaOpen={openFeedback.data?.length ?? 0} storyId={storyId} title={story.data.title} blurb={story.data.blurb} beforeOpen={() => tab === 'write' ? writerFlush.current() : Promise.resolve(true)} extraItems={<MenuItem onSelect={() => { void openImages() }}>Images</MenuItem>} />}
          {/* Export is first-class: the words must always be able to leave. */}
          {!sandbox && <DownloadMenu storyId={storyId} onShowPlaceholders={() => { void openView(PLACEHOLDERS_VIEW) }} />}
          {/* The site header is hidden while a workspace is open; its links live here. */}
          {!sandbox && <Menu label="⋯" ariaLabel="Site menu" triggerClassName="share-story-button"><MenuItem onSelect={() => navigate('/library')}>Your stories</MenuItem><MenuItem onSelect={() => navigate('/how-to-use')}>How to use</MenuItem><MenuItem onSelect={() => navigate('/roadmap')}>Roadmap</MenuItem><MenuItem onSelect={() => navigate('/about')}>About</MenuItem><MenuItem onSelect={() => navigate('/#mcp')}>Connect AI</MenuItem><MenuItem onSelect={() => navigate('/feedback')}>Feedback</MenuItem></Menu>}
          <ThemeToggle />
          {!sandbox && <AccountMenu />}
        </div>
      </header>
      {tabError && <p role="alert" className="writer-error">{tabError}</p>}
      <div className={`ws-body${hasPanel ? ' has-panel' : ''}`}>
      <div className="min-w-0">
      <div id="workspace-panel-write" role="tabpanel" aria-labelledby="workspace-tab-write" hidden={tab !== 'write'}>
        {writerOpened && <Suspense fallback={<p className="p-6">Loading writing workspace…</p>}><StoryWriter storyId={storyId} focus={writerFocus} onFocusChange={setWriterFocus} liveHints={liveHints} contextSlot={activePanel === 'context' ? contextSlot : null} hintsSlot={activePanel === 'hints' ? hintsSlot : null} initialChapter={initialPosition?.write_chapter_id} onChapterChange={rememberChapter} registerFlush={registerFlush} openScene={writerScene} /></Suspense>}
      </div>
      <div id="workspace-panel-read" role="tabpanel" aria-labelledby="workspace-tab-read" hidden={tab !== 'read'}>
        {tab === 'read' && <Suspense fallback={<p className="p-6">Loading reader…</p>}><StoryReader storyId={storyId} owned embedded initialPosition={readerResume} onPosition={rememberReading} openTarget={readerScene} /></Suspense>}
      </div>
      <div id="workspace-panel-design" role="tabpanel" aria-labelledby="workspace-tab-design" hidden={tab !== 'design'}>
      <div className="ws-design">
        <nav aria-label="Story design" className="workspace-nav ws-rail">
          <h2>Plan</h2>
          {ladder.data && <Ladder ladder={ladder.data} mode={story.data.authoring_mode as AuthoringMode} activeLevel={level} onSelect={selectLevel} />}
          <h2>Review</h2>
          {viewItem(GRID_VIEW, 'Grid')}
          {!sandbox && viewItem(INBOX_VIEW, <>Agent changes{pendingRuns > 0 && <span className="workspace-nav-badge" aria-label={`${pendingRuns} pending`}>{pendingRuns}</span>}</>)}
          {!sandbox && viewItem(CATCHUP_VIEW, 'Catch up')}
          {!sandbox && viewItem(EVALUATE_VIEW, 'Evaluate')}
          {!sandbox && viewItem(PLACEHOLDERS_VIEW, placeholderCount ? <>Placeholders<span className="workspace-nav-badge" aria-label={`${placeholderCount} left`}>{placeholderCount}</span></> : 'Placeholders')}
          {viewItem(HISTORY_VIEW, 'History')}
        </nav>
        <div className="min-w-0">
      {story.data.genre === 'Tutorial · timelines and arcs' && <TutorialWalkthrough onTimeline={() => setRefPanel('timeline')} onCharacters={() => setLevel(3)} onScenes={() => setLevel(8)} onPractice={() => { const practice = scenes.data?.find((item) => item.title?.startsWith('Practice placeholder')); if (practice) { setSceneId(practice.id); setChapterId(practice.chapter_id) }; setLevel(8) }} />}
        <section ref={levelSection} id="story-search-design-section" className="min-w-0 scroll-mt-4">
          {level === INBOX_VIEW && <ProposalInbox storyId={storyId} />}
          {level === CATCHUP_VIEW && <OutlineCatchup storyId={storyId} onOpenInbox={() => setLevel(INBOX_VIEW)} />}
          {level === PLACEHOLDERS_VIEW && !sandbox && <section><h2 className="level-title">Placeholders</h2><PlaceholderList storyId={storyId} beforeEdit={() => writerFlush.current()} onOpen={openPassage} /></section>}
          {level === EVALUATE_VIEW && <StoryEvaluation storyId={storyId} beforeEdit={() => writerFlush.current()} onOpenPassage={openPassage} onOpenInbox={() => setLevel(INBOX_VIEW)} onOpenScene={(scene) => { setChapterId(scene.chapter_id); setSceneId(scene.id); setLevel(8); void revealSearchTarget('story-search-design-section').catch(error => setTabError(String(error))) }} onOpenThreads={(id) => { setLevel(6); void revealSearchTarget(`search-thread-${id}`).catch(error => setTabError(String(error))) }} onOpenCharacters={(id) => { setLevel(3); void revealSearchTarget(`character-${id}`).catch(error => setTabError(String(error))) }} onOpenStory={() => setLevel(1)} />}
          {level === GRID_VIEW && <StoryGrid storyId={storyId} onOpenInbox={() => setLevel(INBOX_VIEW)} onOpenScene={(scene) => { setChapterId(scene.chapter_id ?? null); setSceneId(scene.id); setLevel(8) }} />}
          {level === HISTORY_VIEW && sandboxHistory && <SandboxHistory value={sandboxHistory} />}
          {level === HISTORY_VIEW && !sandbox && <div>
            <div className="history-tabs" role="tablist" aria-label="History">
              <button type="button" role="tab" aria-selected={historyTab === 'versions'} onClick={() => setHistoryTab('versions')}>Versions</button>
              <button type="button" role="tab" aria-selected={historyTab === 'authorship'} onClick={() => setHistoryTab('authorship')}>Who wrote what</button>
            </div>
            {historyTab === 'versions' ? <StoryVersions storyId={storyId} /> : <><DisclosureCard storyId={storyId} /><AuthorshipPanel storyId={storyId} /></>}
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
                <label className="block text-xs text-slate-500 dark:text-slate-400"><span className="field-label">Language</span><HelpTip label="language">The spelling convention for this story. Smart consistency in Evaluate flags spellings from the other variety (colour in a US story, color in a UK one). Leave it on the default to follow your account setting.</HelpTip><span className="mt-1 block max-w-xs"><InlineSelect value={story.data.language} options={LANGUAGES.map(language => ({ value: language.id, label: language.label }))} placeholder={`Account default (${languageLabel(me.data?.language)})`} onSave={(language) => updateStory.mutateAsync({ language: language as StoryUpdate['language'] })} /></span></label>
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
        </div>
      </div>
      </div>
      </div>
      <aside hidden={!hasPanel} className="workspace-ref-panel ws-panel" aria-label="Side panel">
        {beside && <BesidePanel storyId={storyId} target={beside} onChange={setBeside} onClose={() => setBeside(null)} />}
        {!beside && <>
        <div className="workspace-ref-head">
          <Tabs label="Side panel" value={activePanel ?? panelTabs[0][0]} onChange={selectPanel} items={panelTabs.map(([key, label]) => ({ id: key, label: key === 'feedback' && openFeedback.data?.length ? `${label} (${openFeedback.data.length})` : key === 'placeholders' && placeholderCount ? `${label} (${placeholderCount})` : label, className: key === 'context' ? 'writer-context-toggle' : undefined }))} />
          <div><button type="button" aria-label="Search this panel" title="Search this panel" onClick={() => setSearchOpen(true)} disabled={!searchContext}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></button><button type="button" aria-label="Close panel" onClick={() => setRefPanel(null)}>✕</button></div>
        </div>
        {activePanel === 'context' && <div ref={setContextSlot} />}
        {activePanel === 'hints' && <div className="ws-hints">
          <label className="ws-hints-toggle"><input type="checkbox" checked={liveHints} onChange={event => setLiveHints(event.target.checked)} /> Live hints for the scene you are writing</label>
          <p className="writer-help">The shared reader reads only the current scene, about two seconds after you stop typing. Hints never change your prose.</p>
          <div ref={setHintsSlot} />
        </div>}
        {activePanel === 'insights' && <InsightsPanel storyId={storyId} health={health.data} level={level} levelNames={Object.fromEntries((ladder.data?.levels ?? []).map(rung => [rung.level, rung.label]))} onOpenLevel={selectLevel} />}
        {activePanel === 'timeline' && <StoryTimeline storyId={storyId} compact allowInsert={tab !== 'read'} onOpenScene={openScene} onOpenCharacter={(id) => { void openCharacter(id) }} />}
        {activePanel === 'places' && <PlacesPanel storyId={storyId} />}
        {activePanel === 'feedback' && <BetaFeedbackPanel storyId={storyId} focusId={feedbackFocus} onShowInWrite={(id, find) => { void changeTab('write').then(ok => { if (ok) setWriterScene({ id, at: Date.now(), find: find || undefined }) }) }} />}
        {activePanel === 'glossary' && <GlossaryPanel storyId={storyId} />}
        {activePanel === 'placeholders' && <PlaceholderList storyId={storyId} compact beforeEdit={() => writerFlush.current()} onOpen={openPassage} />}
        {activePanel === 'assistant' && <AuthoringAssistant storyId={storyId} />}
        </>}
      </aside>
      </div>
      <SearchDialog storyId={storyId} initialQuery={sandboxStep === 5 ? 'lantern' : undefined} context={searchContext} active={searchOpen} onClose={() => setSearchOpen(false)} onReopen={() => setSearchOpen(true)} onOpen={async hit => { await openSearchHit(hit); if (sandbox) tourEvent('search') }} />
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
