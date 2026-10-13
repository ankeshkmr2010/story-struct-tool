import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, type BetaDocument } from '../api/client'
import { errorText } from '../api/errors'
import { StoryReader } from './SharedStoryReader'
import { BetaPollCard } from '../components/BetaPollCard'

type Seed = { chapter_id?: string | null; scene_id?: string | null; quote?: string | null; paragraph?: number | null }

export function BetaInvitePage() {
  const { token = '' } = useParams()
  const invite = useQuery({ queryKey: ['beta-invite', token], queryFn: () => api.betaInvite(token), refetchInterval: 15000, retry: false })
  const join = useMutation({ mutationFn: () => api.joinBeta(token), onSuccess: () => void invite.refetch() })
  if (invite.isPending) return <p className="p-8">Loading beta invitation…</p>
  if (invite.error) return <p role="alert" className="writer-error p-8">{errorText(invite.error)}</p>
  const data = invite.data!
  return <main className="mx-auto max-w-2xl px-5 py-12 text-[var(--ink)]"><p className="eyebrow">BETA INVITATION</p><h1 className="mt-4 text-3xl font-semibold">{data.story_title}</h1><h2 className="mt-3 text-xl">{data.round.title}</h2>{data.round.brief && <p className="mt-5 whitespace-pre-wrap leading-7">{data.round.brief}</p>}{data.round.deadline && <p className="mt-3 text-sm">Requested by {new Date(data.round.deadline).toLocaleDateString()}</p>}
    {['approved', 'owner'].includes(data.membership) ? <Link className="landing-primary mt-6" to={`/beta/rounds/${data.round.id}`}>Open beta manuscript →</Link> : data.membership === 'pending' ? <p role="status" className="mt-6">Your access request is waiting for the author. This page checks for approval; the round also appears in Shared with you once approved.</p> : ['revoked', 'declined'].includes(data.membership) ? <p className="mt-6">Access is unavailable. Ask the author to restore it.</p> : <><p className="mt-5 text-sm text-[var(--muted)]">{data.round.auto_approve ? 'The author allows signed-in readers with this link to join.' : 'The author must approve your request before you can read.'} Your comments are private to you and the author. Reading progress is self-reported.</p><button className="landing-primary mt-5" disabled={join.isPending} onClick={() => join.mutate()}>{join.isPending ? 'Requesting…' : data.round.auto_approve ? 'Join beta read' : 'Request access'}</button></>}
    {join.error && <p role="alert" className="writer-error mt-4">{errorText(join.error)}</p>}
  </main>
}

