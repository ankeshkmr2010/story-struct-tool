/** A character or place whose name just changed on its sheet. */
export type Rename = { kind: 'character' | 'location'; id: string; from: string; to: string }
export const OFFER_RENAME_EVENT = 'storytool:offer-rename'

/** Called after a rename is saved; the workspace then offers to update the prose. */
export const offerRename = (rename: Rename) => {
  if (rename.from.trim() && rename.to.trim() && rename.from.trim() !== rename.to.trim()) window.dispatchEvent(new CustomEvent<Rename>(OFFER_RENAME_EVENT, { detail: rename }))
}
