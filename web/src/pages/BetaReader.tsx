import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, type BetaDocument } from '../api/client'
import { errorText } from '../api/errors'
import { StoryReader } from './SharedStoryReader'
import { BetaPollCard } from '../components/BetaPollCard'
import { t } from '../i18n'

type Seed = { chapter_id?: string | null; scene_id?: string | null; quote?: string | null; paragraph?: number | null }

export function BetaInvitePage() {
  const { token = '' } = useParams()
  const invite = useQuery({ queryKey: ['beta-invite', token], queryFn: () => api.betaInvite(token), refetchInterval: 15000, retry: false })
  const join = useMutation({ mutationFn: () => api.joinBeta(token), onSuccess: () => void invite.refetch() })
  if (invite.isPending) return <p className="p-8">{t('Loading beta invitation…')}</p>
  if (invite.error) return <p role="alert" className="writer-error p-8">{errorText(invite.error)}</p>
  const data = invite.data!
  return <main className="mx-auto max-w-2xl px-5 py-12 text-[var(--ink)]"><p className="eyebrow">{t('BETA INVITATION')}</p><h1 className="mt-4 text-3xl font-semibold">{data.story_title}</h1><h2 className="mt-3 text-xl">{data.round.title}</h2>{data.round.brief && <p className="mt-5 whitespace-pre-wrap leading-7">{data.round.brief}</p>}{data.round.deadline && <p className="mt-3 text-sm">{t('Requested by {0}', new Date(data.round.deadline).toLocaleDateString())}</p>}
    {['approved', 'owner'].includes(data.membership) ? <Link className="landing-primary mt-6" to={`/beta/rounds/${data.round.id}`}>{t('Open beta manuscript →')}</Link> : data.membership === 'pending' ? <p role="status" className="mt-6">{t('Your access request is waiting for the author. This page checks for approval; the round also appears in Shared with you once approved.')}</p> : ['revoked', 'declined'].includes(data.membership) ? <p className="mt-6">{t('Access is unavailable. Ask the author to restore it.')}</p> : <><p className="mt-5 text-sm text-[var(--muted)]">{t('{0} Your comments are private to you and the author. Reading progress is self-reported.', data.round.auto_approve ? t('The author allows signed-in readers with this link to join.') : t('The author must approve your request before you can read.'))}</p><button className="landing-primary mt-5" disabled={join.isPending} onClick={() => join.mutate()}>{join.isPending ? t('Requesting…') : data.round.auto_approve ? t('Join beta read') : t('Request access')}</button></>}
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
  const quote = threads.data?.find(thread => thread.id === params.get('thread'))?.quote
  useEffect(() => highlightQuote(params.get('scene'), quote), [params, quote])
  if (doc.isPending) return <p className="p-8">{t('Loading beta manuscript…')}</p>
  if (doc.error) return <p role="alert" className="writer-error p-8">{errorText(doc.error)}</p>
  const data = doc.data!
  const scene = params.get('scene')
  const chapter = params.get('chapter')
  const paragraph = params.get('paragraph')
  const target = scene ? { sceneId: scene, paragraph: paragraph ? Number(paragraph) : undefined, sequence: 1 } : chapter ? { chapterId: chapter, sequence: 1 } : undefined
  const canComment = !data.is_owner && data.round.status === 'open'
  const selection = () => {
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed) { setSelectionError(t('Select a passage within one scene first.')); return }
    const element = paragraphOf
    const start = element(selected.anchorNode), end = element(selected.focusNode)
    if (!start?.dataset.sceneId || start.dataset.sceneId !== end?.dataset.sceneId) { setSelectionError(t('Select text within a single scene.')); return }
    const quote = selected.toString().trim()
    if (quote.length > 2000) { setSelectionError(t('Select a shorter passage, up to 2,000 characters.')); return }
    setSelectionError('')
    setSeed({ scene_id: start.dataset.sceneId, chapter_id: start.dataset.chapterId, quote, paragraph: start === end ? Number(start.dataset.readingAnchor?.split(':').pop()) : null })
  }
  const details = <div className="mt-3 text-sm">
    <p><strong>{data.round.title}</strong> · {data.round.status}{data.round.deadline && t(' · Requested by {0}', new Date(data.round.deadline).toLocaleDateString())}</p>
    {data.round.brief && <p className="mt-2 whitespace-pre-wrap leading-6">{data.round.brief}</p>}
    {canComment && <p className="mt-2 text-xs text-[var(--muted)]">{t('To comment on a passage, select it and click the comment icon, or right-click a paragraph.')}</p>}
    {selectionError && <p role="alert" className="writer-error mt-2">{selectionError}</p>}
  </div>
  const actions = <>
    <button className="ui-btn ui-btn-secondary" aria-expanded={panel} onClick={() => setPanel(!panel)}>{data.is_owner ? t('Feedback and polls') : t('My feedback and polls')}</button>
    {canComment && <button className="ui-btn ui-btn-primary" onClick={() => setSeed({})}>{t('Leave feedback')}</button>}
    {data.is_owner && <Link className="ui-btn ui-btn-secondary" to={`/stories/${data.share.story_id}/beta`}>{t('Manage readers')}</Link>}
  </>
  const back = data.is_owner ? { to: `/stories/${data.share.story_id}`, label: t('← Back to story') } : { to: '/library', label: t('← Your stories') }
  return <>
    <StoryReader storyId={data.share.story_id} betaRoundId={roundId} openTarget={target} beta={{ back, details, actions }} onBetaFeedback={canComment ? (chapterId, sceneId) => setSeed({ chapter_id: chapterId, scene_id: sceneId }) : undefined} />
    {panel && <aside className="beta-drawer text-[var(--ink)]" aria-label={t('Beta feedback and polls')}>
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{data.is_owner ? t('Feedback and polls') : t('My feedback and polls')}</h2><button type="button" className="ui-icon-btn" aria-label={t('Close feedback and polls')} onClick={() => setPanel(false)}>×</button></div>
      <div className="mt-4 space-y-5">
        {!data.is_owner && <ReadingProgress key={data.read_chapters.join(',') + data.reading_status} doc={data} refresh={refresh} />}
        <h3 className="font-semibold">{data.is_owner ? t('Submitted reader conversations') : t('Your conversations and drafts')}</h3>{threads.data?.length === 0 && <p className="text-sm">{t('No feedback yet.')}</p>}{threads.data?.map(thread => <Link key={thread.id} to={thread.url} className="block rounded border border-[var(--line)] p-3 text-sm"><p className="line-clamp-2">{thread.quote || thread.messages[0]?.body || t('Conversation')}</p><span className="text-xs text-[var(--muted)]">{t('{0} · {1} messages →', thread.submitted ? thread.resolved ? t('Resolved') : t('Open') : t('Private draft'), thread.message_count)}</span></Link>)}
        <h3 className="font-semibold">{t('Reader polls')}</h3>{polls.data?.length === 0 && <p className="text-sm">{t('No polls published yet.')}</p>}{polls.data?.map(poll => <BetaPollCard key={poll.id + JSON.stringify(poll.my_response)} poll={poll} owner={data.is_owner} roundOpen={data.round.status === 'open'} refresh={refresh} />)}
        {(threads.error || polls.error) && <p role="alert" className="writer-error">{errorText(threads.error ?? polls.error)}</p>}
      </div>
    </aside>}
    {canComment && <PassageComment onSelection={selection} onScene={(chapterId, sceneId) => setSeed({ chapter_id: chapterId, scene_id: sceneId })} />}
    <CommentComposer doc={data} seed={seed} onClose={() => setSeed(null)} onSaved={() => { setSeed(null); setPanel(true); refresh() }} />
  </>
}

