import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * Contradictions and possible anomalies, visually distinct on purpose.
 *
 * A contradiction is provable from the story graph, so it is stated plainly. A possible
 * anomaly is a model's reading, so it carries its confidence and is phrased as a question.
 * Presenting a guess with the authority of a proof is how a tool like this loses an author's
 * trust — once it accuses them wrongly, they stop reading the panel.
 *
 * Neither kind ever proposes the fix.
 */
export function ContinuityPanel({ storyId }: { storyId: string }) {
  const continuity = useQuery({
    queryKey: ['continuity', storyId],
    queryFn: () => api.getContinuity(storyId),
  })

  if (continuity.isPending) return null

  const report = continuity.data
  if (!report) return null

  if (report.anomalies.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Continuity
        </h2>
        <p className="rounded-md bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          Nothing contradicts itself.
        </p>
      </section>
    )
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Continuity
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {report.contradiction_count} contradiction
          {report.contradiction_count === 1 ? '' : 's'}
          {report.possible_count > 0 && ` · ${report.possible_count} to check`}
        </span>
      </div>

      <ul className="space-y-1.5">
        {report.anomalies.map((anomaly, index) => {
          const proven = anomaly.kind === 'contradiction'
          return (
            <li
              key={`${anomaly.code}-${index}`}
              className={[
                'rounded-md border-l-2 px-3 py-2',
                proven ? 'border-red-400 bg-red-50 dark:bg-red-950' : 'border-violet-300 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/60',
              ].join(' ')}
            >
              <p className="text-sm text-slate-800 dark:text-slate-100">{anomaly.message}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="font-mono text-[10px] text-slate-400">{anomaly.code}</span>
                {!proven && anomaly.confidence !== null && (
                  <span className="text-[10px] text-violet-700 dark:text-violet-300">
                    {Math.round(anomaly.confidence * 100)}% sure
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
