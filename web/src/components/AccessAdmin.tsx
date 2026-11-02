import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AccessAccount, type AccessCatalogueItem, type AccessTier } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'
import { Button, ConfirmInline } from '../ui/primitives'

function useAccessData() {
  const catalogue = useQuery({ queryKey: ['access-catalogue'], queryFn: api.accessCatalogue })
  const tiers = useQuery({ queryKey: ['access-tiers'], queryFn: api.accessTiers })
  const features = (catalogue.data ?? []).filter(item => item.kind === 'feature')
  return { features, tiers: tiers.data ?? [], error: catalogue.error ?? tiers.error }
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () => { void queryClient.invalidateQueries({ queryKey: ['access-tiers'] }); void queryClient.invalidateQueries({ queryKey: ['my-access'] }) }
}

const Star = ({ filled }: { filled: boolean }) => <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" className={filled ? 'text-[#c9a227]' : 'text-[var(--muted)]'}><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" /></svg>

/** Admin page, Tiers tab: add, mark the default, delete; then one account's tier and overrides. */
export function TiersTab() {
  const { features, tiers, error: loadError } = useAccessData()
  const refresh = useRefresh()
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => api.createAccessTier({
      name: name.trim(),
      key: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tier',
      rank: tiers.length ? Math.max(...tiers.map(row => row.rank)) + 10 : 0,
      is_default: false, features: {}, limits: {},
    }),
    onSuccess: () => { setName(''); refresh() },
  })
  const update = useMutation({ mutationFn: ({ id, is_default }: { id: string; is_default: boolean }) => api.updateAccessTier(id, { is_default }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteAccessTier(id), onSuccess: () => { setDeleting(null); refresh() } })
  const error = loadError ?? create.error ?? update.error ?? remove.error
  return <>
    <section className="mt-8" aria-labelledby="tiers-title">
      <h2 id="tiers-title" className="text-xl font-semibold">{t('Tiers')}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t('Every feature is unlocked until a tier or an account locks it. Reading, editing, export and backups are never locked.')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate() }}>
        <label className="text-sm">{t('New tier')}
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="mt-1 block rounded-md border border-[var(--line)] bg-[var(--surface)] p-2" placeholder={t('e.g. Free')} />
        </label>
        <Button type="submit" disabled={!name.trim() || create.isPending}>{t('Add tier')}</Button>
      </form>
      {tiers.length === 0 && <p className="mt-4 text-sm text-[var(--muted)]">{t('No tiers yet. Nothing is locked for anyone.')}</p>}
      <ul className="mt-4">{tiers.map(tier => {
        const locked = Object.values(tier.features).filter(on => on === false).length
        return <li key={tier.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] py-2 text-sm">
          <span><strong>{tier.name}</strong> <span className="text-xs text-[var(--muted)]">{t('{0} of {1} features locked', locked, features.length)}</span></span>
          <span className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={tier.is_default} disabled={update.isPending} onChange={(event) => update.mutate({ id: tier.id, is_default: event.target.checked })} />{t('Default for accounts with no tier')}</label>
            {deleting === tier.id
              ? <ConfirmInline danger message={t('Delete {0}? Its accounts fall back to the default.', tier.name)} confirmLabel={t('Delete tier')} onConfirm={() => remove.mutate(tier.id)} onCancel={() => setDeleting(null)} />
              : <Button size="sm" variant="ghost" onClick={() => setDeleting(tier.id)}>{t('Delete tier')}</Button>}
          </span>
        </li>
      })}</ul>
      {error && <p role="alert" className="mt-3 text-sm">{errorText(error)}</p>}
    </section>
    <section className="mt-12" aria-labelledby="account-access-title">
      <h2 id="account-access-title" className="text-xl font-semibold">{t('One account')}</h2>
      <AccountEditor features={features} tiers={tiers} />
    </section>
  </>
}

/** Admin page, Features tab: pick a tier, then lock or unlock each feature in it. */
export function TierFeaturesTab() {
  const { features, tiers, error: loadError } = useAccessData()
  const refresh = useRefresh()
  const [selected, setSelected] = useState<string | null>(null)
  const tier = tiers.find(row => row.id === selected) ?? tiers[0]
  const update = useMutation({ mutationFn: (next: Record<string, boolean>) => api.updateAccessTier(tier!.id, { features: next }), onSuccess: refresh })
  const setLocked = (key: string, locked: boolean) => {
    const next = { ...tier!.features }
    if (locked) next[key] = false
    else delete next[key]
    update.mutate(next)
  }
  return <section className="mt-8" aria-labelledby="tier-features-title">
    <h2 id="tier-features-title" className="text-xl font-semibold">{t('Features in a tier')}</h2>
    {tiers.length === 0 && <p className="mt-4 text-sm text-[var(--muted)]">{t('No tiers yet. Add one in the Tiers tab.')}</p>}
    {tier && <>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t('Tiers')}>
        {tiers.map(row => <Button key={row.id} size="sm" variant={row.id === tier.id ? 'primary' : 'secondary'} aria-pressed={row.id === tier.id} onClick={() => setSelected(row.id)}>{row.name}{row.is_default ? ` · ${t('default')}` : ''}</Button>)}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">{t('Filled star: included in this tier. Hollow star: locked.')}</p>
      <ul className="mt-2">{features.map(item => {
        const locked = tier.features[item.key] === false
        return <FeatureRow key={item.key} item={item} locked={locked}>
          <Button size="sm" variant={locked ? 'primary' : 'secondary'} disabled={update.isPending} onClick={() => setLocked(item.key, !locked)}>{locked ? t('Unlock') : t('Lock')}</Button>
        </FeatureRow>
      })}</ul>
    </>}
    {(loadError ?? update.error) && <p role="alert" className="mt-3 text-sm">{errorText(loadError ?? update.error)}</p>}
  </section>
}