/** Marks a thread's quoted text in its scene with the CSS highlight API; the DOM is not changed. */
function highlightQuote(sceneId: string | null, quote: string | null | undefined) {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
  const needle = quote?.split('\n').map(line => line.trim()).find(Boolean)
  if (!registry || !sceneId || !needle || typeof Highlight === 'undefined') return
  let attempts = 0
  const find = () => {
    for (const paragraph of Array.from(document.querySelectorAll<HTMLElement>(`[data-reading-anchor^="paragraph:${sceneId}:"]`))) {
      const nodes: Text[] = []
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) nodes.push(walker.currentNode as Text)
      const text = nodes.map(node => node.data).join('')
      const start = text.indexOf(needle)
      if (start < 0) continue
      const range = document.createRange()
      let offset = 0
      for (const node of nodes) {
        const end = offset + node.data.length
        if (start >= offset && start <= end) range.setStart(node, start - offset)
        if (start + needle.length >= offset && start + needle.length <= end) { range.setEnd(node, start + needle.length - offset); break }
        offset = end
      }
      registry.set('beta-quote', new Highlight(range))
      return true
    }
    return false
  }
  // The manuscript renders after the thread list arrives, so retry briefly.
  const timer = setInterval(() => { if (find() || ++attempts > 20) clearInterval(timer) }, 250)
  return () => { clearInterval(timer); registry.delete('beta-quote') }
}

