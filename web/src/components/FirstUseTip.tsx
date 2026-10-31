import { useState } from 'react'
import { t, tx } from '../i18n'
import { useGuide } from './guide'

/**
 * Usability phase 3, item 11: one dismissible tip the first time each tool opens. The workspace shows
 * at most one (for the open tool); "Turn off tips" stops them everywhere. Saved on the account; signed
 * out (the /try sandbox) they are remembered in this browser instead.
 */
const TIPS: Record<string, string> = {
  write: tx('Use the bar above for Split view, Add TK, Image and Focus. Type / on an empty line, or right-click the prose, for every writing action.'),
  read: tx('Read shows the book the way a reader sees it. Your place is remembered.'),
  'view-1': tx('Start with a sentence or two: who wants what, and what stands in the way.'),
  'view-2': tx('Mark at least three turning points, such as the inciting incident, the midpoint and the climax.'),
  'view-3': tx('A name is enough to start. Add what they chase and what they really need when you know.'),
  'view-4': tx('Give each act the change it carries; the act ends when that change lands.'),
  'view-5': tx('Beats are the moments each act must reach. Link scenes to them from the scene details.'),
  'view-6': tx('Give each thread a question or promise; link scenes to show where it moves.'),
  'view-7': tx('Chapters group scenes for the reader. Their order is the book’s order.'),
  'view-8': tx('Scenes are where the writing lives. Open one in Write to draft it.'),
  'view-104': tx('Accept a batch to keep your AI’s edits; you can undo it from here later.'),
  'view-105': tx('Click a scene for its details. Filters narrow the grid by status or POV.'),
  'view-106': tx('Catch up lists drafted scenes whose outline has fallen behind the prose.'),
  'view-107': tx('Save a named version before a big rewrite. You can preview and restore any version.'),
  'view-108': tx('Start with Needs attention. Craft checks go deeper when you want them.'),
  'view-109': tx('Every [TK: …] in your prose is listed here. Open one to jump to it.'),
  'view-110': tx('Each bar is a scene, sized by length, so slow or rushed stretches stand out.'),
  'view-111': tx('Structure lays your scenes against a story framework, so missing beats show at a glance.'),
  'view-112': tx('Timeline shows when things happen in the story’s world, beside the order readers meet them.'),
  'view-113': tx('Open a place beside the manuscript from Write’s Split view while you draft.'),
  'view-114': tx('Add plain and formal names as aliases so search and checks find every mention.'),
}

const LOCAL = 'storytool-tips'
const readLocal = (): { off?: boolean; seen?: string[] } => { try { return JSON.parse(localStorage.getItem(LOCAL) || '{}') } catch { return {} } }
const writeLocal = (value: { off?: boolean; seen?: string[] }) => { try { localStorage.setItem(LOCAL, JSON.stringify(value)) } catch { /* Optional browser storage. */ } }

export function FirstUseTip({ id, className = 'first-use-tip' }: { id: string | null; className?: string }) {
  const { guide, signedIn, pending, update } = useGuide()
  const [local, setLocal] = useState(readLocal)
  if (!id || !TIPS[id] || pending || (signedIn && !guide)) return null
  const off = signedIn ? guide!.tips_off : Boolean(local.off)
  const seen = signedIn ? guide!.tips_seen : local.seen ?? []
  if (off || seen.includes(id)) return null
  const save = (next: { off?: boolean; seen?: string[] }) => { setLocal(next); writeLocal(next) }
  const dismiss = () => signedIn ? update({ tip_seen: id }) : save({ ...local, seen: [...seen, id] })
  const turnOff = () => signedIn ? update({ tips_off: true }) : save({ ...local, off: true })
  return <p className={className} role="note">
    <span>{t('Tip:')} {t(TIPS[id])}</span>
    <span className="first-use-tip-actions"><button type="button" onClick={dismiss}>{t('Got it')}</button><button type="button" onClick={turnOff}>{t('Turn off tips')}</button></span>
  </p>
}