function FeatureRow({ item, locked, children }: { item: AccessCatalogueItem; locked: boolean; children: React.ReactNode }) {
  return <li className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] py-2">
    <span className="flex min-w-0 items-start gap-2">
      <Star filled={!locked} />
      <span className="min-w-0">
        <span className="text-sm font-medium">{item.name}</span>
        <span className="block text-xs text-[var(--muted)]">{item.description}</span>
      </span>
    </span>
    <span className="flex gap-2">{children}</span>
  </li>
}

function AccountEditor({ features, tiers }: { features: AccessCatalogueItem[]; tiers: AccessTier[] }) {
  const [email, setEmail] = useState('')
  const queryClient = useQueryClient()
  const [account, setAccount] = useState<AccessAccount | null>(null)
  const search = useMutation({ mutationFn: () => api.findAccessAccounts(email.trim()) })
  const save = useMutation({
    mutationFn: (change: Partial<Pick<AccessAccount, 'tier_id' | 'features'>>) => api.setAccountAccess(account!.user_id, {
      tier_id: account!.tier_id, tier_expires_at: account!.tier_expires_at, features: account!.features,
      limits: account!.limits, note: account!.note, ...change,
    }),
    onSuccess: (row) => { setAccount(row); void queryClient.invalidateQueries({ queryKey: ['my-access'] }) },
  })
  const setOverride = (key: string, value: boolean | null) => {
    const next = { ...account!.features }
    if (value === null) delete next[key]
    else next[key] = value
    save.mutate({ features: next })
  }
  return <div className="mt-4">
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setAccount(null); search.mutate() }}>
      <label className="text-sm">{t('Account email')}
        <input type="search" value={email} maxLength={320} onChange={(event) => setEmail(event.target.value)} className="mt-1 block rounded-md border border-[var(--line)] bg-[var(--surface)] p-2" />
      </label>
      <Button type="submit" disabled={search.isPending}>{t('Find')}</Button>
    </form>
    {search.error && <p role="alert" className="mt-3 text-sm">{errorText(search.error)}</p>}
    {!account && search.data && (search.data.length === 0
      ? <p className="mt-3 text-sm text-[var(--muted)]">{t('No account matches.')}</p>
      : <ul className="mt-3 space-y-1">{search.data.map(row => <li key={row.user_id}><button type="button" className="text-sm underline" onClick={() => setAccount(row)}>{row.email}{row.name ? ` (${row.name})` : ''}</button></li>)}</ul>)}
    {account && <>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <strong>{account.email}</strong>
        <label className="flex items-center gap-2">{t('Tier')}
          <select value={account.tier_id ?? ''} disabled={save.isPending} onChange={(event) => save.mutate({ tier_id: event.target.value || null })} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-1">
            <option value="">{t('None (default tier)')}</option>
            {tiers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        {account.groups.length > 0 && <span className="text-[var(--muted)]">{t('Groups: {0}', account.groups.join(', '))}</span>}
        <Button size="sm" variant="ghost" onClick={() => setAccount(null)}>{t('Back to results')}</Button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">{t('Lock or Unlock here wins over every tier. From tier removes the override.')}</p>
      <ul className="mt-3">{features.map(item => {
        const own = account.features[item.key] as boolean | undefined
        const locked = account.effective.features[item.key] === false
        return <FeatureRow key={item.key} item={item} locked={locked}>
          <Button size="sm" variant={own === false ? 'primary' : 'secondary'} aria-pressed={own === false} disabled={save.isPending} onClick={() => setOverride(item.key, false)}>{t('Lock')}</Button>
          <Button size="sm" variant={own === true ? 'primary' : 'secondary'} aria-pressed={own === true} disabled={save.isPending} onClick={() => setOverride(item.key, true)}>{t('Unlock')}</Button>
          <Button size="sm" variant={own === undefined ? 'primary' : 'ghost'} aria-pressed={own === undefined} disabled={save.isPending} onClick={() => setOverride(item.key, null)}>{t('From tier')}</Button>
        </FeatureRow>
      })}</ul>
    </>}
    {save.error && <p role="alert" className="mt-3 text-sm">{errorText(save.error)}</p>}
  </div>
}