type Pin = { x: number; y: number; menu: boolean; chapterId?: string; sceneId?: string }
// Paragraph anchors carry scene and chapter ids, including paragraphs that wrap an image.
const paragraphOf = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-reading-anchor^="paragraph:"]') ?? null

/** A small comment icon beside selected text, and a right-click menu on paragraphs. */
function PassageComment({ onSelection, onScene }: { onSelection: () => void; onScene: (chapterId: string, sceneId: string) => void }) {
  const [pin, setPin] = useState<Pin | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const place = () => setPin(current => {
      if (current?.menu) return current
      const selected = window.getSelection()
      if (!selected || selected.isCollapsed || !selected.rangeCount || !paragraphOf(selected.anchorNode) || !paragraphOf(selected.focusNode)) return null
      const rect = selected.getRangeAt(0).getBoundingClientRect()
      return { x: Math.min(rect.right + 6, window.innerWidth - 40), y: Math.max(rect.top - 38, 8), menu: false }
    })
    const context = (event: MouseEvent) => {
      const paragraph = paragraphOf(event.target as Node)
      if (!paragraph?.dataset.sceneId) return
      event.preventDefault()
      setPin({ x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 100), menu: true, chapterId: paragraph.dataset.chapterId, sceneId: paragraph.dataset.sceneId })
    }
    const scrolled = () => setPin(current => current?.menu ? null : current)
    document.addEventListener('selectionchange', place)
    document.addEventListener('contextmenu', context)
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('scroll', scrolled, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', place); document.removeEventListener('contextmenu', context)
      window.removeEventListener('scroll', place); window.removeEventListener('scroll', scrolled)
    }
  }, [])
  useEffect(() => {
    if (!pin?.menu) return
    menuRef.current?.querySelector('button')?.focus()
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setPin(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPin(null) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [pin?.menu])
  if (!pin) return null
  const hasSelection = !window.getSelection()?.isCollapsed
  if (!pin.menu) return <button type="button" className="ui-icon-btn beta-comment-pin" style={{ left: pin.x, top: pin.y }} aria-label={t('Comment on selected text')} title={t('Comment on selected text')} onMouseDown={event => event.preventDefault()} onClick={() => { setPin(null); onSelection() }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
  </button>
  return <div ref={menuRef} role="menu" className="ui-menu-panel beta-comment-menu" style={{ left: pin.x, top: pin.y }}>
    {hasSelection && <button type="button" role="menuitem" className="ui-menu-item" onMouseDown={event => event.preventDefault()} onClick={() => { setPin(null); onSelection() }}>{t('Comment on selected text')}</button>}
    <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { setPin(null); if (pin.chapterId && pin.sceneId) onScene(pin.chapterId, pin.sceneId) }}>{t('Comment on this scene')}</button>
  </div>
}

function ReadingProgress({ doc, refresh }: { doc: BetaDocument; refresh: () => void }) {
  const [read, setRead] = useState(doc.read_chapters)
  const [status, setStatus] = useState<'not_started' | 'reading' | 'finished' | 'stopped'>(doc.reading_status as 'not_started')
  const [reason, setReason] = useState(doc.stopped_reason ?? '')
  const save = useMutation({ mutationFn: () => api.betaProgress(doc.round.id, { read_chapters: read, reading_status: status, stopped_reason: status === 'stopped' ? reason : null }), onSuccess: refresh })
  return <section><h3 className="font-semibold">{t('Your reading progress')}</h3><p className="mt-2 text-xs text-[var(--muted)]">{t('The author sees the chapters and status you choose here. We do not track time spent reading.')}</p><div className="mt-3 space-y-2">{doc.structure.chapter?.map(c => <label key={String(c.id)} className="flex gap-2 text-sm"><input type="checkbox" disabled={save.isPending} checked={read.includes(String(c.id))} onChange={e => setRead(e.target.checked ? [...read, String(c.id)] : read.filter(id => id !== c.id))} />{String(c.title || t('Chapter {0}', String(c.number)))}</label>)}</div><select aria-label={t('Reading status')} disabled={save.isPending} value={status} onChange={e => setStatus(e.target.value as typeof status)} className="mt-3 rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-sm">{['not_started', 'reading', 'finished', 'stopped'].map(x => <option key={x}>{x.replace('_', ' ')}</option>)}</select>{status === 'stopped' && <textarea maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={save.isPending} placeholder={t('Optional: what made you stop?')} aria-label={t('Optional reason for stopping')} className="mt-3 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2" />}<button className="share-story-button ml-3" disabled={save.isPending} onClick={() => save.mutate()}>{t('Save progress')}</button>{save.error && <p role="alert" className="writer-error">{errorText(save.error)}</p>}</section>
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
  const close = () => { if (!save.isPending && (!body.trim() || window.confirm(t('Discard unsaved feedback? Use Save private draft to keep it.')))) onClose() }
  return <dialog ref={dialog} aria-labelledby="beta-comment-title" onCancel={e => { e.preventDefault(); close() }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--page)] p-6 text-[var(--ink)] shadow-xl backdrop:bg-black/60"><h2 id="beta-comment-title" className="text-xl font-semibold">{t('Feedback · {0}', doc.round.title)}</h2>{seed?.quote && <blockquote className="mt-4 whitespace-pre-wrap border-l-4 border-[var(--accent)] p-3 text-sm">{seed.quote}</blockquote>}<form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(true) }}>
    {!seed?.scene_id && <label className="block text-sm">{t('About')}<select value={chapter} disabled={save.isPending} onChange={e => setChapter(e.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2"><option value="">{t('Whole story')}</option>{doc.structure.chapter?.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.title || t('Chapter {0}', String(c.number)))}</option>)}</select></label>}
    <label className="block text-sm">{t('Your feedback')}<textarea autoFocus required maxLength={4000} rows={6} disabled={save.isPending} value={body} onChange={e => setBody(e.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3" /></label><p className="text-xs text-[var(--muted)]">{t('Submitted feedback becomes a private conversation with the author. Drafts are visible only to you.')}</p>
    {save.error && <p role="alert" className="writer-error">{errorText(save.error)}</p>}
    <div className="flex flex-wrap gap-3"><button type="submit" disabled={save.isPending || !body.trim()} className="sharing-primary">{t('Send to author')}</button><button type="button" disabled={save.isPending || !body.trim()} className="share-story-button" onClick={() => save.mutate(false)}>{t('Save private draft')}</button><button type="button" disabled={save.isPending} className="share-story-button" onClick={close}>{t('Cancel')}</button></div>
  </form></dialog>
}
