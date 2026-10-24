import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, type BetaThread } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'

export default function BetaThreadPage() {
  const { roundId = '', threadId = '' } = useParams()
  const thread = useQuery({ queryKey: ['beta-thread', threadId], queryFn: () => api.betaThread(threadId), refetchInterval: 15000 })
  const doc = useQuery({ queryKey: ['beta-document', roundId], queryFn: () => api.readBetaRound(roundId) })
  const qc = useQueryClient()
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['beta-thread', threadId] }); void qc.invalidateQueries({ queryKey: ['beta-threads', roundId] }) }
  const change = useMutation({ mutationFn: (body: { resolved?: boolean; submitted?: boolean }) => api.updateBetaThread(threadId, body), onSuccess: refresh })
  if (thread.isPending || doc.isPending) return <p className="p-8">{t('Loading conversation…')}</p>
  if (thread.error || doc.error || thread.data?.round_id !== roundId) return <p role="alert" className="writer-error p-8">{thread.error || doc.error ? errorText(thread.error ?? doc.error) : t('Conversation unavailable')}</p>
  const item = thread.data!
  const scene = doc.data!.structure.scene?.find(s => String(s.id) === item.scene_id)
  const params = new URLSearchParams()
  if (item.scene_id) params.set('scene', item.scene_id)
  if (item.chapter_id) params.set('chapter', item.chapter_id)
  if (item.scene_id && item.paragraph != null) params.set('paragraph', String(item.paragraph))
  if (item.quote) params.set('thread', item.id)
  return <main className="mx-auto max-w-3xl px-5 py-8 text-[var(--ink)]">
    {doc.data!.is_owner && <nav className="mb-4 flex flex-wrap gap-2" aria-label={t('Back to your story')}>
      <Link className="ui-btn ui-btn-secondary" to={`/stories/${doc.data!.share.story_id}`}>{t('← Back to story')}</Link>
      <Link className="ui-btn ui-btn-secondary" to={`/stories/${doc.data!.share.story_id}/beta`}>{t('Beta readers')}</Link>
    </nav>}
    <Link className="underline" to={`/beta/rounds/${roundId}?${params}`}>{t('← Read the reviewed passage')}</Link>
    <h1 className="mt-5 text-2xl font-semibold">{t('Conversation · {0}', doc.data!.round.title)}</h1>
    <p className="mt-2 text-sm text-[var(--muted)]">{scene ? String(scene.title || t('Scene feedback')) : item.chapter_id ? t('Chapter feedback') : t('Whole-story feedback')} · {item.resolved ? t('Resolved') : t('Open')}{!item.submitted && t(' · Private draft')}</p>
    {item.quote && <blockquote className="mt-5 whitespace-pre-wrap border-l-4 border-[var(--accent)] bg-[var(--surface)] p-4">{item.quote}</blockquote>}
    <p className="mt-3 text-xs text-[var(--muted)]">{t('This conversation refers to the frozen draft for this round. Its URL stays the same when the invitation link changes.')}</p>
    <div className="mt-4 flex gap-3">{doc.data!.is_owner && <button className="share-story-button" disabled={change.isPending} onClick={() => change.mutate({ resolved: !item.resolved })}>{item.resolved ? t('Reopen feedback') : t('Mark addressed')}</button>}{item.mine && !item.submitted && doc.data!.round.status === 'open' && <button className="sharing-primary" disabled={change.isPending} onClick={() => change.mutate({ submitted: true })}>{t('Submit draft conversation')}</button>}</div>
    {change.error && <p role="alert" className="writer-error">{errorText(change.error)}</p>}
    <ThreadConversation thread={item} open={doc.data!.round.status === 'open'} refresh={refresh} />
  </main>
}

function ThreadConversation({ thread, open, refresh }: { thread: BetaThread; open: boolean; refresh: () => void }) {
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [edited, setEdited] = useState('')
  const reply = useMutation({ mutationFn: (submitted: boolean) => api.replyBetaThread(thread.id, { body, submitted }), onSuccess: () => { setBody(''); refresh() } })
  const edit = useMutation({ mutationFn: ({ id, submitted }: { id: string; submitted: boolean }) => api.editBetaMessage(id, { body: edited, submitted }), onSuccess: () => { setEditing(null); refresh() } })
  const remove = useMutation({ mutationFn: api.deleteBetaMessage, onSuccess: refresh })
  const pending = reply.isPending || edit.isPending || remove.isPending
  return <section className="mt-6 space-y-4" aria-label={t('Conversation messages')}>
    {thread.messages.map(message => <article key={message.id} className="rounded-xl border border-[var(--line)] p-4">
      <p className="text-xs text-[var(--muted)]">{message.name} · {new Date(message.created_at).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}{!message.submitted && t(' · Only you can see this draft')}{message.updated_at !== message.created_at && t(' · Edited')}</p>
      {editing === message.id ? <div className="mt-3"><textarea value={edited} onChange={e => setEdited(e.target.value)} disabled={pending} maxLength={4000} rows={4} aria-label={t('Edit message')} className="w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3" /><div className="mt-2 flex gap-3"><button className="sharing-primary" disabled={pending || !edited.trim()} onClick={() => edit.mutate({ id: message.id, submitted: message.submitted })}>{t('Save')}</button><button className="share-story-button" disabled={pending} onClick={() => setEditing(null)}>{t('Cancel')}</button></div></div> : <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{message.deleted ? t('Message deleted by its author.') : message.body}</p>}
      {message.mine && !message.deleted && open && <div className="mt-3 flex gap-3 text-xs"><button className="underline" disabled={pending} onClick={() => { setEditing(message.id); setEdited(message.body) }}>{t('Edit')}</button>{!message.submitted && thread.submitted && <button className="underline" disabled={pending} onClick={() => { setEdited(message.body); setEditing(message.id) }}>{t('Edit and submit draft')}</button>}<button className="text-red-600 dark:text-red-300" disabled={pending} onClick={() => { if (window.confirm(t('Delete your message? The conversation URL and replies remain.'))) remove.mutate(message.id) }}>{t('Delete')}</button></div>}
      {editing === message.id && !message.submitted && thread.submitted && <button className="sharing-primary mt-3" disabled={pending || !edited.trim()} onClick={() => edit.mutate({ id: message.id, submitted: true })}>{t('Submit reply')}</button>}
    </article>)}
    {open ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); reply.mutate(true) }}><label className="block text-sm">{t('Reply')}<textarea required maxLength={4000} rows={4} value={body} disabled={pending} onChange={e => setBody(e.target.value)} className="mt-2 w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3" /></label><div className="flex gap-3"><button type="submit" className="sharing-primary" disabled={pending || !body.trim() || !thread.submitted}>{t('Send reply')}</button><button type="button" className="share-story-button" disabled={pending || !body.trim()} onClick={() => reply.mutate(false)}>{t('Save private draft')}</button></div></form> : <p className="text-sm text-[var(--muted)]">{t('This round is closed. Existing feedback stays readable.')}</p>}
    {(reply.error || edit.error || remove.error) && <p role="alert" className="writer-error">{errorText(reply.error ?? edit.error ?? remove.error)}</p>}
  </section>
}
