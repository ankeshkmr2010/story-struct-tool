import type { Ladder as LadderData, Readiness } from '../api/client'
import { levelLabel, serverText } from '../i18n/server'

/**
 * The same `readiness` signal rendered under three different policies. This is the whole
 * "one engine, three products" claim made visible:
 *
 *   plotter -- levels past the first closed gate are dimmed, still open, blockers shown
 *   hybrid  -- everything reachable, blockers shown as nudges
 *   pantser -- blockers hidden entirely; work wherever you like
 */
export type AuthoringMode = 'plotter' | 'hybrid' | 'pantser'

function statusFor(
  rung: Readiness,
  mode: AuthoringMode,
  furthest: number,
): 'ready' | 'nudge' | 'locked' | 'unknown' {
  if (mode === 'pantser' || !rung.assessed) return 'unknown'
  if (mode === 'plotter' && rung.level > furthest) return 'locked'
  if (rung.is_ready) return 'ready'
  return 'nudge'
}

// A level with nothing in it yet is empty, not unfinished: neutral dot, no reasons (usability phase 2).
function isEmpty(level: number, s: LadderData['snapshot']): boolean {
  return [0, 0, s.turning_point_count, s.character_count, s.act_count, s.beat_count, s.thread_count, s.chapter_count, s.scene_count][level] === 0
}

const dot = {
  unknown: 'bg-slate-300 dark:bg-slate-600',
  ready: 'bg-emerald-500',
  nudge: 'bg-amber-400',
  locked: 'bg-slate-300 dark:bg-slate-600',
} as const

export function Ladder({
  ladder,
  mode,
  activeLevel,
  onSelect,
  visibleLevels,
}: {
  ladder: LadderData
  mode: AuthoringMode
  activeLevel: number
  onSelect: (level: number) => void
  /** The levels this story shows (usability phase 2); all when omitted. The open level always shows. */
  visibleLevels?: number[]
}) {
  return (
    <ol className="space-y-1">
      {ladder.levels.filter((rung) => !visibleLevels || visibleLevels.includes(rung.level) || rung.level === activeLevel).map((rung) => {
        const empty = isEmpty(rung.level, ladder.snapshot)
        const assessed = statusFor(rung, mode, ladder.furthest_ready_level)
        const status = empty && assessed !== 'locked' ? 'unknown' : assessed
        const isActive = rung.level === activeLevel
        // Flagged, never blocked: a gated level is dimmed but stays open, because it may
        // already hold work (an agent can fill any level).
        const gated = status === 'locked'

        return (
          <li key={rung.level}>
            <button
              onClick={() => onSelect(rung.level)}
              title={rung.blocked_by.join(' ') || undefined}
              aria-current={isActive ? 'step' : undefined}
              className={[
                'w-full rounded-md px-2.5 py-1.5 text-left transition',
                'ladder-step', isActive ? 'is-active' : '',
                gated && !isActive ? 'opacity-60' : '',
              ].join(' ')}
            >
              <span className="flex items-center gap-2.5">
                <span className={`size-2 shrink-0 rounded-full ${dot[status]}`} />
                <span className="text-xs tabular-nums opacity-60">{rung.level}</span>
                <span className="text-sm font-medium">{levelLabel(rung.level, rung.label)}</span>
              </span>

              {isActive && status !== 'ready' && !empty && rung.blocked_by.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {rung.blocked_by.map((reason) => (
                    <li
                      key={reason}
                      className="pl-[26px] text-xs text-slate-300 dark:text-slate-500"
                    >
                      {serverText(reason)}
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
