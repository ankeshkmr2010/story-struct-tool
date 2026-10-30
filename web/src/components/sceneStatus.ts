import type { Scene } from '../api/client'

/** One rule everywhere (server: prose.is_drafted): a scene with prose is at least drafted,
 * so placeholder and outlined read as drafted once there are words. */
export const effectiveStatus = (scene: Pick<Scene, 'status' | 'word_count'>) =>
  (scene.word_count ?? 0) > 0 && (scene.status === 'placeholder' || scene.status === 'outlined') ? 'drafted' : scene.status

export const isDrafted = (scene: Pick<Scene, 'status' | 'word_count'>) => ['drafted', 'revised'].includes(effectiveStatus(scene))
