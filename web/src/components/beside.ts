/** What the read-only Beside panel can show next to the manuscript. */
export type BesideKind = 'scene' | 'character' | 'location' | 'glossary_entry' | 'image'
export type BesideItem = { kind: BesideKind; id: string }
/** `pick` opens the panel on its picker, e.g. from Write's "Open scene beside…". */
export type BesideTarget = BesideItem | { kind: 'pick' }

export const OPEN_BESIDE_EVENT = 'storytool:open-beside'
const KINDS: readonly string[] = ['scene', 'character', 'location', 'glossary_entry', 'image']

/** Any part of the workspace can open something beside the manuscript without prop drilling. */
export const openBeside = (target: BesideTarget) => window.dispatchEvent(new CustomEvent<BesideTarget>(OPEN_BESIDE_EVENT, { detail: target }))

/** The Beside kind for an entity type used by search and checks, if it can be shown. */
export const besideKind = (entity: string | null | undefined): BesideKind | null => entity && KINDS.includes(entity) ? entity as BesideKind : null

export const besideUrl = (storyId: string, item: BesideItem) => `/stories/${storyId}/beside/${item.kind}/${item.id}`

export const isBesideItem = (value: unknown): value is BesideItem =>
  typeof value === 'object' && value !== null && KINDS.includes((value as BesideItem).kind) && typeof (value as BesideItem).id === 'string'
