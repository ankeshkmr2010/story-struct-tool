import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'

const reasonLabels: Record<string, string> = {
  no_summary: 'no summary',
  prose_changed_since_summary: 'prose changed since summary',
  no_characters: 'no characters',
  no_location: 'no location',
}

// The server adds the worklist and its instructions to the context when `catchup` is set.
const assistantPrompt = 'Catch up the outline from the prose: follow the reverse_outline instructions for the listed scenes and propose one batch.'

/** Reverse outline: one worklist, reached either by the in-app assistant or an external MCP agent. */
export function OutlineCatchup({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const catchup = useQuery({ queryKey: ['outline-catchup', storyId], queryFn: () => api.getOutlineCatchup(storyId) })
  const connections = useQuery({ queryKey: ['ai-connections'], queryFn: api.listAIConnections })
  const [copied, setCopied] = useState(false)
  const connection = connections.data?.find((item) => item.provider !== 'jev')
  const run = useMutation({
    mutationFn: () => api.proposeAIChanges(storyId, { connection_id: connection!.id, prompt: assistantPrompt, include_prose: false, mode: 'author', catchup: true }),
    onSuccess: () => { void qc.invalidateQueries({ predicate: (query) => query.queryKey.includes(storyId) }) },
  })
  const agentPrompt = `Use StoryTool's catch_up_outline prompt (or call get_outline_catchup) for story ${storyId}. Stage one proposal for my review; don't apply it.`
  const copy = async () => {
    try { await navigator.clipboard.writeText(agentPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) }
  }

  const data = catchup.data
  if (!data || data.drafted_scenes === 0) return null
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h3 className="text-sm font-semibold">Catch up outline</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {data.pending_scenes === 0 ? `All ${data.drafted_scenes} drafted scenes have an outline that matches the prose.` : `${data.pending_scenes} of ${data.drafted_scenes} drafted scenes have an outline behind their prose.`}
          </p>
        </div>
        {data.pending_scenes > 0 && <>
          <button type="button" onClick={() => void copy()} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600">{copied ? 'Copied' : 'Copy prompt for your agent'}</button>
          <button type="button" disabled={!connection || run.isPending} title={connection ? undefined : 'Connect Claude or OpenAI in the assistant first'} onClick={() => run.mutate()} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950">{run.isPending ? 'Asking the assistant…' : 'Ask the assistant'}</button>
        </>}
      </div>
      {run.isError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">{errorText(run.error)}</p>}
      {run.isSuccess && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{run.data.status === 'invalid' ? `The assistant's batch couldn't be validated: ${String(run.data.result?.validation_error ?? '')}` : 'The assistant’s batch is waiting below.'}</p>}
      {data.scenes.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-slate-600 dark:text-slate-300">Scenes to catch up{data.pending_scenes > data.scenes.length ? ` (first ${data.scenes.length})` : ''}</summary>
          <ul className="mt-2 space-y-1">{data.scenes.map((scene) => (
            <li key={scene.id}>
              <span className="font-medium text-slate-700 dark:text-slate-200">{scene.title || 'Untitled scene'}</span>
              {scene.chapter && <span className="text-slate-500 dark:text-slate-400"> · {scene.chapter.title || 'Untitled chapter'}</span>}
              <span className="text-slate-500 dark:text-slate-400"> — {scene.reasons.map((reason) => reasonLabels[reason] ?? reason).join(', ')}</span>
            </li>
          ))}</ul>
        </details>
      )}
    </section>
  )
}
