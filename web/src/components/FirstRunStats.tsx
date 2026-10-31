import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { t, tx } from '../i18n'

const STEPS: [string, string][] = [
  ['wrote_a_scene', tx('Wrote a scene')], ['added_a_character', tx('Added a character')], ['ran_a_check', tx('Ran a check')],
  ['connected_ai', tx('Connected AI')], ['first_three_done', tx('First three done')], ['hid_checklist', tx('Hid the checklist')],
]

/** Usability phase 4, item 13 (admin only): time to first scene, first-hour checklist, tools tried and dropped. */
export function FirstRunStats() {
  const data = useQuery({ queryKey: ['first-run'], queryFn: api.firstRunCounts })
  if (data.isPending) return <p className="mt-3 text-sm">{t('Loading counts…')}</p>
  if (data.error) return <p role="alert" className="mt-3 text-sm">{errorText(data.error)}</p>
  const d = data.data
  const cell = 'rounded-lg border border-[var(--line)] p-3'
  return <section className="mt-12" aria-labelledby="first-run-title">
    <h2 id="first-run-title" className="text-xl font-semibold">{t('First run')}</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t('Account-level only, no story content. Dropped means a tool was opened in one session and not again for 7 days.')}</p>
    <h3 className="mt-5 text-sm font-semibold">{t('Time from signup to first scene')}</h3>
    <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
      <div className={cell}><dt className="text-xs text-[var(--muted)]">{t('Median')}</dt><dd className="mt-1 text-xl font-semibold">{d.median_hours_to_first_scene === null ? '—' : t('{0} h', d.median_hours_to_first_scene)}</dd></div>
      {d.hours_to_first_scene.map(bucket => <div key={bucket.label} className={cell}><dt className="text-xs text-[var(--muted)]">{t(bucket.label)}</dt><dd className="mt-1 text-xl font-semibold">{bucket.count}</dd></div>)}
    </dl>
    <h3 className="mt-5 text-sm font-semibold">{t('Your first hour, of {0} accounts', d.accounts)}</h3>
    <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-6">{STEPS.map(([key, label]) => <div key={key} className={cell}><dt className="text-xs text-[var(--muted)]">{t(label)}</dt><dd className="mt-1 text-xl font-semibold">{d.checklist[key] ?? 0}</dd></div>)}</dl>
    <h3 className="mt-5 text-sm font-semibold">{t('Tools opened, most often dropped first')}</h3>
    {d.tools.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">{t('No tool opens recorded yet.')}</p> : <table className="mt-2 w-full max-w-lg text-left text-sm">
      <thead><tr className="text-xs text-[var(--muted)]"><th className="py-1">{t('Tool')}</th><th>{t('Accounts')}</th><th>{t('Dropped')}</th></tr></thead>
      <tbody>{d.tools.map(row => <tr key={row.tool} className="border-t border-[var(--line)]"><td className="py-1">{row.tool}</td><td>{row.accounts}</td><td>{row.dropped}{row.accounts ? ` (${Math.round(row.dropped / row.accounts * 100)}%)` : ''}</td></tr>)}</tbody>
    </table>}
  </section>
}
