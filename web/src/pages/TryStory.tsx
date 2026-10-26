import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { getVisitorId } from '../api/visitor'
import { AuthGate } from '../components/AuthGate'
import { Workspace } from './StoryWorkspace'
import { rows, sandboxData, resetSandbox, SANDBOX_ID, FIRST_SCENE, transact } from '../sandbox/storage'
import '../sandbox/sandbox.css'
import { DiscoverTour } from '../sandbox/DiscoverTour'
import { t, tx } from '../i18n'

const instructions = [
  tx('This is Maya\'s story. Turn a page.'),
  tx('Add a sentence: what does Maya see? Right-click the prose for editing actions and image insertion.'),
  tx('Every scene knows its beat, its POV and Maya\'s arc. Open Context.'),
  tx('The harbor secret happened years earlier. Readers just learn it later. Flip World time ↔ Reading order.'),
  tx('Jump straight to any line. Open an Exact result for lantern.'),
  tx('Every change is on record. Open History to see what you wrote.'),
  tx('Plotting instead? Design holds an eight-level plan, from premise to scenes, and Grid shows every scene at a glance. Open the Grid.'),
]
const events = ['page', 'write', 'context', 'timeline', 'search', 'history', 'grid']
const LAST_STEP = events.length
const doneSteps = (state: { doneSteps?: number[]; completed: boolean; step: number }) => state.doneSteps ?? Array.from({ length: state.completed ? LAST_STEP : state.step - 1 }, (_, index) => index + 1)
let sending = false
async function flushEvents() {
  if (sending || !getVisitorId()) return
  sending = true
  try {
    const state = await sandboxData()
    if (!state.events.length) return
    await api.recordTryEvents(state.events)
    await transact(value => { value.events = value.events.filter(event => !state.events.includes(event)) })
  } catch { /* Analytics never delays the sandbox. Retry on return or the next event. */ }
  finally { sending = false }
}
async function milestone(event: string) {
  await transact(state => { if (!state.events.includes(event)) state.events.push(event) })
  void flushEvents()
}
export default function TryStory() {
  const query = useQuery({ queryKey: ['sandbox'], queryFn: sandboxData, retry: false })
  const [error, setError] = useState('')
  const [resetting, setResetting] = useState(false)
  const [keeping, setKeeping] = useState(false)
  const [coachHost, setCoachHost] = useState<HTMLElement | null>(null)
  const [tourRun, setTourRun] = useState(0)
  const [tourMoving, setTourMoving] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  useEffect(() => {
    const showImages = () => setDiscoverOpen(true)
    window.addEventListener('storytool-try-images', showImages)
    return () => window.removeEventListener('storytool-try-images', showImages)
  }, [])
  const bannerRef = useRef<HTMLDivElement>(null)
  const coachRef = useRef<HTMLElement>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const state = query.data
  useLayoutEffect(() => {
    const banner = bannerRef.current, coach = coachRef.current
    const measure = () => {
      document.documentElement.style.setProperty('--try-banner-height', `${banner?.getBoundingClientRect().height ?? 0}px`)
      document.documentElement.style.setProperty('--try-coach-height', `${coach?.getBoundingClientRect().height ?? 0}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (banner) observer.observe(banner)
    if (coach) observer.observe(coach)
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--try-banner-height'); document.documentElement.style.removeProperty('--try-coach-height') }
  }, [state?.created, state?.skipped, state?.completed, coachHost])
  useEffect(() => {
    if (!state || state.skipped || state.completed || discoverOpen) return
    const selectors = [
      // Labels are translated, so the selectors use the same t() text as the buttons.
      `#workspace-panel-read [aria-label="${CSS.escape(t('Next reading page'))}"]:not([disabled])`,
      `[data-writing-scene="${FIRST_SCENE}"] .cm-editor`,
      '.writer-context-toggle',
      `.workspace-ref-panel [aria-label="${CSS.escape(t('Timeline order'))}"] button[aria-pressed="false"]`,
      '.story-search-dialog li button',
      '.try-coach .sharing-primary',
      '.ws-rail [data-view="grid"]',
    ]
    let highlighted: HTMLElement | undefined
    let observer: MutationObserver | undefined
    const reveal = () => {
      const target = Array.from(document.querySelectorAll<HTMLElement>(selectors[state.step - 1])).find(element => element.getClientRects().length > 0)
      if (!target) return false
      if (target === highlighted) return true
      highlighted?.removeAttribute('data-try-target')
      highlighted = target
      target.setAttribute('data-try-target', 'true')
      const scrollTarget = state.step === 2 ? target.querySelector('.cm-line:last-child') ?? target : target
      scrollTarget.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center', inline: 'nearest' })
      observer?.disconnect()
      return true
    }
    // Lazy-loaded editors, pagination and search results can arrive after the step.
    if (!reveal()) {
      observer = new MutationObserver(reveal)
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'aria-pressed'] })
    }
    return () => { observer?.disconnect(); highlighted?.removeAttribute('data-try-target') }
  }, [state?.step, state?.skipped, state?.completed, tourRun, coachHost, discoverOpen])
  useEffect(() => {
    if (state?.step !== 5) { setCoachHost(null); return }
    const updateHost = () => {
      const host = document.getElementById('try-search-coach')
      const dialog = host?.closest('dialog')
      setCoachHost(dialog?.open ? host : null)
    }
    updateHost()
    const observer = new MutationObserver(updateHost)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    return () => observer.disconnect()
  }, [state?.step])
  useEffect(() => {
    void flushEvents()
    const listener = (event: Event) => {
      const name = (event as CustomEvent<string>).detail
      void transact(value => {
        if (value.skipped || value.completed || events[value.step - 1] !== name) return
        value.doneSteps = doneSteps(value)
        if (!value.doneSteps.includes(value.step)) { value.doneSteps.push(value.step); if (value.step < LAST_STEP) value.events.push(`try_step_${value.step}`) }
      }).then(() => { void qc.invalidateQueries({ queryKey: ['sandbox'] }); void flushEvents() }).catch(e => setError(String(e)))
    }
    const online = () => { void flushEvents() }
    window.addEventListener('storytool-try-event', listener)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('storytool-try-event', listener); window.removeEventListener('online', online) }
  }, [qc])
  const keep = async () => {
    setKeeping(true); setError('')
    try {
      // Every mounted writer registers its flush here, including during free play.
      const flush = window.storytoolTryFlush
      if (flush && !await flush()) throw new Error(t('Your line has not saved yet. Retry the save before keeping this story.'))
      await milestone('try_keep_click')
      navigate('/try/keep')
    } catch (e) { setError(String(e)); setKeeping(false) }
  }
  // Leaving keeps the sandbox in this browser; save the open line first.
  const exit = async () => {
    try {
      if (window.storytoolTryFlush && !await window.storytoolTryFlush()) throw new Error(t('Your line has not saved yet. Retry the save before leaving.'))
      navigate('/')
    } catch (e) { setError(String(e)) }
  }
  // Restart goes back to step 1 from anywhere (a stuck or finished tour) and keeps the visitor's edits.
  const resumeTour = async (restart = false) => {
    try {
      setError('')
      if (window.storytoolTryFlush && !await window.storytoolTryFlush()) throw new Error(t('Save your writing before resuming the tour.'))
      await transact(value => { value.skipped = false; if (restart || value.completed) { value.step = 1; value.completed = false; value.doneSteps = [] } })
      await query.refetch()
      setTourRun(value => value + 1)
    } catch (e) { setError(String(e)) }
  }
  const moveTour = async (direction: number) => {
    setTourMoving(true)
    try {
      if (window.storytoolTryFlush && !await window.storytoolTryFlush()) throw new Error(t('Save your writing before changing tour steps.'))
      await transact(value => {
        if (direction > 0 && !doneSteps(value).includes(value.step)) return
        if (direction > 0 && value.step === LAST_STEP) { value.completed = true; value.events.push(`try_step_${LAST_STEP}`) }
        else { value.step = Math.max(1, Math.min(LAST_STEP, value.step + direction)); value.completed = false }
      })
      await query.refetch()
      void flushEvents()
    } catch (e) { setError(String(e)) }
    finally { setTourMoving(false) }
  }
  if (!state) return <main className="p-8"><h1>{t('The Last Lantern')}</h1>{query.error ? <><p role="alert">{String(query.error)}</p><button onClick={() => void query.refetch()}>{t('Retry')}</button></> : <p>{t('Opening your browser sandbox…')}</p>}</main>
  const coach = !state.skipped && <aside ref={coachRef} id="try-tour" className="try-coach" aria-label={t('Guided sandbox tour')}>
      <div className="try-progress"><span>{t('{0} of {1}', state.step, LAST_STEP)}</span><span aria-hidden="true">{events.map((_, i) => <i key={i} className={i < state.step ? 'filled' : ''} />)}</span><button onClick={() => { void transact(value => { value.skipped = true; value.events.push('try_skip') }).then(() => { void query.refetch(); void flushEvents() }).catch(e => setError(String(e))) }}>{t('Skip tour')}</button></div>
      <p>{state.completed ? t('Every change is on record. Keep this story and everything you wrote.') : t(instructions[state.step - 1] ?? '')}</p>
      {state.step === 2 && !state.completed && <button className="share-story-button" onClick={() => window.dispatchEvent(new Event('storytool-try-images'))}>{t('Try inserting an image →')}</button>}
      {state.step === 6 && !state.completed && <button className="sharing-primary" onClick={() => window.dispatchEvent(new Event('storytool-try-history'))}>{t('Open History')}</button>}
      {!state.completed && <div className="try-tour-navigation"><button disabled={tourMoving || state.step === 1} onClick={() => void moveTour(-1)}>{t('← Previous')}</button><span>{doneSteps(state).includes(state.step) ? t('Ready when you are') : t('Complete the action above')}</span><button className="sharing-primary" disabled={tourMoving || !doneSteps(state).includes(state.step)} onClick={() => void moveTour(1)}>{state.step === LAST_STEP ? t('Finish tour') : t('Continue tour')}</button></div>}
      {state.completed && <div className="flex flex-wrap gap-3"><button className="sharing-primary" disabled={keeping} onClick={() => void keep()}>{t('Keep this story in your account')}</button><button onClick={() => { void transact(value => { value.skipped = true }).then(() => query.refetch()) }}>{t('Keep exploring')}</button></div>}
    </aside>
  return <div className="try-page" data-try-step={state.skipped ? 0 : state.step}>
    <div ref={bannerRef} className="try-banner"><span>{t('Sandbox · your changes stay in this browser')}</span><button className="try-tour-button" aria-controls="try-tour" onClick={() => void resumeTour()}>{!state.skipped && !state.completed ? t('Tour · {0} of {1}', state.step, LAST_STEP) : state.completed || state.step === 1 ? t('Start tour') : t('Resume tour')}</button><button className="try-discover-button" onClick={() => setDiscoverOpen(true)}>{t('Discover more →')}</button><button disabled={keeping} onClick={() => void keep()}>{t('Keep this story free →')}</button><button onClick={() => void exit()}>{t('Exit')}</button><details><summary aria-label={t('Sandbox menu')}>⋯</summary><button onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void resumeTour(true) }}>{t('Restart tour')}</button><button disabled={resetting} onClick={() => { if (!confirm(t('Reset The Last Lantern and remove your sandbox edits?'))) return; setResetting(true); void resetSandbox().then(() => { qc.removeQueries({ predicate: query => query.queryKey.includes(SANDBOX_ID) || query.queryKey[0] === 'sandbox' }); location.assign('/try') }).catch(e => { setError(String(e)); setResetting(false) }) }}>{t('Reset sandbox')}</button></details></div>
    {error && <p role="alert" className="p-3 writer-error">{error}</p>}
    <Workspace storyId={SANDBOX_ID} sandboxStep={state.skipped ? 0 : state.step} sandboxRun={tourRun} sandboxHistory={state} />
    <DiscoverTour open={discoverOpen} onClose={() => setDiscoverOpen(false)} onKeep={() => { setDiscoverOpen(false); void keep() }} />
    {coachHost ? createPortal(coach, coachHost) : coach}
  </div>
}
export function TryKeep() { return <AuthGate prompt={t('Keep your Last Lantern and everything you wrote. Sign in with Google for a free account.')}><KeepSaved /></AuthGate> }
function KeepSaved() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let mounted = true
    async function restore() {
      const state = await sandboxData()
      const user = await api.currentUser()
      let id = state.importedUser === user.id ? state.imported : undefined
      if (!id) {
        const story = await api.importBackup({ ...state.backup, sandbox: { import_id: state.importId, edited_scene_id: state.editedScene, edits: state.edits.map(edit => ({ scene_id: edit.scene_id, created_at: edit.created_at })) } })
        id = story.id
        await transact(value => { value.imported = id; value.importedUser = user.id; value.events.push('try_imported') })
      }
      // Import remaps IDs; resolve the edited scene by its preserved reading position.
      const original = rows(state, 'scene').find(scene => scene.id === state.editedScene)
      const oldChapter = rows(state, 'chapter').find(chapter => chapter.id === original?.chapter_id)
      const chapters = await api.listChapters(id)
      const chapter = chapters.find(chapter => chapter.number === oldChapter?.number && chapter.sort_key === oldChapter?.sort_key)
      const scenes = await api.listScenes(id)
      const authorship = await api.getAuthorship(id)
      const latestEdit = authorship.find(entry => entry.origin === 'author' && entry.actor_label === 'You' && entry.entity_type === 'scene' && entry.field === 'content')
      const scene = scenes.find(scene => scene.id === latestEdit?.entity_id) ?? scenes.find(scene => scene.chapter_id === (chapter?.id ?? null) && scene.sort_key === original?.sort_key && scene.title === original?.title)
      localStorage.setItem(`storytool-workspace:${id}`, 'write')
      void qc.invalidateQueries({ queryKey: ['stories'] })
      void flushEvents()
      if (mounted) navigate(`/stories/${id}?sandbox_saved=1${scene ? `&search_entity=scene&search_id=${scene.id}&search_field=content` : ''}`, { replace: true })
    }
    void restore().catch(e => { if (mounted) setError(String(e)) })
    return () => { mounted = false }
  }, [navigate, qc, retry])
  return <main className="p-8"><h1>{t('Keeping your Last Lantern')}</h1>{error ? <><p role="alert" className="writer-error">{error}</p><p>{t('Your writing is still in this browser.')}</p><button onClick={() => { setError(''); setRetry(value => value + 1) }}>{t('Retry')}</button> · <Link to="/try">{t('Keep exploring')}</Link></> : <p>{t('Saving your story to your library…')}</p>}</main>
}
export function TryLocked() { return <main className="p-8"><p>{t('Available with a free account')}</p><Link className="sharing-primary" to="/try/keep">{t('Keep this story →')}</Link> · <Link to="/try">{t('Back to sandbox')}</Link></main> }
declare global { interface Window { storytoolTryFlush?: () => Promise<boolean> } }
