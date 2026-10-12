import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Evaluation } from '../api/client'
import { errorText } from '../api/errors'

/**
 * Evaluate: on-demand craft checks, separate from the live health findings. Pick an
 * evaluator, fill its inputs (yourself, or by asking an AI), run it, follow the links back.
 */

const MICE = [
  ['milieu', 'Milieu', 'a place: opens on arrival, closes on leaving'],
  ['idea', 'Idea', 'a question: opens when asked, closes when answered'],
  ['character', 'Character', 'who someone is: opens on dissatisfaction, closes on change'],
  ['event', 'Event', 'order disrupted: opens on the disruption, closes when order returns'],
] as const

type RhythmVisual = { sequence: { scene_id: string; title: string | null; type: string }[]; runs: { type: string; start: number; length: number }[]; run_limit: number }
type MiceVisual = { scene_count: number; spans: { thread_id: string; title: string; mice: string | null; open: number; close: number }[] }

function RhythmStrip({ visual }: { visual: RhythmVisual }) {
  const long = new Set<number>()
  for (const run of visual.runs) if (run.length >= visual.run_limit) for (let i = run.start; i < run.start + run.length; i += 1) long.add(i)
  return (
    <div>
      <div className="flex flex-wrap gap-1" role="img" aria-label="Scene and sequel sequence in reading order">
        {visual.sequence.map((scene, index) => (
          <span
            key={scene.scene_id}
            title={`${index + 1}. ${scene.title ?? 'Untitled'} (${scene.type})`}
            className={`h-6 w-4 rounded-sm ${scene.type === 'sequel' ? 'bg-sky-400' : 'bg-amber-400'} ${long.has(index) ? 'ring-2 ring-rose-500 ring-offset-1 dark:ring-offset-slate-900' : ''}`}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Scene
        <span className="ml-3 mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" />Sequel
        <span className="ml-3">Ringed: a run of {visual.run_limit} or more</span>
      </p>
    </div>
  )
}

function MiceSpans({ visual }: { visual: MiceVisual }) {
  const width = Math.max(visual.scene_count - 1, 1)
  return (
    <div className="space-y-2">
      {visual.spans.map((span) => (
        <div key={span.thread_id} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-3 text-xs">
          <span className="truncate" title={span.title}>{span.title}{span.mice ? <span className="text-slate-500 dark:text-slate-400"> · {span.mice}</span> : null}</span>
          <div className="relative h-3 rounded-full bg-slate-100 dark:bg-slate-800">
            <span
              className="absolute top-0 h-3 rounded-full bg-emerald-500"
              style={{ left: `${(span.open / width) * 100}%`, width: `max(0.75rem, ${((span.close - span.open) / width) * 100}%)` }}
            />
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500 dark:text-slate-400">Each bar runs from a thread's first scene to its last, in reading order.</p>
    </div>
  )
}

function MiceInputs({ storyId, onOpenInbox }: { storyId: string; onOpenInbox: () => void }) {
  const qc = useQueryClient()
  const threads = useQuery({ queryKey: ['threads', storyId], queryFn: () => api.listThreads(storyId) })
  const story = useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) })
  const connections = useQuery({ queryKey: ['ai-connections'], queryFn: api.listAIConnections })
  const connection = connections.data?.find((item) => item.provider !== 'jev')
  const [copied, setCopied] = useState(false)
  const refresh = () => qc.invalidateQueries({ predicate: (query) => query.queryKey.includes(storyId) })
  const save = useMutation({
    mutationFn: ({ id, mice }: { id: string; mice: string }) => api.updateThread(storyId, id, { mice }),
    onSuccess: () => { void refresh() },
  })
  const missing = threads.data?.filter((thread) => !thread.mice) ?? []
  const instructions = [
    'MICE categories: milieu (a place: opens on arrival, closes on leaving), idea (a question: opens when asked, closes when answered), character (who someone is: opens on dissatisfaction, closes on change), event (order disrupted: opens on the disruption, closes when order returns).',
    'Judge each thread from its title, its owner and the summaries of the scenes linked to it.',
    'Propose an update to the "mice" field only, for threads that have none. Change nothing else. Put everything in one proposal and stage it, but don\'t apply it.',
  ]
  const agentPrompt = [
    `Set the MICE category of each thread that has none in my StoryTool story "${story.data?.title ?? 'Untitled'}" (story_id ${storyId}).`,
    'Use query_story_entities for thread, scene_thread and scene, and get_entity_schema for thread.',
    ...instructions,
    "I'll accept or reject each change in StoryTool's Agent changes.",
  ].join('\n')
  const ask = useMutation({
    mutationFn: () => api.proposeAIChanges(storyId, { connection_id: connection!.id, prompt: ['Set the MICE category of each thread that has none.', ...instructions].join('\n'), include_prose: false, mode: 'author', catchup: false }),
    onSuccess: () => { void refresh() },
  })
  const copy = async () => {
    try { await navigator.clipboard.writeText(agentPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) }
  }

  if (!threads.data || missing.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-950/30">
      <h3 className="text-sm font-semibold">{missing.length} thread{missing.length === 1 ? '' : 's'} without a MICE category</h3>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Fill them in here, or ask an AI to propose them for you to review.</p>
      <ul className="mt-3 space-y-2">
        {missing.map((thread) => (
          <li key={thread.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{thread.title || thread.type.replace('_', '-')}</span>
            <select
              aria-label={`MICE category for ${thread.title || thread.type}`}
              defaultValue=""
              disabled={save.isPending}
              onChange={(event) => { if (event.target.value) save.mutate({ id: thread.id, mice: event.target.value }) }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              <option value="">Choose…</option>
              {MICE.map(([value, label, help]) => <option key={value} value={value} title={help}>{label}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600">{copied ? 'Copied' : 'Copy prompt for your agent'}</button>
        <button type="button" disabled={!connection || ask.isPending} title={connection ? undefined : 'Connect Claude or OpenAI in the assistant first'} onClick={() => ask.mutate()} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950">{ask.isPending ? 'Asking the assistant…' : 'Ask the assistant'}</button>
      </div>
      {ask.isSuccess && <p className="mt-2 text-xs">Proposal ready. <button type="button" className="underline" onClick={onOpenInbox}>Review it in Agent changes →</button></p>}
      {(ask.error || save.error) && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-300">{errorText(ask.error ?? save.error)}</p>}
    </div>
  )
}

const VERDICT: Record<string, { icon: string; label: string; border: string }> = {
  works: { icon: '✅', label: 'Works', border: 'border-emerald-400' },
  consider: { icon: '🟡', label: 'Consider', border: 'border-amber-400' },
  needs_change: { icon: '🔴', label: 'Needs change', border: 'border-rose-500' },
}

function AIReview({ storyId, evaluatorId, evaluatorName, onOpenScene, onOpenThreads }: {
  storyId: string
  evaluatorId: string
  evaluatorName: string
  onOpenScene: (scene: { id: string; chapter_id: string | null }) => void
  onOpenThreads: () => void
}) {
  const qc = useQueryClient()
  const reports = useQuery({ queryKey: ['evaluation-reports', storyId, evaluatorId], queryFn: () => api.listEvaluationReports(storyId, evaluatorId) })
  const threads = useQuery({ queryKey: ['threads', storyId], queryFn: () => api.listThreads(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const story = useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) })
  const connections = useQuery({ queryKey: ['ai-connections'], queryFn: api.listAIConnections })
  const connection = connections.data?.find((item) => item.provider !== 'jev')
  const [copied, setCopied] = useState(false)
  const [shownId, setShownId] = useState<string | null>(null)
  const ask = useMutation({
    mutationFn: () => api.runAIReview(storyId, evaluatorId, connection!.id),
    onSuccess: (report) => { setShownId(report.id); void qc.invalidateQueries({ queryKey: ['evaluation-reports', storyId, evaluatorId] }) },
  })
  const agentPrompt = [
    `Run the "${evaluatorName}" review for my StoryTool story "${story.data?.title ?? 'Untitled'}" (story_id ${storyId}).`,
    `Call get_evaluation_package with evaluator_id ${evaluatorId} and that story_id, and judge exactly as its instructions say, using only its inputs.`,
    "Then call submit_evaluation_report with the package's base_fingerprint, a short summary and one verdict per thread. Don't change the story.",
  ].join('\n')
  const copy = async () => {
    try { await navigator.clipboard.writeText(agentPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) }
  }
  const report = reports.data?.find((item) => item.id === shownId) ?? reports.data?.[0]
  const threadName = (id: string) => { const thread = threads.data?.find((item) => item.id === id); return thread ? thread.title || thread.type.replace('_', '-') : 'A thread' }
  const sceneOf = (id: string) => scenes.data?.find((item) => item.id === id)
  const source = (item: { source: string; model: string | null }) => item.source === 'assistant' ? `Assistant${item.model ? ` (${item.model})` : ''}` : item.source === 'mcp' ? 'Your agent (MCP)' : 'You'

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 p-5 dark:border-slate-700" aria-label="AI review">
      <div>
        <h3 className="text-lg font-semibold">AI review</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">An AI reads each thread's scenes and says whether it works, what to consider, and what needs to change. Nothing in your story is edited.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600">{copied ? 'Copied' : 'Copy prompt for your agent'}</button>
        <button type="button" disabled={!connection || ask.isPending} title={connection ? undefined : 'Connect Claude or OpenAI in the assistant first'} onClick={() => ask.mutate()} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950">{ask.isPending ? 'Reviewing…' : 'Ask the assistant'}</button>
        <button type="button" onClick={() => void reports.refetch()} className="rounded-md px-3 py-1.5 text-xs underline">Check for new reports</button>
      </div>
      {ask.error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{errorText(ask.error)}</p>}
      {reports.data?.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No reviews yet.</p>}

      {report && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {new Date(report.created_at).toLocaleString()} · {source(report)}
            {report.stale && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Stale: the story changed since</span>}
          </p>
          <p className="text-sm leading-6">{report.summary}</p>
          <ul className="space-y-2">
            {report.verdicts.map((item) => {
              const verdict = VERDICT[String(item.verdict)] ?? VERDICT.consider
              const fixes = (item.fixes as string[] | undefined) ?? []
              const sceneIds = (item.scene_ids as string[] | undefined) ?? []
              return (
                <li key={String(item.entity_id)} className={`rounded-md border-l-4 bg-white p-3 text-sm dark:bg-slate-900 ${verdict.border}`}>
                  <p className="font-semibold"><span aria-hidden="true">{verdict.icon}</span> {verdict.label}: <button type="button" onClick={onOpenThreads} className="underline">{threadName(String(item.entity_id))}</button></p>
                  <p className="mt-1 leading-6">{String(item.evidence)}</p>
                  {fixes.length > 0 && <ul className="mt-2 list-disc pl-5">{fixes.map((fix) => <li key={fix}>{fix}</li>)}</ul>}
                  {sceneIds.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-x-3 text-xs">
                      {sceneIds.map((id) => { const scene = sceneOf(id); return scene ? <button key={id} type="button" className="underline" onClick={() => onOpenScene({ id: scene.id, chapter_id: scene.chapter_id ?? null })}>{scene.title || 'Untitled scene'} →</button> : null })}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {reports.data && reports.data.length > 1 && (
        <details>
          <summary className="cursor-pointer text-xs text-slate-600 dark:text-slate-300">Earlier reviews ({reports.data.length - 1})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {reports.data.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setShownId(item.id)} className={`text-left underline ${item.id === report?.id ? 'font-semibold' : ''}`}>
                  {new Date(item.created_at).toLocaleString()} · {source(item)}{item.stale ? ' · stale' : ''}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

export function StoryEvaluation({ storyId, onOpenInbox, onOpenScene, onOpenThreads }: {
  storyId: string
  onOpenInbox: () => void
  onOpenScene: (scene: { id: string; chapter_id: string | null }) => void
  onOpenThreads: () => void
}) {
  const evaluators = useQuery({ queryKey: ['evaluators', storyId], queryFn: () => api.listEvaluators(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const [chosen, setChosen] = useState<string | null>(null)
  const [result, setResult] = useState<Evaluation | null>(null)
  const selected = evaluators.data?.find((item) => item.id === chosen) ?? evaluators.data?.[0]
  const run = useMutation({ mutationFn: (id: string) => api.runEvaluator(storyId, id), onSuccess: setResult })
  const shown = result && result.evaluator_id === selected?.id ? result : null

  const openEntity = (type: string | null | undefined, id: string | null | undefined) => {
    if (!id) return null
    if (type === 'scene') {
      const scene = scenes.data?.find((item) => item.id === id)
      return scene ? () => onOpenScene({ id: scene.id, chapter_id: scene.chapter_id ?? null }) : null
    }
    if (type === 'thread') return onOpenThreads
    return null
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-2xl font-semibold">Evaluate</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">Run a craft check when you want one. Results are suggestions to consider, never rules, and nothing here changes your story unless you fill in an input.</p>
      </header>

      {evaluators.error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{errorText(evaluators.error)}</p>}
      {!evaluators.data && !evaluators.error && <p className="text-sm text-slate-500 dark:text-slate-400">Loading evaluators…</p>}

      {evaluators.data && selected && <>
        <div role="tablist" aria-label="Evaluators" className="flex flex-wrap gap-2">
          {evaluators.data.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === selected.id}
              onClick={() => setChosen(item.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${item.id === selected.id ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-950' : 'border-slate-300 dark:border-slate-600'}`}
            >
              {item.name}
            </button>
          ))}
        </div>

        <section className="space-y-4 rounded-lg border border-slate-200 p-5 dark:border-slate-700">
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{selected.description}</p>
          {selected.missing.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-amber-800 dark:text-amber-300">
              {selected.missing.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
          {selected.id === 'mice_nesting' && <MiceInputs storyId={storyId} onOpenInbox={onOpenInbox} />}
          <button
            type="button"
            disabled={!selected.ready || run.isPending}
            onClick={() => run.mutate(selected.id)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950"
          >
            {run.isPending ? 'Running…' : shown ? 'Run again' : 'Run'}
          </button>
          {run.error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{errorText(run.error)}</p>}
        </section>

        {shown && (
          <section className="space-y-4" aria-label="Results">
            <h3 className="text-lg font-semibold">Results</h3>
            {selected.id === 'scene_rhythm' && <RhythmStrip visual={shown.visual as unknown as RhythmVisual} />}
            {selected.id === 'mice_nesting' && <MiceSpans visual={shown.visual as unknown as MiceVisual} />}
            {shown.findings.length === 0 ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">Nothing to flag.</p>
            ) : (
              <ul className="space-y-2">
                {shown.findings.map((finding, index) => {
                  const open = openEntity(finding.entity_type, finding.entity_id)
                  return (
                    <li key={`${finding.code}-${index}`} className={`rounded-md border-l-4 bg-white p-3 text-sm dark:bg-slate-900 ${finding.severity === 'warning' ? 'border-amber-400' : 'border-slate-300 dark:border-slate-600'}`}>
                      <p>{finding.message}</p>
                      {open && <button type="button" onClick={open} className="mt-1 text-xs underline">{finding.entity_type === 'scene' ? 'Open the scene →' : 'Open threads →'}</button>}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
        {selected.has_review && <AIReview key={selected.id} storyId={storyId} evaluatorId={selected.id} evaluatorName={selected.name} onOpenScene={onOpenScene} onOpenThreads={onOpenThreads} />}
      </>}
    </div>
  )
}