export default function BetaReaderPage() {
  const { roundId = '' } = useParams()
  const [params] = useSearchParams()
  const doc = useQuery({ queryKey: ['beta-document', roundId], queryFn: () => api.readBetaRound(roundId), retry: false })
  const threads = useQuery({ queryKey: ['beta-threads', roundId], queryFn: () => api.betaThreads(roundId), enabled: !!doc.data, refetchInterval: 15000 })
  const polls = useQuery({ queryKey: ['reader-beta-polls', roundId], queryFn: () => api.readerBetaPolls(roundId), enabled: !!doc.data })
  const qc = useQueryClient()
  const [seed, setSeed] = useState<Seed | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const [panel, setPanel] = useState(false)
  const refresh = () => { void threads.refetch(); void polls.refetch(); void qc.invalidateQueries({ queryKey: ['beta-document', roundId] }) }
  if (doc.isPending) return <p className="p-8">Loading beta manuscript…</p>
  if (doc.error) return <p role="alert" className="writer-error p-8">{errorText(doc.error)}</p>
  const data = doc.data!
  const scene = params.get('scene')
  const chapter = params.get('chapter')
  const target = scene ? { sceneId: scene, sequence: 1 } : chapter ? { chapterId: chapter, sequence: 1 } : undefined
  const selection = () => {
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed) { setSelectionError('Select a passage within one scene first.'); return }
    const element = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('.reading-paragraph')
    const start = element(selected.anchorNode), end = element(selected.focusNode)
    if (!start?.dataset.sceneId || start.dataset.sceneId !== end?.dataset.sceneId) { setSelectionError('Select text within a single scene.'); return }
    const quote = selected.toString().trim()
    if (quote.length > 2000) { setSelectionError('Select a shorter passage, up to 2,000 characters.'); return }
    setSelectionError('')
    setSeed({ scene_id: start.dataset.sceneId, chapter_id: start.dataset.chapterId, quote, paragraph: start === end ? Number(start.dataset.readingAnchor?.split(':').pop()) : null })
  }
  return <>
    <div className="mx-auto max-w-5xl px-5 pt-6 text-[var(--ink)]"><p className="eyebrow">FROZEN BETA DRAFT · {data.round.status}</p><h2 className="mt-2 text-xl font-semibold">{data.round.title}</h2>{data.round.brief && <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{data.round.brief}</p>}{data.round.deadline && <p className="mt-2 text-xs text-[var(--muted)]">Requested by {new Date(data.round.deadline).toLocaleDateString()}</p>}
      <div className="mt-4 flex flex-wrap gap-3"><button className="share-story-button" aria-expanded={panel} onClick={() => setPanel(!panel)}>{panel ? 'Hide feedback and polls' : 'My feedback and polls'}</button>{!data.is_owner && data.round.status === 'open' && <><button className="share-story-button" onClick={() => setSeed({})}>Leave feedback</button><button className="share-story-button" onMouseDown={e => e.preventDefault()} onClick={selection}>Comment on selected text</button></>}{data.is_owner && <Link className="share-story-button" to={`/stories/${data.share.story_id}/beta`}>Manage readers</Link>}</div>
      {selectionError && <p role="alert" className="writer-error mt-3">{selectionError}</p>}
      {panel && <section className="mt-5 space-y-5 rounded-xl border border-[var(--line)] p-5" aria-label="Beta feedback and polls">
        {!data.is_owner && <ReadingProgress key={data.read_chapters.join(',') + data.reading_status} doc={data} refresh={refresh} />}
        <h3 className="font-semibold">{data.is_owner ? 'Submitted reader conversations' : 'Your conversations and drafts'}</h3>{threads.data?.length === 0 && <p className="text-sm">No feedback yet.</p>}{threads.data?.map(thread => <Link key={thread.id} to={thread.url} className="block rounded border border-[var(--line)] p-3 text-sm"><p className="line-clamp-2">{thread.quote || thread.messages[0]?.body || 'Conversation'}</p><span className="text-xs text-[var(--muted)]">{thread.submitted ? thread.resolved ? 'Resolved' : 'Open' : 'Private draft'} · {thread.message_count} messages →</span></Link>)}
        <h3 className="font-semibold">Reader polls</h3>{polls.data?.length === 0 && <p className="text-sm">No polls published yet.</p>}{polls.data?.map(poll => <BetaPollCard key={poll.id + JSON.stringify(poll.my_response)} poll={poll} owner={data.is_owner} roundOpen={data.round.status === 'open'} refresh={refresh} />)}
        {(threads.error || polls.error) && <p role="alert" className="writer-error">{errorText(threads.error ?? polls.error)}</p>}
      </section>}
    </div>
    <StoryReader storyId={data.share.story_id} betaRoundId={roundId} openTarget={target} onBetaFeedback={!data.is_owner && data.round.status === 'open' ? (chapterId, sceneId) => setSeed({ chapter_id: chapterId, scene_id: sceneId }) : undefined} />
    <CommentComposer doc={data} seed={seed} onClose={() => setSeed(null)} onSaved={() => { setSeed(null); setPanel(true); refresh() }} />
  </>
}

