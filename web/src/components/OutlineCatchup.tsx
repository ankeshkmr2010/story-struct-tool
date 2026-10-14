import { SceneImages } from './StoryImages'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type OutlineMatch } from '../api/client'
import { errorText } from '../api/errors'

const reasonLabels: Record<string, string> = {
  no_summary: 'no summary',
  prose_changed_since_summary: 'prose changed since summary',
  no_characters: 'no characters',
  no_location: 'no location',
  outline_mismatch: 'outline may no longer match prose',
  stale_beats: 'assigned beats may be stale',
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
      {data?.stale && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">The story changed during the reading. <button type="button" className="underline" onClick={() => { void catchup.refetch() }}>Refresh catch-up</button></p>}
      {data && data.drafted_scenes === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No scene has prose yet. Write some first; this works from what's on the page.</p>}
      {data && data.drafted_scenes > 0 && <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h3 className="text-sm font-semibold">Scenes</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {data.pending_scenes === 0 ? `No current catch-up flags across ${data.drafted_scenes} drafted scenes.` : `${data.pending_scenes} of ${data.drafted_scenes} drafted scenes may need outline catch-up.`}
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
    </section>}
      <OutlineView storyId={storyId} readings={data?.reader_status ?? {}} behind={new Map(data?.pending_reasons ? Object.entries(data.pending_reasons) : (data?.scenes ?? []).map((scene) => [scene.id, scene.reasons]))} />
    </div>
  )
}

/** The outline the catch-up keeps in step with the prose: per chapter, each scene's summary, people, place and events. */
function OutlineView({ storyId, behind, readings }: { storyId: string; behind: Map<string, string[]>; readings: Record<string, OutlineMatch> }) {
  const timeline = useQuery({ queryKey: ['timeline', storyId], queryFn: () => api.getTimeline(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  if (timeline.isPending || scenes.isPending) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading the outline…</p>
  if (timeline.isError) return <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(timeline.error)}</p>
  const words = new Map((scenes.data ?? []).map((scene) => [scene.id, scene.word_count]))
  const entries = timeline.data.entries
  const sceneEntries = entries.filter((entry) => entry.kind === 'scene').sort((a, b) => (a.reading_order ?? Infinity) - (b.reading_order ?? Infinity))
  if (sceneEntries.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">No scenes yet.</p>
  const chapters: { title: string; scenes: typeof sceneEntries }[] = []
  for (const scene of sceneEntries) {
    const title = scene.chapter_title ?? 'Not in a chapter'
    const group = chapters.find((item) => item.title === title) ?? chapters[chapters.push({ title, scenes: [] }) - 1]
    group.scenes.push(scene)
  }
  return (
    <section className="space-y-5" aria-label="Outline">
      <h3 className="text-lg font-semibold">Outline</h3>
      {chapters.map((chapter) => (
        <div key={chapter.title} className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{chapter.title}</h4>
          <ul className="space-y-2">{chapter.scenes.map((scene) => {
            const reasons = behind.get(scene.id)
            const reading = readings[scene.id]
            const drafted = (words.get(scene.id) ?? 0) > 0
            const events = entries.filter((entry) => entry.kind === 'event' && entry.scene_id === scene.id)
            return (
              <li key={scene.id} className={`rounded-lg border p-3 ${reasons ? 'border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/40' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{scene.title || 'Untitled scene'}</p>
                  <span className={`text-[11px] ${reasons ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>{reasons ? `Outline behind: ${reasons.map((reason) => reasonLabels[reason] ?? reason).join(', ')}` : drafted ? reading?.status === 'match' ? 'No likely outline mismatch' : reading?.status === 'uncertain' ? 'Outline match uncertain' : 'Outline not assessed' : 'No prose yet'}</span>
                </div>
                <p className={`mt-1 text-sm leading-6 ${scene.summary ? 'text-slate-700 dark:text-slate-200' : 'italic text-slate-400'}`}>{scene.summary || 'No summary'}</p>
                {Boolean(reading?.stale_beat_labels?.length) && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Possible stale beats: {reading.stale_beat_labels!.join(', ')}</p>}
                <dl className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-[5rem_1fr] dark:text-slate-300">
                  <dt className="text-slate-400">People</dt><dd>{scene.participants.map((person) => person.name).join(', ') || '—'}</dd>
                  <dt className="text-slate-400">Place</dt><dd>{scene.location_name || '—'}</dd>
                  <dt className="text-slate-400">Events</dt><dd>{events.map((event) => event.title).join(' · ') || '—'}</dd>
                </dl>
                <SceneImages storyId={storyId} sceneId={scene.id} />
              </li>
            )
          })}</ul>
        </div>
      ))}
    </section>
  )
}
