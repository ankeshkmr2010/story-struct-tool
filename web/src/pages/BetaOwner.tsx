import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, type BetaRound } from '../api/client'
import { errorText } from '../api/errors'

export default function BetaOwner() {
  const { storyId = '' } = useParams()
  const qc = useQueryClient()
  const rounds = useQuery({ queryKey: ['beta-rounds', storyId], queryFn: () => api.betaRounds(storyId) })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const [title, setTitle] = useState('First beta round')
  const [brief, setBrief] = useState('')
  const [deadline, setDeadline] = useState('')
  const [auto, setAuto] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [all, setAll] = useState(true)
  const publish = useMutation({ mutationFn: () => api.createBetaRound(storyId, { title, brief, auto_approve: auto, chapter_ids: all ? null : selected, deadline: deadline ? new Date(deadline + 'T23:59:59').toISOString() : null }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['beta-rounds', storyId] }) } })
  const control = 'mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3'
  return <main className="mx-auto max-w-4xl px-5 py-8 text-[var(--ink)]">
    <div className="flex flex-wrap gap-4 text-sm"><Link to={`/stories/${storyId}`} className="underline">← Story</Link><Link to={`/stories/${storyId}/polls`} className="underline">All story polls →</Link></div>
    <h1 className="mt-6 text-3xl font-semibold">Beta readers</h1><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Publish a frozen draft while you continue writing. Readers see manuscript chapters and your brief, with private feedback and polls. Planning notes, arcs, AI conversations and other readers' feedback stay private. Existing ordinary sharing remains separate.</p>
    <form className="mt-6 space-y-4 rounded-xl border border-[var(--line)] p-5" onSubmit={e => { e.preventDefault(); publish.mutate() }}>
      <h2 className="text-xl font-semibold">Publish a round</h2><label className="block text-sm">Round title<input required maxLength={200} className={control} value={title} onChange={e => setTitle(e.target.value)} disabled={publish.isPending} /></label>
      <label className="block text-sm">Reader brief / questions<textarea maxLength={5000} rows={4} className={control} value={brief} onChange={e => setBrief(e.target.value)} disabled={publish.isPending} placeholder="What would you like readers to notice or respond to?" /></label>
      <label className="block text-sm">Optional deadline<input type="date" className={control} value={deadline} onChange={e => setDeadline(e.target.value)} disabled={publish.isPending} /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} disabled={publish.isPending} />Include all chapters</label>
      {!all && <fieldset className="space-y-2"><legend className="mb-2 text-sm">Choose chapters</legend>{chapters.data?.map(c => <label key={c.id} className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} disabled={publish.isPending} />{c.title || `Chapter ${c.number}`}</label>)}</fieldset>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} disabled={publish.isPending} />Automatically admit signed-in readers with the link</label><p className="text-xs text-[var(--muted)]">Otherwise, link visitors request your approval. No email is sent automatically. The deadline is guidance, not a reading lock.</p>
      <button type="submit" className="sharing-primary" disabled={publish.isPending || !title.trim() || (!all && !selected.length)}>{publish.isPending ? 'Publishing…' : 'Publish saved draft'}</button>
      {publish.error && <p role="alert" className="writer-error">{errorText(publish.error)}</p>}
    </form>
    {(rounds.error || chapters.error) && <p role="alert" className="writer-error">{errorText(rounds.error ?? chapters.error)}</p>}
    {rounds.isPending && <p className="mt-6">Loading rounds…</p>}
    {rounds.data?.map(round => <RoundCard key={round.id} storyId={storyId} round={round} />)}
  </main>
}

