import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { t } from '../i18n'

/** The signed-in account's features. Shared, cached; refetched when an admin changes access. */
export function useMyAccess() {
  return useQuery({ queryKey: ['my-access'], queryFn: api.myAccess, staleTime: 60_000, retry: false })
}

/** True unless the account's plan locks this feature (unknown while loading counts as on). */
export function useFeature(feature: string) {
  return useMyAccess().data?.features[feature] !== false
}

/** A small lock (not in the plan) or open lock (in the plan) beside a gated button. Shown only
 * once plans are in use for this account: it has a tier, or something is locked for it. */
export function FeatureLock({ feature, className = '' }: { feature: string; className?: string }) {
  const access = useMyAccess().data
  if (!access) return null
  const locked = access.features[feature] === false
  const inUse = access.tiers.length > 0 || Object.values(access.features).some(on => !on)
  if (!inUse) return null
  const label = locked ? t('Not included in your plan') : t('Included in your plan')
  return <span className={`feature-lock${locked ? ' is-locked' : ''} ${className}`} title={label} role="img" aria-label={label}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d={locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} />
    </svg>
  </span>
}
