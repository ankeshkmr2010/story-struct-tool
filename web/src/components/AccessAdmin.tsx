import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AccessAccount, type AccessCatalogueItem, type AccessTier } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'
import { Button, ConfirmInline } from '../ui/primitives'
import { Tabs } from '../ui/Tabs'

type Mode = 'tiers' | 'account'

/** Admin only: lock or unlock each feature for a tier, or for one account. */
export function AccessAdmin() {
  const [mode, setMode] = useState<Mode>('tiers')
  const catalogue = useQuery({ queryKey: ['access-catalogue'], queryFn: api.accessCatalogue })
  const tiers = useQuery({ queryKey: ['access-tiers'], queryFn: api.accessTiers })
  const featureList = (catalogue.data ?? []).filter(item => item.kind === 'feature')
  return <section className="mt-12" aria-labelledby="access-title">
    <h2 id="access-title" className="text-xl font-semibold">{t('Feature access')}</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t('Every feature is unlocked until a tier or an account locks it. Reading, editing, export and backups are never locked.')}</p>
    <Tabs<Mode> className="mt-4" label={t('Feature access')} value={mode} onChange={setMode} items={[{ id: 'tiers', label: t('Tiers') }, { id: 'account', label: t('One account') }]} />
    {(catalogue.error || tiers.error) && <p role="alert" className="mt-3 text-sm">{errorText(catalogue.error ?? tiers.error)}</p>}
    {mode === 'tiers'
      ? <TierEditor features={featureList} tiers={tiers.data ?? []} />
      : <AccountEditor features={featureList} tiers={tiers.data ?? []} />}
  </section>
}

function FeatureRow({ item, locked, children }: { item: AccessCatalogueItem; locked: boolean; children: React.ReactNode }) {
  return <li className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] py-2">
    <span className="min-w-0">
      <span className="text-sm font-medium">{locked ? '🔒 ' : ''}{item.name}</span>
      <span className="block text-xs text-[var(--muted)]">{item.description}</span>
    </span>
    <span className="flex gap-2">{children}</span>
  </li>
}

function TierEditor({ features, tiers }: { features: AccessCatalogueItem[]; tiers: AccessTier[] }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const tier = tiers.find(row => row.id === selected) ?? tiers[0]
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['access-tiers'] }); void queryClient.invalidateQueries({ queryKey: ['my-access'] }) }
  const create = useMutation({
    mutationFn: () => api.createAccessTier({
      name: name.trim(),
      key: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tier',
      rank: tiers.length ? Math.max(...tiers.map(row => row.rank)) + 10 : 0,
      is_default: false, features: {}, limits: {},
    }),
    onSuccess: (row) => { setName(''); setSelected(row.id); refresh() },
  })
  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.updateAccessTier>[1]) => api.updateAccessTier(tier!.id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: () => api.deleteAccessTier(tier!.id),
    onSuccess: () => { setDeleting(false); setSelected(null); refresh() },
  })
  const setLocked = (key: string, locked: boolean) => {
    const next = { ...tier!.features }
    if (locked) next[key] = false
    else delete next[key]
    update.mutate({ features: next })
  }
  const error = create.error ?? update.error ?? remove.error
  return <div className="mt-4">
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate() }}>
      <label className="text-sm">{t('New tier')}
        <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="mt-1 block rounded-md border border-[var(--line)] bg-[var(--surface)] p-2" placeholder={t('e.g. Free')} />
      </label>
      <Button type="submit" disabled={!name.trim() || create.isPending}>{t('Add tier')}</Button>
    </form>
    {tiers.length === 0 && <p className="mt-4 text-sm text-[var(--muted)]">{t('No tiers yet. Nothing is locked for anyone.')}</p>}
    {tier && <>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t('Tiers')}>
        {tiers.map(row => <Button key={row.id} size="sm" variant={row.id === tier.id ? 'primary' : 'secondary'} aria-pressed={row.id === tier.id} onClick={() => { setSelected(row.id); setDeleting(false) }}>{row.name}{row.is_default ? ` · ${t('default')}` : ''}</Button>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={tier.is_default} disabled={update.isPending} onChange={(event) => update.mutate({ is_default: event.target.checked })} />{t('Default for accounts with no tier')}</label>
        {deleting
          ? <ConfirmInline danger message={t('Delete {0}? Its accounts fall back to the default.', tier.name)} confirmLabel={t('Delete tier')} onConfirm={() => remove.mutate()} onCancel={() => setDeleting(false)} />
          : <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>{t('Delete tier')}</Button>}
      </div>
      <ul className="mt-3">{features.map(item => {
        const locked = tier.features[item.key] === false
        return <FeatureRow key={item.key} item={item} locked={locked}>
          <Button size="sm" variant={locked ? 'primary' : 'secondary'} disabled={update.isPending} onClick={() => setLocked(item.key, !locked)}>{locked ? t('Unlock') : t('Lock')}</Button>
        </FeatureRow>
      })}</ul>
    </>}
    {error && <p role="alert" className="mt-3 text-sm">{errorText(error)}</p>}
  </div>
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
