import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type PlanCheckout, type PlanTier, type PlansList } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'
import { Button } from '../ui/primitives'
import { Dialog } from '../ui/Dialog'
import { heldLabel, monthsLabel, planDay, useMyPlan } from '../components/YourPlan'

type AnyTier = PlansList['tiers'][number] & Partial<Pick<PlanTier, 'have' | 'adds' | 'raises' | 'loses' | 'blocked' | 'can_buy'>>

const limitText = (value: number | null) => (value === null ? t('unlimited') : String(value))

/** Choose a length, see the end date, go ahead. Payment is a stand-in for now. */
function UpgradeDialog({ tier, onClose }: { tier: PlanTier; onClose: () => void }) {
  const qc = useQueryClient()
  const [months, setMonths] = useState(tier.durations[0] ?? 1)
  const [checkout, setCheckout] = useState<PlanCheckout | null>(null)
  const start = useMutation({ mutationFn: () => api.startUpgrade({ tier_id: tier.id, months }), onSuccess: setCheckout })
  const confirm = useMutation({
    mutationFn: (id: string) => api.confirmUpgrade(id),
    onSuccess: async (done) => {
      setCheckout(done)
      await Promise.all([qc.invalidateQueries({ queryKey: ['my-plan'] }), qc.invalidateQueries({ queryKey: ['my-access'] })])
    },
  })
  const paid = checkout?.status === 'paid'
  return <Dialog open onClose={onClose} title={t('Upgrade to {0}', tier.name)}>
    {paid
      ? <div className="plan-dialog">
        <p>{t('Done. {0} is yours until {1}.', tier.name, planDay(checkout.ends_at))}</p>
        <p className="mt-4"><Button variant="primary" onClick={onClose}>{t('Close')}</Button></p>
      </div>
      : <div className="plan-dialog">
        <fieldset disabled={!!checkout || start.isPending}>
          <legend className="writer-help">{t('How long?')}</legend>
          <div className="plan-durations">
            {tier.durations.map(option => <label key={option}><input type="radio" name="months" checked={months === option} onChange={() => setMonths(option)} /> {monthsLabel(option)}</label>)}
          </div>
        </fieldset>
        {tier.price_note && <p className="writer-help mt-2">{tier.price_note}</p>}
        {tier.loses.length > 0 && <p className="writer-help mt-2">{t('Your standard plan stops applying while this one does, so you would not have: {0}.', tier.loses.map(item => item.name).join(', '))}</p>}
        {!checkout
          ? <p className="mt-4"><Button variant="primary" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? t('Preparing…') : t('Continue')}</Button></p>
          : <>
            <p className="mt-4">{t('{0} for {1}, until {2}.', tier.name, monthsLabel(checkout.months), planDay(checkout.ends_at))}</p>
            <p className="writer-help">{t('Payment is not connected yet: going ahead upgrades you without a charge.')}</p>
            <p className="mt-3 flex gap-2">
              <Button variant="primary" disabled={confirm.isPending} onClick={() => confirm.mutate(checkout.id)}>{confirm.isPending ? t('Upgrading…') : t('Go ahead')}</Button>
              <Button onClick={() => { setCheckout(null); confirm.reset() }}>{t('Back')}</Button>
            </p>
          </>}
        {(start.error || confirm.error) && <p role="alert" className="mt-3 text-sm">{errorText(start.error ?? confirm.error)}</p>}
      </div>}
  </Dialog>
}

function TierCard({ tier, signedIn, upgrades, onUpgrade }: { tier: AnyTier; signedIn: boolean; upgrades: PlansList['upgrades']; onUpgrade: () => void }) {
  return <li className="plan-card">
    <div className="plan-card-head">
      <h2 className="text-lg font-semibold">{tier.name}</h2>
      {tier.have && <span className="plan-badge">{tier.have === 'subscription' ? t('Yours') : t('Current')}</span>}
    </div>
    {tier.description && <p className="writer-help">{tier.description}</p>}
    {tier.price_note && <p className="mt-1 font-medium">{tier.price_note}</p>}
    {tier.adds && tier.adds.length > 0 && <p className="mt-2 text-sm">{t('Adds for you: {0}', tier.adds.map(item => item.name).join(', '))}</p>}
    {tier.raises && tier.raises.length > 0 && <p className="mt-1 text-sm">{t('Raises: {0}', tier.raises.map(item => `${item.name} ${limitText(item.value ?? null)}`).join(', '))}</p>}
    <details className="mt-2 text-sm">
      <summary>{t('Includes')}</summary>
      <ul className="plan-includes">
        {tier.includes.map(item => <li key={item.key}>{item.name}{tier.blocked?.some(b => b.key === item.key) && <span className="writer-help"> · {t('set by your administrator')}</span>}</li>)}
        {tier.limits.map(item => <li key={item.key}>{item.name}: {limitText(item.value ?? null)}</li>)}
      </ul>
    </details>
    <div className="mt-3">
      {!signedIn
        ? <Link to="/settings#plan" className="ui-btn ui-btn-secondary ui-btn-sm">{t('Sign in to upgrade')}</Link>
        : upgrades === 'off'
          ? null
          : tier.can_buy
            ? <Button variant="primary" size="sm" onClick={onUpgrade}>{tier.have === 'subscription' ? t('Extend') : t('Upgrade')}</Button>
            : tier.have ? <span className="writer-help">{t('You already have this plan.')}</span> : null}
    </div>
  </li>
}

export default function Plans() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false })
  const signedIn = me.isSuccess
  const mine = useMyPlan(signedIn)
  const open = useQuery({ queryKey: ['plans'], queryFn: api.plans, enabled: me.isError })
  const [choosing, setChoosing] = useState<PlanTier | null>(null)
  const data = signedIn ? mine.data : open.data
  const error = signedIn ? mine.error : open.error
  return <main className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8">
    <Link to="/settings#plan" className="text-sm text-slate-500 dark:text-slate-400 hover:underline">{t('← Your settings')}</Link>
    <h1 className="mt-5 text-2xl font-semibold">{t('Plans')}</h1>
    {mine.data && mine.data.held.length > 0 && <p className="writer-help mt-2">{t('You have: {0}', mine.data.held.map(held => `${held.name} (${heldLabel(held)})`).join('; '))}</p>}
    {data?.upgrades === 'off' && <p className="mt-2">{t('Upgrades are coming soon.')}</p>}
    {error && <p role="alert" className="mt-3 text-sm">{errorText(error)}</p>}
    {data && data.tiers.length === 0 && <p className="writer-help mt-4">{t('There are no plans to choose from yet.')}</p>}
    {data && <ul className="plan-grid mt-6">
      {(data.tiers as AnyTier[]).map(tier => <TierCard key={tier.id} tier={tier} signedIn={signedIn} upgrades={data.upgrades} onUpgrade={() => setChoosing(tier as PlanTier)} />)}
    </ul>}
    {choosing && <UpgradeDialog tier={choosing} onClose={() => setChoosing(null)} />}
  </main>
}