function RoundCard({ storyId, round }: { storyId: string; round: BetaRound }) {
  const qc = useQueryClient()
  const members = useQuery({ queryKey: ['beta-members', round.id], queryFn: () => api.betaMembers(storyId, round.id), refetchInterval: 15000 })
  const threads = useQuery({ queryKey: ['beta-threads', round.id], queryFn: () => api.betaThreads(round.id), refetchInterval: 15000 })
  const [copy, setCopy] = useState('')
  const [resolved, setResolved] = useState('open')
  const [reader, setReader] = useState('')
  const [chapter, setChapter] = useState('')
  const doc = useQuery({ queryKey: ['beta-document', round.id], queryFn: () => api.readBetaRound(round.id) })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['beta-rounds', storyId] }); void members.refetch(); void threads.refetch() }
  const update = useMutation({ mutationFn: (body: Parameters<typeof api.updateBetaRound>[2]) => api.updateBetaRound(storyId, round.id, body), onSuccess: refresh })
  const rotate = useMutation({ mutationFn: () => api.rotateBetaLink(storyId, round.id), onSuccess: refresh })
  const access = useMutation({ mutationFn: ({ id, status }: { id: string; status: 'approved' | 'declined' | 'revoked' }) => api.updateBetaMember(storyId, round.id, id, status), onSuccess: refresh })
  const link = round.join_path ? location.origin + round.join_path : ''
  return <section className="mt-8 space-y-4 rounded-xl border border-[var(--line)] p-5">
    <h2 className="text-xl font-semibold">{round.title} · {round.status}</h2>{round.deadline && <p className="text-sm text-[var(--muted)]">Requested by {new Date(round.deadline).toLocaleDateString()}</p>}{round.brief && <p className="whitespace-pre-wrap text-sm">{round.brief}</p>}
    <div className="flex flex-wrap gap-3 text-sm"><Link to={`/beta/rounds/${round.id}`} className="share-story-button">Preview reader view</Link><button className="share-story-button" disabled={update.isPending} onClick={() => update.mutate({ status: round.status === 'open' ? 'closed' : 'open' })}>{round.status === 'open' ? 'Close feedback round' : 'Reopen round'}</button></div>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={round.link_enabled} disabled={update.isPending} onChange={e => update.mutate({ link_enabled: e.target.checked })} />Invitation link enabled</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={round.auto_approve} disabled={update.isPending} onChange={e => update.mutate({ auto_approve: e.target.checked })} />Automatic admission</label>
    <div className="flex flex-wrap gap-2"><input aria-label="Beta invitation link" readOnly value={link} className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-xs" /><button className="share-story-button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopy('Invitation copied.')).catch(() => setCopy('Select and copy the link manually.')) }}>Copy link</button><button className="share-story-button" disabled={rotate.isPending} onClick={() => { if (window.confirm('Replace the invitation link? Admitted readers and conversation URLs keep working.')) rotate.mutate() }}>Rotate link</button></div>{copy && <p role="status" className="text-xs">{copy}</p>}
    <h3 className="font-semibold">Readers and requests</h3><p className="text-xs text-[var(--muted)]">Progress is reader-reported, not time spent scrolling. Revoking beta access does not revoke any separate ordinary share.</p>
    {members.data?.length === 0 && <p className="text-sm">No requests yet.</p>}{members.data?.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3 text-sm"><div><p>{member.name} · {member.email}</p><p className="text-xs text-[var(--muted)]">{member.status} · {member.reading_status} · {member.read_chapters.length} chapters marked read</p>{member.stopped_reason && <p className="mt-1 text-xs">{member.stopped_reason}</p>}</div><div className="flex gap-3 text-xs">{member.status !== 'approved' && <button disabled={access.isPending || round.status !== 'open'} className="underline" onClick={() => access.mutate({ id: member.id, status: 'approved' })}>Approve / restore</button>}{member.status === 'pending' && <button disabled={access.isPending} className="underline" onClick={() => access.mutate({ id: member.id, status: 'declined' })}>Decline</button>}{member.status === 'approved' && <button disabled={access.isPending} className="text-red-600 dark:text-red-300" onClick={() => { if (window.confirm('Revoke access to this round? Submitted feedback stays available to you.')) access.mutate({ id: member.id, status: 'revoked' }) }}>Revoke</button>}</div></div>)}
    <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">Reader conversations</h3><select aria-label="Feedback status" value={resolved} onChange={e => setResolved(e.target.value)} className="rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-xs"><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select><select aria-label="Filter feedback by reader" value={reader} onChange={e => setReader(e.target.value)} className="rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-xs"><option value="">All readers</option>{members.data?.map(m => <option key={m.id} value={m.user_id}>{m.name}</option>)}</select><select aria-label="Filter feedback by chapter" value={chapter} onChange={e => setChapter(e.target.value)} className="rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-xs"><option value="">All chapters / whole story</option>{doc.data?.structure.chapter?.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.title || `Chapter ${c.number}`)}</option>)}</select></div>
    {threads.data?.filter(t => (resolved === 'all' || t.resolved === (resolved === 'resolved')) && (!reader || t.reader_id === reader) && (!chapter || t.chapter_id === chapter)).map(t => <Link key={t.id} to={t.url} className="block rounded border border-[var(--line)] p-3 text-sm"><strong>{t.messages[0]?.name || 'Reader'}</strong><p className="mt-1 line-clamp-2">{t.quote || t.messages[0]?.body || 'Conversation'}</p><span className="text-xs text-[var(--muted)]">{t.message_count} messages · {t.resolved ? 'Resolved' : 'Open'} →</span></Link>)}
    {(members.error || threads.error || update.error || rotate.error || access.error) && <p role="alert" className="writer-error">{errorText(members.error ?? threads.error ?? update.error ?? rotate.error ?? access.error)}</p>}
  </section>
}
