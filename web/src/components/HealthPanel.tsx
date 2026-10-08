import type { Health } from '../api/client'

/**
 * Tier-2 findings. Warnings are structural gaps; info is a nudge the author may well
 * overrule on purpose, so the two are visually distinct and never merged into one count.
 */
export function HealthPanel({ health }: { health: Health }) {
  if (health.findings.length === 0) {
    return (
      <p className="rounded-md bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
        No structural gaps at this level.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {health.warning_count} warning{health.warning_count === 1 ? '' : 's'} ·{' '}
        {health.info_count} note{health.info_count === 1 ? '' : 's'}
      </p>
      <ul className="space-y-1.5">
        {health.findings.map((finding, index) => (
          <li
            key={`${finding.code}-${finding.entity_id ?? index}`}
            className={[
              'rounded-md border-l-2 px-3 py-2',
              finding.severity === 'warning'
                ? 'border-amber-400 bg-amber-50 dark:bg-amber-950'
                : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-950',
            ].join(' ')}
          >
            <p className="text-sm text-slate-800 dark:text-slate-100">{finding.message}</p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">
              L{finding.level} · {finding.code}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
