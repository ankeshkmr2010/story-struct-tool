import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { getVisitorId } from '../api/visitor'
import { AuthGate } from '../components/AuthGate'
import { Workspace } from './StoryWorkspace'
import { rows, sandboxData, resetSandbox, SANDBOX_ID, transact } from '../sandbox/storage'
import '../sandbox/sandbox.css'

const instructions = [
  "This is Maya's story. Turn a page.",
  'Add a sentence: what does Maya see?',
  "Every scene knows its beat, its POV and Maya's arc. Open Context.",
  'The harbor secret happened years earlier. Readers just learn it later. Flip World time ↔ Reading order.',
  'Jump straight to any line. Open an Exact result for lantern.',
  'Every change is on record. Open History to see what you wrote.',
]
const events = ['page', 'write', 'context', 'timeline', 'search', 'history']
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
  const qc = useQueryClient()
  const navigate = useNavigate()
  const state = query.data
  useEffect(() => {
    if (state?.step !== 5) { setCoachHost(null); return }
    const findHost = () => {
      const host = document.getElementById('try-search-coach')
      if (host) { setCoachHost(host); return true }
      return false
    }
    if (findHost()) return
    const observer = new MutationObserver(() => { if (findHost()) observer.disconnect() })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [state?.step])
  useEffect(() => {
    void flushEvents()
    const listener = (event: Event) => {
      const name = (event as CustomEvent<string>).detail
      void transact(value => {
        if (value.skipped || value.completed || events[value.step - 1] !== name) return
        value.events.push(`try_step_${value.step}`)
        if (value.step === 6) value.completed = true
        else value.step += 1
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
      if (flush && !await flush()) throw new Error('Your line has not saved yet. Retry the save before keeping this story.')
      await milestone('try_keep_click')
      navigate('/try/keep')
    } catch (e) { setError(String(e)); setKeeping(false) }
  }
  if (!state) return <main className="p-8"><h1>The Last Lantern</h1>{query.error ? <><p role="alert">{String(query.error)}</p><button onClick={() => void query.refetch()}>Retry</button></> : <p>Opening your browser sandbox…</p>}</main>
  const coach = !state.skipped && <aside className="try-coach" aria-label="Guided sandbox tour">
      <div className="try-progress"><span>{state.step} of 6</span><span aria-hidden="true">{events.map((_, i) => <i key={i} className={i < state.step ? 'filled' : ''} />)}</span><button onClick={() => { void transact(value => { value.skipped = true; value.events.push('try_skip') }).then(() => { void query.refetch(); void flushEvents() }).catch(e => setError(String(e))) }}>Skip tour</button></div>
      <p>{state.completed ? 'Every change is on record. Keep this story and everything you wrote.' : instructions[state.step - 1]}</p>
      {state.step === 6 && !state.completed && <button className="sharing-primary" onClick={() => window.dispatchEvent(new Event('storytool-try-history'))}>Open History</button>}
      {state.completed && <div className="flex flex-wrap gap-3"><button className="sharing-primary" disabled={keeping} onClick={() => void keep()}>Keep this story, sign in with Google</button><button onClick={() => { void transact(value => { value.skipped = true }).then(() => query.refetch()) }}>Keep exploring</button></div>}
    </aside>
  return <div className="try-page" data-try-step={state.skipped ? 0 : state.step}>
    <div className="try-banner"><span>Sandbox · your changes stay in this browser</span><button disabled={keeping} onClick={() => void keep()}>Keep this story free →</button><details><summary aria-label="Sandbox menu">⋯</summary><button disabled={resetting} onClick={() => { if (!confirm('Reset The Last Lantern and remove your sandbox edits?')) return; setResetting(true); void resetSandbox().then(() => { qc.removeQueries({ predicate: query => query.queryKey.includes(SANDBOX_ID) || query.queryKey[0] === 'sandbox' }); location.assign('/try') }).catch(e => { setError(String(e)); setResetting(false) }) }}>Reset sandbox</button></details></div>
    {error && <p role="alert" className="p-3 writer-error">{error}</p>}
    <Workspace storyId={SANDBOX_ID} sandboxStep={state.skipped ? 0 : state.step} sandboxHistory={state} />
    {coachHost ? createPortal(coach, coachHost) : coach}
  </div>
}
export function TryKeep() { return <AuthGate prompt="Keep your Last Lantern and everything you wrote. Sign in with Google for a free account."><KeepSaved /></AuthGate> }
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
  return <main className="p-8"><h1>Keeping your Last Lantern</h1>{error ? <><p role="alert" className="writer-error">{error}</p><p>Your writing is still in this browser.</p><button onClick={() => { setError(''); setRetry(value => value + 1) }}>Retry</button> · <Link to="/try">Keep exploring</Link></> : <p>Saving your story to your library…</p>}</main>
}
export function TryLocked() { return <main className="p-8"><p>Available with a free account</p><Link className="sharing-primary" to="/try/keep">Keep this story →</Link> · <Link to="/try">Back to sandbox</Link></main> }
declare global { interface Window { storytoolTryFlush?: () => Promise<boolean> } }
