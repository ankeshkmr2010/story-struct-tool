import type { Ladder as LadderData, Readiness } from '../api/client'

/**
 * The same `readiness` signal rendered under three different policies. This is the whole
 * "one engine, three products" claim made visible:
 *
 *   plotter -- levels past the first closed gate are locked outright
 *   hybrid  -- everything reachable, blockers shown as nudges
 *   pantser -- blockers hidden entirely; work wherever you like
 */
export type AuthoringMode = 'plotter' | 'hybrid' | 'pantser'

function statusFor(
  rung: Readiness,
  mode: AuthoringMode,
  furthest: number,
): 'ready' | 'nudge' | 'locked' {
  if (rung.is_ready) return 'ready'
  if (mode === 'pantser') return 'ready'
  if (mode === 'plotter' && rung.level > furthest) return 'locked'
  return 'nudge'
}

const dot = {
  ready: 'bg-emerald-500',
  nudge: 'bg-amber-400',
  locked: 'bg-slate-300',
} as const

export function Ladder({
  ladder,
  mode,
  activeLevel,
  onSelect,
}: {
  ladder: LadderData
  mode: AuthoringMode
  activeLevel: number
  onSelect: (level: number) => void
}) {
  return (
    <ol className="space-y-1">
      {ladder.levels.map((rung) => {
        const status = statusFor(rung, mode, ladder.furthest_ready_level)
        const isActive = rung.level === activeLevel
        const clickable = status !== 'locked'

        return (
          <li key={rung.level}>
            <button
              disabled={!clickable}
              onClick={() => onSelect(rung.level)}
              className={[
                'w-full rounded-md px-3 py-2 text-left transition',
                isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-100',
                clickable ? '' : 'cursor-not-allowed opacity-45',
              ].join(' ')}
            >
              <span className="flex items-center gap-2.5">
                <span className={`size-2 shrink-0 rounded-full ${dot[status]}`} />
                <span className="text-xs tabular-nums opacity-60">{rung.level}</span>
                <span className="text-sm font-medium">{rung.label}</span>
                {rung.level === ladder.furthest_ready_level && (
                  <span
                    className={[
                      'ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                      isActive ? 'bg-white/20' : 'bg-slate-200 text-slate-600',
                    ].join(' ')}
                  >
                    you are here
                  </span>
                )}
              </span>

              {/* Blockers are the product: they say what to do next, not just "no". */}
              {status === 'nudge' && rung.blocked_by.length > 0 && (
                <ul className={isActive ? 'mt-1.5 space-y-0.5' : 'mt-1.5 space-y-0.5'}>
                  {rung.blocked_by.map((reason) => (
                    <li
                      key={reason}
                      className={[
                        'pl-[26px] text-xs',
                        isActive ? 'text-slate-300' : 'text-amber-700',
                      ].join(' ')}
                    >
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
