/**
 * Usability phase 2: which Design tools and ladder levels a story shows, and where a new story opens.
 * Pure so it can be tested; StoryWorkspace applies it.
 */

/** Stories created before this show every tool and level by default (api library.SIMPLE_SINCE). */
export const SIMPLE_SINCE = '2026-10-30T00:00:00Z'

type Card = { show_all_tools: boolean; full_ladder: boolean } | undefined

/**
 * The library card holds the writer's choice. A card can be missing, e.g. a story opened from a library
 * list cached before it was created; then the story's age decides, exactly as the server would.
 */
export function railChoice(card: Card, createdAt: string | undefined, sandbox = false) {
  if (sandbox) return { showAll: true, fullLadder: true }
  const older = !createdAt || Date.parse(createdAt) < Date.parse(SIMPLE_SINCE)
  const showAll = card ? card.show_all_tools : older
  return { showAll, fullLadder: showAll || (card ? card.full_ladder : older) }
}

/** Premise, Acts and Scenes until Go deeper; undefined shows all eight. */
export const ladderLevels = (fullLadder: boolean): number[] | undefined => fullLadder ? undefined : [1, 4, 8]

/** A place already saved wins; otherwise Just write (pantser) starts in Write and the others in Design. */
export const startTab = (mode: string | undefined, saved?: 'write' | 'read' | 'design' | null) =>
  saved ?? (mode === 'pantser' ? 'write' : 'design')
