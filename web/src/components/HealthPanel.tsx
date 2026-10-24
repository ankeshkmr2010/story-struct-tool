import { useState } from 'react'
import type { Health } from '../api/client'
import { t } from '../i18n'

// Long lists bury the page on phones; the rest stays one tap away.
const SHOWN = 5

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
  const [all, setAll] = useState(false)
  if (health.findings.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{t('Nothing to fix at this level.')}</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('{0} to fix · {1} suggestion{2}', health.warning_count, health.info_count, health.info_count === 1 ? '' : t('s'))}
      </p>
      <ul className="space-y-1.5">
        {(all ? health.findings : health.findings.slice(0, SHOWN)).map((finding, index) => (
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
                {t('Fix in {0} →', levelNames?.[finding.level] ?? t('level {0}', finding.level))}
              </button>
            )}
          </li>
        ))}
      </ul>
      {health.findings.length > SHOWN && <button type="button" onClick={() => setAll(!all)} className="text-xs font-medium text-[var(--accent)] hover:underline">{all ? t('Show fewer') : t('Show all {0}', health.findings.length)}</button>}
    </div>
  )
}
