import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, type BetaRound } from '../api/client'
import { errorText } from '../api/errors'
import { BetaPollsSection } from './BetaPolls'
import { plural, t } from '../i18n'

export default function BetaOwner() {
  const { storyId = '' } = useParams()
  const qc = useQueryClient()
  const rounds = useQuery({ queryKey: ['beta-rounds', storyId], queryFn: () => api.betaRounds(storyId) })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const [title, setTitle] = useState(t('First beta round'))
  const [brief, setBrief] = useState('')
  const [deadline, setDeadline] = useState('')
  const [auto, setAuto] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [all, setAll] = useState(true)
  const publish = useMutation({ mutationFn: () => api.createBetaRound(storyId, { title, brief, auto_approve: auto, chapter_ids: all ? null : selected, deadline: deadline ? new Date(deadline + 'T23:59:59').toISOString() : null }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['beta-rounds', storyId] }) } })
  const control = 'mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3'
  return <main className="mx-auto max-w-4xl px-5 py-8 text-[var(--ink)]">
    <div className="flex flex-wrap gap-4 text-sm"><Link to={`/stories/${storyId}`} className="underline">{t('← Story')}</Link><a href="#beta-polls" className="underline">{t('Beta polls ↓')}</a></div>
    <h1 className="mt-6 text-3xl font-semibold">{t('Beta readers')}</h1><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{t('Publish a frozen draft while you continue writing. Readers see manuscript chapters and your brief, with private feedback and polls. Planning notes, arcs, AI conversations and other readers\' feedback stay private. Existing ordinary sharing remains separate.')}</p>
    <form className="mt-6 space-y-4 rounded-xl border border-[var(--line)] p-5" onSubmit={e => { e.preventDefault(); publish.mutate() }}>
      <h2 className="text-xl font-semibold">{t('Publish a round')}</h2><label className="block text-sm">{t('Round title')}<input required maxLength={200} className={control} value={title} onChange={e => setTitle(e.target.value)} disabled={publish.isPending} /></label>
      <label className="block text-sm">{t('Reader brief / questions')}<textarea maxLength={5000} rows={4} className={control} value={brief} onChange={e => setBrief(e.target.value)} disabled={publish.isPending} placeholder={t('What would you like readers to notice or respond to?')} /></label>
      <label className="block text-sm">{t('Optional deadline')}<input type="date" className={control} value={deadline} onChange={e => setDeadline(e.target.value)} disabled={publish.isPending} /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} disabled={publish.isPending} />{t('Include all chapters')}</label>
      {!all && <fieldset className="space-y-2"><legend className="mb-2 text-sm">{t('Choose chapters')}</legend>{chapters.data?.map(c => <label key={c.id} className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} disabled={publish.isPending} />{c.title || t('Chapter {0}', String(c.number))}</label>)}</fieldset>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} disabled={publish.isPending} />{t('Automatically admit signed-in readers with the link')}</label><p className="text-xs text-[var(--muted)]">{t('Otherwise, link visitors request your approval. No email is sent automatically. The deadline is guidance, not a reading lock.')}</p>
      <button type="submit" className="sharing-primary" disabled={publish.isPending || !title.trim() || (!all && !selected.length)}>{publish.isPending ? t('Publishing…') : t('Publish saved draft')}</button>
      {publish.error && <p role="alert" className="writer-error">{errorText(publish.error)}</p>}
    </form>
    {(rounds.error || chapters.error) && <p role="alert" className="writer-error">{errorText(rounds.error ?? chapters.error)}</p>}
    {rounds.isPending && <p className="mt-6">{t('Loading rounds…')}</p>}
    {rounds.data?.map(round => <RoundCard key={round.id} storyId={storyId} round={round} />)}
    <div id="beta-polls"><BetaPollsSection storyId={storyId} embedded /></div>
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
  const [category, setCategory] = useState('')
  const triage = useMutation({ mutationFn: () => api.triageBeta(storyId, round.id) })
  const doc = useQuery({ queryKey: ['beta-document', round.id], queryFn: () => api.readBetaRound(round.id) })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['beta-rounds', storyId] }); void members.refetch(); void threads.refetch() }
  const update = useMutation({ mutationFn: (body: Parameters<typeof api.updateBetaRound>[2]) => api.updateBetaRound(storyId, round.id, body), onSuccess: refresh })
  const rotate = useMutation({ mutationFn: () => api.rotateBetaLink(storyId, round.id), onSuccess: refresh })
  const access = useMutation({ mutationFn: ({ id, status }: { id: string; status: 'approved' | 'declined' | 'revoked' }) => api.updateBetaMember(storyId, round.id, id, status), onSuccess: refresh })
  const link = round.join_path ? location.origin + round.join_path : ''
  return <section className="mt-8 space-y-4 rounded-xl border border-[var(--line)] p-5">
    <h2 className="text-xl font-semibold">{round.title} · {round.status}</h2>{round.deadline && <p className="text-sm text-[var(--muted)]">{t('Requested by {0}', new Date(round.deadline).toLocaleDateString())}</p>}{round.brief && <p className="whitespace-pre-wrap text-sm">{round.brief}</p>}
    <div className="flex flex-wrap gap-3 text-sm"><Link to={`/beta/rounds/${round.id}`} className="share-story-button">{t('Preview reader view')}</Link><button className="share-story-button" disabled={update.isPending} onClick={() => update.mutate({ status: round.status === 'open' ? 'closed' : 'open' })}>{round.status === 'open' ? t('Close feedback round') : t('Reopen round')}</button></div>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={round.link_enabled} disabled={update.isPending} onChange={e => update.mutate({ link_enabled: e.target.checked })} />{t('Invitation link enabled')}</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={round.auto_approve} disabled={update.isPending} onChange={e => update.mutate({ auto_approve: e.target.checked })} />{t('Automatic admission')}</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={round.allow_reader_ai ?? false} disabled={update.isPending} onChange={e => update.mutate({ allow_reader_ai: e.target.checked })} /><span>{t('Let readers connect their own AI')}<br /><small className="text-[var(--muted)]">{t('Readers can then let their AI read this round’s frozen chapters, their own comments and your polls. Your manuscript goes to their AI provider. Turning this off cuts their AI off immediately.')}</small></span></label>
    <div className="flex flex-wrap gap-2"><input aria-label={t('Beta invitation link')} readOnly value={link} className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-xs" /><button className="share-story-button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopy(t('Invitation copied.'))).catch(() => setCopy(t('Select and copy the link manually.'))) }}>{t('Copy link')}</button><button className="share-story-button" disabled={rotate.isPending} onClick={() => { if (window.confirm(t('Replace the invitation link? Admitted readers and conversation URLs keep working.'))) rotate.mutate() }}>{t('Rotate link')}</button></div>{copy && <p role="status" className="text-xs">{copy}</p>}
    <h3 className="font-semibold">{t('Readers and requests')}</h3><p className="text-xs text-[var(--muted)]">{t('Progress is reader-reported, not time spent scrolling. Revoking beta access does not revoke any separate ordinary share.')}</p>
    {members.data?.length === 0 && <p className="text-sm">{t('No requests yet.')}</p>}{members.data?.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3 text-sm"><div><p>{member.name} · {member.email}</p><p className="text-xs text-[var(--muted)]">{t('{0} · {1} · {2} chapters marked read', member.status, member.reading_status, member.read_chapters.length)}</p>{member.stopped_reason && <p className="mt-1 text-xs">{member.stopped_reason}</p>}</div><div className="flex gap-3 text-xs">{member.status !== 'approved' && <button disabled={access.isPending || round.status !== 'open'} className="underline" onClick={() => access.mutate({ id: member.id, status: 'approved' })}>{t('Approve / restore')}</button>}{member.status === 'pending' && <button disabled={access.isPending} className="underline" onClick={() => access.mutate({ id: member.id, status: 'declined' })}>{t('Decline')}</button>}{member.status === 'approved' && <button disabled={access.isPending} className="text-red-600 dark:text-red-300" onClick={() => { if (window.confirm(t('Revoke access to this round? Submitted feedback stays available to you.'))) access.mutate({ id: member.id, status: 'revoked' }) }}>{t('Revoke')}</button>}</div></div>)}
    <div className="space-y-3 rounded border border-[var(--line)] p-3 text-sm">
      <button type="button" className="share-story-button" disabled={triage.isPending} onClick={() => triage.mutate()}>{triage.isPending ? t('Grouping feedback…') : triage.data ? t('Group feedback again') : t('Group feedback')}</button>
      <p className="text-xs text-[var(--muted)]">{t('Sends submitted reader comments to the shared reader for categories and severity. Code counts distinct readers; this does not generate a written summary. Re-run after feedback changes.')}</p>
      {triage.error && <p role="alert" className="writer-error">{errorText(triage.error)}</p>}
      {triage.data?.notice && <p role="status">{triage.data.notice}</p>}
      {Boolean(triage.data?.unavailable_count) && <p role="status">{plural(triage.data!.unavailable_count, '{0} comment could not be assessed; counts are incomplete.', '{0} comments could not be assessed; counts are incomplete.', triage.data!.unavailable_count)}</p>}
      {triage.data && !triage.data.items.length && !triage.data.notice && !triage.data.unavailable_count && <p>{t('No submitted reader comments to group.')}</p>}
      {triage.data?.chapters.map(group => {
        const entry = doc.data?.structure.chapter?.find(c => String(c.id) === group.chapter_id)
        return <button type="button" key={`${group.chapter_id}:${group.category}`} className="mr-2 mb-2 rounded border border-[var(--line)] px-2 py-1 text-left" onClick={() => { setChapter(group.chapter_id ?? 'whole-story'); setCategory(group.category); setResolved('all'); setReader('') }}>{t('{0} · {1} reader{2} · {3} ({4} comments)', entry ? String(entry.title || `Chapter ${entry.number}`) : t('Whole story'), group.readers, group.readers === 1 ? '' : t('s'), group.category, group.comments)}</button>
      })}
      {triage.data && <label className="block text-xs">{t('Feedback category')}{' '}<select value={category} onChange={e => setCategory(e.target.value)} className="ml-2 rounded border border-[var(--line)] bg-[var(--surface)] p-2"><option value="">{t('All categories')}</option>{['confusion', 'pacing', 'character', 'typo', 'praise'].map(value => <option key={value}>{value}</option>)}</select></label>}
      {triage.data?.items.some(item => item.uncertain) && <p className="text-xs text-[var(--muted)]">{t('Uncertain classifications are labelled on conversations and excluded from reader counts.')}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">{t('Reader conversations')}</h3><select aria-label={t('Feedback status')} value={resolved} onChange={e => setResolved(e.target.value)} className="rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-xs"><option value="open">{t('Open')}</option><option value="resolved">{t('Resolved')}</option><option value="all">{t('All')}</option></select><select aria-label={t('Filter feedback by reader')} value={reader} onChange={e => setReader(e.target.value)} className="rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-xs"><option value="">{t('All readers')}</option>{members.data?.map(m => <option key={m.id} value={m.user_id}>{m.name}</option>)}</select><select aria-label={t('Filter feedback by chapter')} value={chapter} onChange={e => setChapter(e.target.value)} className="rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-xs"><option value="">{t('All chapters / whole story')}</option><option value="whole-story">{t('Whole story only')}</option>{doc.data?.structure.chapter?.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.title || t('Chapter {0}', String(c.number)))}</option>)}</select></div>
    {threads.data?.filter(thread => (resolved === 'all' || thread.resolved === (resolved === 'resolved')) && (!reader || thread.reader_id === reader) && (!chapter || (chapter === 'whole-story' ? thread.chapter_id === null : thread.chapter_id === chapter)) && (!category || triage.data?.items.some(item => item.thread_id === thread.id && item.category === category))).map(thread => <Link key={thread.id} to={thread.url} className="block rounded border border-[var(--line)] p-3 text-sm"><strong>{thread.messages[0]?.name || t('Reader')}</strong><p className="mt-1 line-clamp-2">{thread.quote || thread.messages[0]?.body || t('Conversation')}</p><span className="text-xs text-[var(--muted)]">{plural(thread.message_count, '{0} message · {1} →', '{0} messages · {1} →', thread.message_count, thread.resolved ? t('Resolved') : t('Open'))}</span>{triage.data?.items.filter(item => item.thread_id === thread.id).map(item => <span key={item.message_id} className="mt-1 mr-2 inline-block rounded bg-[var(--surface)] px-2 py-1 text-xs">{item.category} · {item.category === 'praise' ? t('positive') : ['optional', 'local', 'chapter-level', 'major'][Math.max(0, Math.min(3, Math.round(item.severity)))]}{item.uncertain ? t(' · uncertain') : ''}</span>)}</Link>)}
    {(members.error || threads.error || update.error || rotate.error || access.error) && <p role="alert" className="writer-error">{errorText(members.error ?? threads.error ?? update.error ?? rotate.error ?? access.error)}</p>}
  </section>
}
