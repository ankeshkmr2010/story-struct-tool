import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, type BetaPoll, type BetaPollInput } from '../api/client'
import { errorText } from '../api/errors'
import { BetaPollCard } from '../components/BetaPollCard'
import { t } from '../i18n'

export default function BetaPolls() {
  const { storyId = '' } = useParams()
  return <BetaPollsSection storyId={storyId} />
}

export function BetaPollsSection({ storyId, embedded = false }: { storyId: string; embedded?: boolean }) {
  const qc = useQueryClient()
  const rounds = useQuery({ queryKey: ['beta-rounds', storyId], queryFn: () => api.betaRounds(storyId) })
  const polls = useQuery({ queryKey: ['beta-polls', storyId], queryFn: () => api.betaPolls(storyId) })
  const [editing, setEditing] = useState<BetaPoll | 'new' | null>(null)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['beta-polls', storyId] }) }
  const remove = useMutation({ mutationFn: (id: string) => api.deleteBetaPoll(storyId, id, true), onSuccess: refresh })
  const change = useMutation({ mutationFn: ({ poll, status }: { poll: BetaPoll; status: BetaPollInput['status'] }) => api.updateBetaPoll(storyId, poll.id, { ...poll, kind: poll.kind as BetaPollInput['kind'], status }), onSuccess: refresh })
  const Container = embedded ? 'section' : 'main'
  const Heading = embedded ? 'h2' : 'h1'
  return <Container className={embedded ? 'mt-12 border-t border-[var(--line)] pt-6' : 'mx-auto max-w-4xl px-5 py-8 text-[var(--ink)]'}>
    {!embedded && <div className="flex flex-wrap gap-4 text-sm"><Link to={`/stories/${storyId}`} className="underline">{t('← Story')}</Link><Link to={`/stories/${storyId}/beta`} className="underline">{t('Beta readers')}</Link></div>}
    <Heading className="mt-6 text-3xl font-semibold">{embedded ? t('Beta polls') : t('Story polls')}</Heading><p className="mt-3 text-sm text-[var(--muted)]">{t('All polls and past results, grouped by manuscript round. Editing questions, options or anonymity after responses creates a new version and preserves the original results.')}</p>
    <button className="sharing-primary mt-5" disabled={!rounds.data?.length} onClick={() => setEditing('new')}>{t('Create poll')}</button>
    {!rounds.isPending && rounds.data?.length === 0 && <p className="mt-3 text-sm">{t('Publish a beta round first.')}</p>}
    {editing && rounds.data && <PollEditor key={editing === 'new' ? 'new' : editing.id} storyId={storyId} rounds={rounds.data} poll={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
    {(rounds.error || polls.error || remove.error || change.error) && <p role="alert" className="writer-error mt-4">{errorText(rounds.error ?? polls.error ?? remove.error ?? change.error)}</p>}
    {polls.isPending && <p className="mt-5">{t('Loading polls…')}</p>}
    {rounds.data?.map(round => <section key={round.id} className="mt-8"><h2 className="mb-4 text-xl font-semibold">{round.title} · {round.status}</h2><div className="space-y-4">{polls.data?.filter(p => p.round_id === round.id).map(poll => <BetaPollCard key={poll.id} poll={poll} owner refresh={refresh}>
      <div className="mt-4 flex flex-wrap gap-3 text-xs"><button className="underline" onClick={() => setEditing(poll)}>{t('Edit')}</button><button className="underline" disabled={change.isPending} onClick={() => change.mutate({ poll, status: poll.status === 'open' ? 'closed' : 'open' })}>{poll.status === 'open' ? t('Close') : t('Publish / reopen')}</button><button className="underline" disabled={change.isPending} onClick={() => change.mutate({ poll, status: 'archived' })}>{t('Archive')}</button><button className="text-red-600 dark:text-red-300" disabled={remove.isPending} onClick={() => { if (window.confirm(t('Permanently delete this poll and all its responses? Archive keeps the results.'))) remove.mutate(poll.id) }}>{t('Delete')}</button></div>
    </BetaPollCard>)}</div></section>)}
  </Container>
}

function PollEditor({ storyId, rounds, poll, onClose, onSaved }: {
  storyId: string; rounds: Awaited<ReturnType<typeof api.betaRounds>>; poll: BetaPoll | null; onClose: () => void; onSaved: () => void
}) {
  const [roundId, setRoundId] = useState(poll?.round_id ?? rounds[0]?.id ?? '')
  const [question, setQuestion] = useState(poll?.question ?? '')
  const [kind, setKind] = useState<BetaPollInput['kind']>((poll?.kind as BetaPollInput['kind']) ?? 'single')
  const [options, setOptions] = useState(poll?.options.join('\n') ?? '')
  const [status, setStatus] = useState<BetaPollInput['status']>((poll?.status as BetaPollInput['status']) ?? 'draft')
  const [anonymous, setAnonymous] = useState(poll?.anonymous ?? false)
  const [showResults, setShowResults] = useState(poll?.show_results ?? false)
  const [chapterId, setChapterId] = useState(poll?.chapter_id ?? '')
  const doc = useQuery({ queryKey: ['beta-document', roundId], queryFn: () => api.readBetaRound(roundId), enabled: !!roundId })
  const save = useMutation({ mutationFn: () => {
    const data: BetaPollInput = { round_id: roundId, question, kind, options: kind === 'text' ? [] : options.split('\n').map(s => s.trim()).filter(Boolean), status, anonymous, show_results: showResults, chapter_id: chapterId || null }
    return poll ? api.updateBetaPoll(storyId, poll.id, data) : api.createBetaPoll(storyId, data)
  }, onSuccess: onSaved })
  const control = 'mt-1 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2'
  return <form className="mt-5 space-y-4 rounded-xl border border-[var(--line)] p-5" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <h2 className="text-lg font-semibold">{poll ? t('Edit poll') : t('New poll')}</h2>
    <fieldset disabled={save.isPending} className="space-y-4">
    <label className="block text-sm">{t('Round')}<select className={control} value={roundId} onChange={e => { setRoundId(e.target.value); setChapterId('') }}>{rounds.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
    <label className="block text-sm">{t('Chapter')}<select className={control} value={chapterId} onChange={e => setChapterId(e.target.value)}><option value="">{t('Whole story')}</option>{doc.data?.structure.chapter?.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.title || t('Chapter {0}', String(c.number)))}</option>)}</select></label>
    <label className="block text-sm">{t('Question')}<textarea required maxLength={1000} className={control} value={question} onChange={e => setQuestion(e.target.value)} /></label>
    <label className="block text-sm">{t('Answer type')}<select className={control} value={kind} onChange={e => setKind(e.target.value as BetaPollInput['kind'])}><option value="single">{t('One choice')}</option><option value="multiple">{t('Multiple choices')}</option><option value="text">{t('Written answer')}</option></select></label>
    {kind !== 'text' && <label className="block text-sm">{t('Options, one per line')}<textarea rows={4} className={control} value={options} onChange={e => setOptions(e.target.value)} /></label>}
    <label className="block text-sm">{t('Status')}<select className={control} value={status} onChange={e => setStatus(e.target.value as BetaPollInput['status'])}>{['draft', 'open', 'closed', 'archived'].map(x => <option key={x}>{x}</option>)}</select></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} />{t('Hide reader names in results')}</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={showResults} onChange={e => setShowResults(e.target.checked)} />{t('Let readers see results after answering or closing')}</label>
    </fieldset>
    {doc.error && <p role="alert" className="writer-error">{errorText(doc.error)}</p>}
    {save.error && <p role="alert" className="writer-error">{errorText(save.error)}</p>}
    <div className="flex gap-3"><button type="submit" disabled={save.isPending || !question.trim() || !roundId} className="sharing-primary">{save.isPending ? t('Saving…') : t('Save poll')}</button><button type="button" disabled={save.isPending} className="share-story-button" onClick={onClose}>{t('Cancel')}</button></div>
  </form>
}
