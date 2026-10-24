import { useState } from 'react'
import type { Health } from '../api/client'
import { ContinuityPanel } from './ContinuityPanel'
import { HealthPanel } from './HealthPanel'
import { SuggestionsPanel } from './SuggestionsPanel'
import { t } from '../i18n'

type Tab = 'health' | 'continuity' | 'noticed'

export function InsightsPanel({ storyId, health, level, levelNames, onOpenLevel }: { storyId: string; health?: Health; level?: number; levelNames?: Record<number, string>; onOpenLevel?: (level: number) => void }) {
  const [tab, setTab] = useState<Tab>('health')
  const tabs: { id: Tab; label: string }[] = [
    { id: 'health', label: t('Health') },
    { id: 'continuity', label: t('Continuity') },
    { id: 'noticed', label: t('Noticed') },
  ]

  return (
    <section className="min-w-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="mb-3 flex gap-1 border-b border-slate-200 dark:border-slate-700" aria-label={t('Story insights')}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
            className={[
              'min-w-0 px-2 py-2 text-xs',
              tab === item.id
                ? 'border-b-2 border-slate-800 font-semibold text-slate-900 dark:text-slate-100'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100',
            ].join(' ')}
          >
            {item.label}{item.id === 'health' && Boolean(health?.warning_count) && <span className="workspace-nav-badge ml-1.5" aria-label={t('{0} to fix', health?.warning_count)}>{health?.warning_count}</span>}
          </button>
        ))}
      </div>
      {tab === 'health' && (health ? <HealthPanel health={health} level={level} levelNames={levelNames} onOpenLevel={onOpenLevel} /> : <p className="text-xs text-slate-400">{t('Loading health…')}</p>)}
      {tab === 'continuity' && <ContinuityPanel storyId={storyId} />}
      {tab === 'noticed' && <SuggestionsPanel storyId={storyId} />}
    </section>
  )
}
