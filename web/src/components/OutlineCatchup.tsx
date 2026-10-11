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
export function OutlineCatchup({ storyId, onOpenInbox }: { storyId: string; onOpenInbox: () => void }) {
  const qc = useQueryClient()
  const catchup = useQuery({ queryKey: ['outline-catchup', storyId], queryFn: () => api.getOutlineCatchup(storyId) })
  const connections = useQuery({ queryKey: ['ai-connections'], queryFn: api.listAIConnections })
  const [copied, setCopied] = useState(false)
  const connection = connections.data?.find((item) => item.provider !== 'jev')
  const run = useMutation({
    mutationFn: () => api.proposeAIChanges(storyId, { connection_id: connection!.id, prompt: assistantPrompt, include_prose: false, mode: 'author', catchup: true }),
    onSuccess: () => { void qc.invalidateQueries({ predicate: (query) => query.queryKey.includes(storyId) }) },
  })
  const story = useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) })
  const behind = catchup.data?.pending_scenes ?? 0
  const agentPrompt = [
    `Catch up the outline of my StoryTool story "${story.data?.title ?? 'Untitled'}" (story_id ${storyId}) from the prose I've already written. ${behind} drafted scene${behind === 1 ? ' has' : 's have'} an outline that's behind the prose.`,
    'Call get_outline_catchup with that story_id. For each scene it lists, read the prose and propose only what the prose shows:',
    '- a 1–3 sentence summary of what actually happens;',
    '- the characters present, the location and the POV character;',
    '- any new characters, places or timeline events the prose introduces (reuse existing ones; no duplicates).',
    "Don't change the prose. Put everything in one proposal and stage it, but don't apply it: I'll accept or reject each change in StoryTool's Agent changes.",
  ].join('\n')
  const copy = async () => {
    try { await navigator.clipboard.writeText(agentPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) }
  }

  const data = catchup.data
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-2xl font-semibold">Catch up outline</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">Builds the outline from prose you've already written. An agent reads the scenes whose outline is behind and proposes summaries, cast, places and events in one batch. Nothing changes until you accept it in Agent changes, where you can keep all, some or none.</p>
      </header>
      {catchup.isPending && <p className="text-sm text-slate-500 dark:text-slate-400">Checking scenes…</p>}
      {catchup.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(catchup.error)}</p>}
      {data && data.drafted_scenes === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No scene has prose yet. Write some first; this works from what's on the page.</p>}
      {data && data.drafted_scenes > 0 && <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h3 className="text-sm font-semibold">Scenes</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {data.pending_scenes === 0 ? `All ${data.drafted_scenes} drafted scenes have an outline that matches the prose.` : `${data.pending_scenes} of ${data.drafted_scenes} drafted scenes have an outline behind their prose.`}
          </p>
        </div>
        {data.pending_scenes > 0 && <>
          <button type="button" onClick={() => void copy()} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600">{copied ? 'Copied' : 'Copy prompt for your agent'}</button>
          <button type="button" disabled={!connection || run.isPending} title={connection ? undefined : 'Connect Claude or OpenAI in the assistant first'} onClick={() => run.mutate()} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950">{run.isPending ? 'Asking the assistant…' : 'Ask the assistant'}</button>
        </>}
      </div>
      {data.pending_scenes > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-slate-600 dark:text-slate-300">What the agent prompt says</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-slate-700 dark:bg-slate-950 dark:text-slate-200">{agentPrompt}</pre>
        </details>
      )}
      {run.isError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">{errorText(run.error)}</p>}
      {run.isSuccess && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{run.data.status === 'invalid' ? `The assistant's batch couldn't be validated: ${String(run.data.result?.validation_error ?? '')}` : <>The assistant's batch is ready for review. <button type="button" onClick={onOpenInbox} className="font-medium underline">Open Agent changes</button></>}</p>}
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
    </section>}
    </div>
  )
}
