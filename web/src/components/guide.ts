import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AuthUser } from '../api/client'
import type { components } from '../api/schema'

/** Teach-in-place state saved on the account (usability phase 3): first-hour checklist and first-use tips. */
export type Guide = components['schemas']['GuideOut']
export type GuideChange = components['schemas']['GuideIn']

export function useGuide() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false })
  const update = (change: GuideChange) => {
    // Show the change at once; the server's answer replaces it.
    qc.setQueryData<AuthUser>(['me'], user => user && { ...user, guide: {
      ...user.guide!,
      ...Object.fromEntries(Object.entries(change).filter(([key, value]) => key !== 'tip_seen' && value != null)),
      tips_seen: change.tip_seen ? [...(user.guide?.tips_seen ?? []), change.tip_seen] : user.guide?.tips_seen ?? [],
    } })
    void api.saveProfile({ guide: change }).then(user => qc.setQueryData(['me'], user)).catch(() => { /* Kept locally until the next reload. */ })
  }
  return { guide: me.data?.guide, update }
}