function ReadingProgress({ doc, refresh }: { doc: BetaDocument; refresh: () => void }) {
  const [read, setRead] = useState(doc.read_chapters)
  const [status, setStatus] = useState<'not_started' | 'reading' | 'finished' | 'stopped'>(doc.reading_status as 'not_started')
  const [reason, setReason] = useState(doc.stopped_reason ?? '')
  const save = useMutation({ mutationFn: () => api.betaProgress(doc.round.id, { read_chapters: read, reading_status: status, stopped_reason: status === 'stopped' ? reason : null }), onSuccess: refresh })
  return <section><h3 className="font-semibold">Your reading progress</h3><p className="mt-2 text-xs text-[var(--muted)]">The author sees the chapters and status you choose here. We do not track time spent reading.</p><div className="mt-3 space-y-2">{doc.structure.chapter?.map(c => <label key={String(c.id)} className="flex gap-2 text-sm"><input type="checkbox" disabled={save.isPending} checked={read.includes(String(c.id))} onChange={e => setRead(e.target.checked ? [...read, String(c.id)] : read.filter(id => id !== c.id))} />{String(c.title || `Chapter ${c.number}`)}</label>)}</div><select aria-label="Reading status" disabled={save.isPending} value={status} onChange={e => setStatus(e.target.value as typeof status)} className="mt-3 rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-sm">{['not_started', 'reading', 'finished', 'stopped'].map(x => <option key={x}>{x.replace('_', ' ')}</option>)}</select>{status === 'stopped' && <textarea maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={save.isPending} placeholder="Optional: what made you stop?" aria-label="Optional reason for stopping" className="mt-3 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2" />}<button className="share-story-button ml-3" disabled={save.isPending} onClick={() => save.mutate()}>Save progress</button>{save.error && <p role="alert" className="writer-error">{errorText(save.error)}</p>}</section>
}

function CommentComposer({ doc, seed, onClose, onSaved }: { doc: BetaDocument; seed: Seed | null; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [body, setBody] = useState('')
  const [chapter, setChapter] = useState('')
  const save = useMutation({ mutationFn: (submitted: boolean) => api.createBetaThread(doc.round.id, { ...seed, chapter_id: seed?.scene_id ? seed.chapter_id : chapter || null, body, submitted }), onSuccess: onSaved })
  const reset = save.reset
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (seed === null) { element.close(); return }
    if (element.open) return
    setBody(''); setChapter(seed.chapter_id ?? ''); reset(); element.showModal()
  }, [seed, reset])
  const close = () => { if (!save.isPending && (!body.trim() || window.confirm('Discard unsaved feedback? Use Save private draft to keep it.'))) onClose() }
  return <dialog ref={dialog} aria-labelledby="beta-comment-title" onCancel={e => { e.preventDefault(); close() }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--page)] p-6 text-[var(--ink)] shadow-xl backdrop:bg-black/60"><h2 id="beta-comment-title" className="text-xl font-semibold">Feedback · {doc.round.title}</h2>{seed?.quote && <blockquote className="mt-4 whitespace-pre-wrap border-l-4 border-[var(--accent)] p-3 text-sm">{seed.quote}</blockquote>}<form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(true) }}>
    {!seed?.scene_id && <label className="block text-sm">About<select value={chapter} disabled={save.isPending} onChange={e => setChapter(e.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2"><option value="">Whole story</option>{doc.structure.chapter?.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.title || `Chapter ${c.number}`)}</option>)}</select></label>}
    <label className="block text-sm">Your feedback<textarea autoFocus required maxLength={4000} rows={6} disabled={save.isPending} value={body} onChange={e => setBody(e.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3" /></label><p className="text-xs text-[var(--muted)]">Submitted feedback becomes a private conversation with the author. Drafts are visible only to you.</p>
    {save.error && <p role="alert" className="writer-error">{errorText(save.error)}</p>}
    <div className="flex flex-wrap gap-3"><button type="submit" disabled={save.isPending || !body.trim()} className="sharing-primary">Send to author</button><button type="button" disabled={save.isPending || !body.trim()} className="share-story-button" onClick={() => save.mutate(false)}>Save private draft</button><button type="button" disabled={save.isPending} className="share-story-button" onClick={close}>Cancel</button></div>
  </form></dialog>
}
