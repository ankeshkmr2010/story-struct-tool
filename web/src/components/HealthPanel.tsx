import type { Health } from '../api/client'

/**
 * Tier-2 findings. Warnings are structural gaps; info is a nudge the author may well
 * overrule on purpose, so the two are visually distinct and never merged into one count.
 * Flagged, never blocked: the style stays quiet, and each finding links to the level that fixes it.
 */
export function HealthPanel({ health, level, levelNames, onOpenLevel }: {
  health: Health
  level?: number
  levelNames?: Record<number, string>
  onOpenLevel?: (level: number) => void
}) {
  if (health.findings.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to fix at this level.</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {health.warning_count} to fix · {health.info_count} suggestion{health.info_count === 1 ? '' : 's'}
      </p>
      <ul className="space-y-1.5">
        {health.findings.map((finding, index) => (
          <li
            key={`${finding.code}-${finding.entity_id ?? index}`}
            className={[
              'border-l-2 py-1 pl-3',
              finding.severity === 'warning' ? 'border-amber-400/70' : 'border-slate-300 dark:border-slate-600',
            ].join(' ')}
          >
            <p className="text-sm leading-5 text-slate-700 dark:text-slate-200">{finding.message}</p>
            {onOpenLevel && finding.level !== level && (
              <button type="button" onClick={() => onOpenLevel(finding.level)} className="mt-1 text-xs font-medium text-[var(--accent)] hover:underline">
                Fix in {levelNames?.[finding.level] ?? `level ${finding.level}`} →
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
