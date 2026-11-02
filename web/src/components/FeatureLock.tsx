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

/** A premium star beside a gated button: hollow when the plan does not include it, filled when it does. Shown only
 * once plans are in use for this account: it has a tier, or something is locked for it. */
export function FeatureLock({ feature, className = '' }: { feature: string; className?: string }) {
  const access = useMyAccess().data
  if (!access) return null
  const locked = access.features[feature] === false
  const inUse = access.tiers.length > 0 || Object.values(access.features).some(on => !on)
  if (!inUse) return null
  const label = locked ? t('Premium: not included in your plan') : t('Premium: included in your plan')
  return <span className={`feature-lock${locked ? ' is-locked' : ''} ${className}`} title={label} role="img" aria-label={label}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill={locked ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" />
    </svg>
  </span>
}
