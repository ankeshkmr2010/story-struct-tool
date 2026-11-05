import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { api, type DesignHintLevel, type DesignHintReading } from '../api/client'
import { errorText } from '../api/errors'
import { isLocalStory } from '../sandbox/storage'
import { useFeature } from './FeatureLock'
import { ReadingFeedback } from './ReadingFeedback'
import { t } from '../i18n'

/**
 * Live design hints: about two seconds after a Design field saves, the shared reader reads that
 * item (api domain/decisions/design_hints.py) and its notes appear under the field they are about.
 * Notes about a field with no slot on screen (e.g. a custom check) show at the end of the item.
 * Read only and dismissible; a newer save drops any reading still in flight.
 */

const KEY = 'storytool.designHints'
const listeners = new Set<() => void>()
const readOn = () => { try { return localStorage.getItem(KEY) === 'on' } catch { return false } }
let on = readOn()
export function setDesignHintsOn(next: boolean) {
  on = next
  try { localStorage.setItem(KEY, next ? 'on' : 'off') } catch { /* per-viewer convenience only */ }
  listeners.forEach(listener => listener())
}
export const useDesignHintsOn = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => on)

type Hint = DesignHintReading['hints'][number]
type Item = {
  saved: (field: string) => void
  notes: (field: string) => ReactNode
  register: (field: string) => () => void
}
const ItemContext = createContext<Item | null>(null)

export function DesignHintItem({ storyId, level, id, children }: { storyId: string; level: DesignHintLevel; id: string; children: ReactNode }) {
  const switchedOn = useDesignHintsOn()
  const allowed = useFeature('design_hints')
  const enabled = switchedOn && allowed && !isLocalStory(storyId)
  const [reading, setReading] = useState<{ field: string; result?: DesignHintReading; error?: string } | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [slots, setSlots] = useState<Record<string, number>>({})
  const timer = useRef<number | undefined>(undefined)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { window.clearTimeout(timer.current); controller.current?.abort() }, [])

  const saved = useCallback((field: string) => {
    if (!enabled) return
    window.clearTimeout(timer.current)
    controller.current?.abort()
    setReading({ field })
    timer.current = window.setTimeout(() => {
      const current = new AbortController()
      controller.current = current
      api.designHints(storyId, { entity_type: level, entity_id: id, field }, current.signal).then(
        result => { if (!current.signal.aborted) { setDismissed([]); setReading({ field, result }) } },
        error => { if (!current.signal.aborted) setReading({ field, error: errorText(error) }) },
      )
    }, 2000)
  }, [enabled, storyId, level, id])

  const register = useCallback((field: string) => {
    setSlots(current => ({ ...current, [field]: (current[field] ?? 0) + 1 }))
    return () => setSlots(current => ({ ...current, [field]: (current[field] ?? 1) - 1 }))
  }, [])

  const visible = (reading?.result?.hints ?? []).filter(hint => !dismissed.includes(hint.code))
  const card = (hint: Hint) => <div className="live-writing-hint design-hint" key={hint.code}>
    <p className="live-hint-message">{hint.message}</p>
    {hint.action && <p className="live-hint-advice">{hint.action}</p>}
    <div className="live-hint-actions">
      {hint.kind === 'custom' && <span className="live-hint-advice">{t('Your check')}</span>}
      {hint.evidence_keys.length
        ? <ReadingFeedback compact storyId={storyId} checkCode={hint.code} evidenceKeys={hint.evidence_keys} probability={hint.probability} rubricVersion={hint.rubric_version} onDismiss={() => setDismissed(list => [...list, hint.code])} onRecorded={outcome => { if (outcome === 'accepted') setDismissed(list => [...list, hint.code]) }} />
        : <button type="button" className="live-hint-dismiss" aria-label={t('Dismiss')} title={t('Dismiss')} onClick={() => setDismissed(list => [...list, hint.code])}>×</button>}
    </div>
  </div>
  const status = (field: string) => reading?.field !== field ? null
    : !reading.result && !reading.error ? <p role="status" className="writer-help design-hint-status">{t('Reading this after you save…')}</p>
    : reading.error ? <p className="writer-help design-hint-status">{reading.error}</p>
    : reading.result?.unavailable ? <p className="writer-help design-hint-status">{reading.result.unavailable}</p>
    : null

  const value = useMemo<Item>(() => ({
    saved,
    register,
    notes: field => enabled ? <>{status(field)}{visible.filter(hint => hint.field === field).map(card)}</> : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [saved, register, enabled, reading, dismissed])
  const orphans = enabled ? visible.filter(hint => !slots[hint.field]) : []
  return <ItemContext.Provider value={value}>
    {children}
    {enabled && reading && !slots[reading.field] && status(reading.field)}
    {orphans.length > 0 && <div className="design-hint-rest">{orphans.map(card)}</div>}
  </ItemContext.Provider>
}

/** For an inline field: call `saved` after a successful save; render `notes` under the input.
 * `slot: false` (inline selects in a header row) only triggers the reading; its notes show at the
 * end of the item. */
export function useDesignHint(field: string | undefined, slot = true) {
  const item = useContext(ItemContext)
  const register = item?.register
  useEffect(() => (slot && field && register ? register(field) : undefined), [slot, field, register])
  if (!field || !item) return null
  return { saved: () => item.saved(field), notes: slot ? item.notes(field) : null }
}
