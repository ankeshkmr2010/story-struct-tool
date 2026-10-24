import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type BetaPoll } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'

export function BetaPollCard({ poll, owner = false, roundOpen = true, refresh, children }: {
  poll: BetaPoll; owner?: boolean; roundOpen?: boolean; refresh: () => void; children?: React.ReactNode
}) {
  const [choices, setChoices] = useState<number[]>(poll.my_response?.choices ?? [])
  const [answer, setAnswer] = useState(poll.my_response?.answer ?? '')
  const vote = useMutation({ mutationFn: () => api.voteBetaPoll(poll.id, { choices, answer }), onSuccess: refresh })
  const canVote = !owner && roundOpen && poll.status === 'open'
  return <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
    <p className="text-xs text-[var(--muted)]">{t('{0} · version {1}{2}', poll.status, poll.version, poll.chapter_id ? t(' · chapter question') : t(' · whole story'))}</p>
    <h3 className="mt-2 text-lg font-semibold">{poll.question}</h3>
    {!owner && <p className="mt-2 text-xs text-[var(--muted)]">{t('{0} One response per reader; you can change it while the poll is open.', poll.anonymous ? t('Your name is hidden in the results. Your wording may identify you.') : t('The author can see your name with your answer.'))}</p>}
    {canVote && <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); vote.mutate() }}>
      {poll.kind === 'text' ? <textarea aria-label={t('Your answer')} required maxLength={4000} value={answer} onChange={e => setAnswer(e.target.value)} disabled={vote.isPending} rows={3} className="w-full rounded border border-[var(--line)] bg-[var(--page)] p-3" /> : poll.options.map((option, index) => <label key={index} className="flex items-start gap-2 text-sm"><input disabled={vote.isPending} type={poll.kind === 'multiple' ? 'checkbox' : 'radio'} name={poll.id} checked={choices.includes(index)} onChange={e => setChoices(poll.kind === 'single' ? [index] : e.target.checked ? [...choices, index] : choices.filter(i => i !== index))} />{option}</label>)}
      <button type="submit" disabled={vote.isPending || (poll.kind === 'text' ? !answer.trim() : choices.length === 0)} className="sharing-primary disabled:opacity-40">{vote.isPending ? t('Saving…') : poll.my_response ? t('Update answer') : t('Submit answer')}</button>
      {vote.isSuccess && <p role="status" className="text-sm text-[var(--accent)]">{t('Answer saved.')}</p>}
      {vote.error && <p role="alert" className="writer-error">{errorText(vote.error)}</p>}
    </form>}
    {poll.results && <div className="mt-4 text-sm"><p>{t('{0} response(s)', poll.results.total)}</p>
      {poll.options.length > 0 && <table className="mt-3 w-full text-left"><thead><tr><th className="pb-2">{t('Option')}</th><th>{t('Readers')}</th><th>%</th></tr></thead><tbody>{poll.options.map((option, i) => <tr key={i}><td className="py-1 pr-3">{option}</td><td>{poll.results!.counts[i] ?? 0}</td><td>{poll.results!.total ? Math.round(100 * (poll.results!.counts[i] ?? 0) / poll.results!.total) : 0}%</td></tr>)}</tbody></table>}
      {poll.kind === 'multiple' && <p className="mt-2 text-xs text-[var(--muted)]">{t('Readers may choose several options.')}</p>}
      {poll.results.responses?.map((response, i) => <p key={i} className="mt-3 whitespace-pre-wrap break-words border-t border-[var(--line)] pt-3">{response.name && <strong>{response.name}: </strong>}{response.answer || response.choices.map(n => poll.options[n]).join(', ')}</p>)}
    </div>}
    {!owner && !poll.results && <p className="mt-3 text-xs text-[var(--muted)]">{t('Results are private unless the author enables them after you vote or the poll closes.')}</p>}
    {children}
  </article>
}
