import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type MyPlan } from '../api/client'
import { errorText } from '../api/errors'
import { getUiLanguage, plural, t } from '../i18n'

export const planDay = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(getUiLanguage(), { day: 'numeric', month: 'long', year: 'numeric' }) : ''

export const monthsLabel = (months: number) =>
  months % 12 === 0 ? plural(months / 12, '{0} year', '{0} years', months / 12) : plural(months, '{0} month', '{0} months', months)

export function useMyPlan(enabled = true) {
  return useQuery({ queryKey: ['my-plan'], queryFn: api.myPlan, retry: false, enabled })
}

/** Where a tier comes from, in the author's words. */
export function heldLabel(held: MyPlan['held'][number]) {
  const source = held.source === 'account' ? t('Set on your account')
    : held.source === 'group' ? t('Through your group {0}', held.group ?? '')
    : held.source === 'subscription' ? t('Your upgrade')
    : t('Standard plan')
  const ends = held.ends_at ? t('ends {0}', planDay(held.ends_at)) : t('no end date')
  return `${source} · ${ends}`
}

/** Settings → Your plan: what applies now, where it comes from and when it ends. */
export function YourPlanSettings() {
  const plan = useMyPlan()
  const data = plan.data
  return <section id="plan" className="mt-6 scroll-mt-24 rounded-xl border border-slate-200 p-5 dark:border-slate-700 sm:p-6">
    <h2 className="text-lg font-semibold">{t('Your plan')}</h2>
    {plan.isLoading && <p className="writer-help">{t('Loading…')}</p>}
    {plan.error && <p role="alert" className="mt-2 text-sm">{errorText(plan.error)}</p>}
    {data && <>
      {data.everything_included
        ? <p className="writer-help">{t('Everything is included for your account.')}</p>
        : data.held.length === 0
          ? <p className="writer-help">{t('No plan applies to your account.')}</p>
          : <ul className="plan-held">
            {data.held.map((held, index) => <li key={`${held.key}-${held.source}-${index}`}><strong>{held.name}</strong> <span className="writer-help">{heldLabel(held)}</span></li>)}
          </ul>}
      <p className="mt-3"><Link to="/plans" className="ui-btn ui-btn-secondary ui-btn-sm">{data.upgrades === 'off' ? t('See plans') : t('Upgrade')}</Link></p>
    </>}
  </section>
}
