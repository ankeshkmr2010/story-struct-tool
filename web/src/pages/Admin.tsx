import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { AdminAnalytics } from '../components/AdminAnalytics'
import { TierFeaturesTab, TiersTab } from '../components/AccessAdmin'
import { t } from '../i18n'
import { Tabs } from '../ui/Tabs'

type Tab = 'analytics' | 'tiers' | 'features'
const TABS: Tab[] = ['analytics', 'tiers', 'features']

/** Site owner tools (STORYTOOL_ADMIN_EMAILS only): analytics, tiers, and the features in each tier. */
export default function Admin() {
  const admin = useQuery({ queryKey: ['admin-status'], queryFn: api.adminStatus })
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(id => id === params.get('tab')) ?? 'analytics'
  return (
    <main className="mx-auto max-w-4xl px-5 py-12 text-[var(--ink)] sm:px-8">
      <p className="eyebrow">{t('ADMIN')}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('Site admin')}</h1>
      {admin.isPending && <p className="mt-6 text-sm">{t('Checking access…')}</p>}
      {admin.error && <p role="alert" className="mt-6 text-sm">{errorText(admin.error)}</p>}
      {admin.data && !admin.data.is_admin && <p className="mt-6 text-sm text-[var(--muted)]">{t('This page is for the site owner.')}{' '}<Link to="/library" className="underline">{t('← Your stories')}</Link></p>}
      {admin.data?.is_admin && <>
        <Tabs<Tab> className="mt-6" label={t('Admin')} value={tab} onChange={(id) => setParams(id === 'analytics' ? {} : { tab: id }, { replace: true })} items={[
          { id: 'analytics', label: t('Analytics') }, { id: 'tiers', label: t('Tiers') }, { id: 'features', label: t('Features in a tier') },
        ]} />
        {tab === 'analytics' && <AdminAnalytics />}
        {tab === 'tiers' && <TiersTab />}
        {tab === 'features' && <TierFeaturesTab />}
      </>}
    </main>
  )
}
