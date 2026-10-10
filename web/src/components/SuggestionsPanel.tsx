import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * Pantser mode's surface: things the tool has noticed about the draft.
 *
 * Every entry is an observation about what the author has already written, phrased as a
 * question they can act on or dismiss. Nothing here proposes prose or plot, and dismissing
 * is permanent — a suggestion the author has rejected never comes back.
 */
export function SuggestionsPanel({ storyId }: { storyId: string }) {
  const qc = useQueryClient()

  const noticer = useQuery({ queryKey: ['noticer'], queryFn: api.noticerInfo })
  const suggestions = useQuery({
    queryKey: ['suggestions', storyId],
    queryFn: () => api.listSuggestions(storyId),
  })

  const runPass = useMutation({
    mutationFn: () => api.runNoticingPass(storyId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suggestions', storyId] }),
  })

  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissSuggestion(storyId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suggestions', storyId] }),
  })

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Noticed
        </h2>
        <button
          onClick={() => runPass.mutate()}
          disabled={runPass.isPending}
          className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 disabled:opacity-40"
        >
          {runPass.isPending ? 'reading…' : 'read prose'}
        </button>
      </div>

      {/* The author should never be in doubt about what is reading their book. */}
      {noticer.data && (
        <p className="mb-2 text-[11px] text-slate-400">
          {noticer.data.noticer === 'deterministic'
            ? 'Local name matching · no semantic reader active'
            : `${noticer.data.model} — noticing only, never writing`}
        </p>
      )}

      {runPass.data && (
        <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
          Reader: {runPass.data.noticed_by}. Read {runPass.data.scenes_read} scene
          {runPass.data.scenes_read === 1 ? '' : 's'};{' '}
          {runPass.data.suggestions_added === 0
            ? 'nothing new.'
            : `${runPass.data.suggestions_added} new observation${
                runPass.data.suggestions_added === 1 ? '' : 's'
              }.`}
        </p>
      )}

      {suggestions.data?.length === 0 && (
        <p className="text-sm text-slate-400">
          Nothing noticed yet. Write some prose, then read it.
        </p>
      )}

      <ul className="space-y-1.5">
        {suggestions.data?.map((suggestion) => (
          <li
            key={suggestion.id}
            className="rounded-md border-l-2 border-sky-300 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/60 px-3 py-2"
          >
            <p className="text-sm text-slate-800 dark:text-slate-100">{suggestion.message}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[10px] text-slate-500">{suggestion.noticed_by === 'deterministic' ? 'Local name matcher' : suggestion.noticed_by}</span>
              <span className="font-mono text-[10px] text-slate-400">{suggestion.code}</span>
              <button
                onClick={() => dismiss.mutate(suggestion.id)}
                className="ml-auto text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
