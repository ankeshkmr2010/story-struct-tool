import { useQuery } from '@tanstack/react-query'
import { api, type Scene } from '../api/client'
import { valueLabel } from '../i18n/server'
import { t } from '../i18n'

type StatusScene = Pick<Scene, 'status' | 'word_count'>

/** One rule everywhere (server: prose.is_drafted): a scene with prose is at least drafted,
 * so placeholder and outlined read as drafted once there are words. */
export const effectiveStatus = (scene: StatusScene) =>
  (scene.word_count ?? 0) > 0 && (scene.status === 'placeholder' || scene.status === 'outlined') ? 'drafted' : scene.status

export const isDrafted = (scene: StatusScene) => ['drafted', 'revised'].includes(effectiveStatus(scene))

/** Simple accounts see Draft and Done; detailed accounts (Settings) see all four statuses.
 * Simple is only a view: Done is stored as revised and Draft as drafted (or placeholder with no prose). */
export const DETAILED = ['placeholder', 'outlined', 'drafted', 'revised']
export const SIMPLE = ['draft', 'done']

export function useDetailedStatuses() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false })
  return me.data?.detailed_statuses !== false
}

export const shownStatus = (scene: StatusScene, detailed: boolean) =>
  detailed ? effectiveStatus(scene) : effectiveStatus(scene) === 'revised' ? 'done' : 'draft'

export const storedStatus = (choice: string, scene: StatusScene) =>
  choice === 'done' ? 'revised' : choice === 'draft' ? ((scene.word_count ?? 0) > 0 ? 'drafted' : 'placeholder') : choice

export const statusName = (value: string) => value === 'draft' ? t('Draft') : value === 'done' ? t('Done') : valueLabel(value)

/** The dot colour for a shown status: Draft uses Drafted's green, Done uses Revised's blue. */
export const dotStatus = (value: string) => value === 'draft' ? 'drafted' : value === 'done' ? 'revised' : value
