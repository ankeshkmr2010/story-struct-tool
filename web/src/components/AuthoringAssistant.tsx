import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type AIObservation, type AIRun } from '../api/client'
import { AIChangePreview } from './AIChangePreview'
import { errorText } from '../api/errors'

const prompts = [
  'Build a connected outline from my premise: characters, acts, beats, threads, chapters, scenes, locations and timeline events. Reuse what is already defined.',
  'Review the reader observations and story gaps. Explain the most useful improvements and propose concrete changes while keeping uncertain findings uncertain.',
  'Map the important events with their people and locations. Keep when events happen separate from when the reader discovers them, including flashbacks.',
]

export function AuthoringAssistant({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const connections = useQuery({ queryKey: ['ai-connections'], queryFn: api.listAIConnections })
  const runs = useQuery({ queryKey: ['ai-runs', storyId], queryFn: () => api.listAIRuns(storyId) })
  const context = useQuery({ queryKey: ['ai-context', storyId], queryFn: () => api.getAIContext(storyId) })
  const [connectionId, setConnectionId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [includeProse, setIncludeProse] = useState(false)
  const [mode, setMode] = useState<'author' | 'review'>('author')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const conversationEnd = useRef<HTMLDivElement>(null)
  const reviewPanel = useRef<HTMLElement>(null)
  const conversation = [...(runs.data ?? [])].reverse()
  const available = connections.data?.filter((item) => item.provider !== 'jev') ?? []
  const selectedConnection = available.find((item) => item.id === connectionId)?.id ?? available[0]?.id ?? ''
  const selected = runs.data?.find((run) => run.id === selectedId) ?? runs.data?.[0]
  const refresh = () => { void qc.invalidateQueries({ predicate: (query) => query.queryKey.includes(storyId) }); void qc.invalidateQueries({ queryKey: ['stories'] }) }
  const cacheRun = (run: AIRun) => qc.setQueryData<AIRun[]>(['ai-runs', storyId], (previous) => previous?.some((item) => item.id === run.id) ? previous.map((item) => item.id === run.id ? run : item) : [run, ...(previous ?? [])])
  const generate = useMutation({ mutationFn: (message: string) => api.proposeAIChanges(storyId, { connection_id: selectedConnection, prompt: message, include_prose: includeProse, mode, conversation_run_ids: conversation.slice(-20).map((run) => run.id) }), onSuccess: (run) => { console.info('[Story assistant] Reply received', { runId: run.id, status: run.status, replyLength: run.summary.length, changes: run.proposal.operations.length }); cacheRun(run); setSelectedId(run.id); setPrompt(''); refresh() } })
  const apply = useMutation({ mutationFn: (id: string) => api.applyAIRun(storyId, id), onSuccess: (run) => { cacheRun(run); refresh() } })
  const undo = useMutation({ mutationFn: (id: string) => api.undoAIRun(storyId, id), onSuccess: (run) => { cacheRun(run); refresh() } })
  const dismiss = useMutation({ mutationFn: (id: string) => api.dismissAIRun(storyId, id), onSuccess: (run) => { cacheRun(run); refresh() } })
  const read = useMutation({ mutationFn: () => api.runNoticingPass(storyId), onSuccess: refresh })
  const busy = generate.isPending || apply.isPending || undo.isPending
  useEffect(() => {
    if (!generate.isPending) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [generate.isPending])
  useEffect(() => { conversationEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [runs.data?.length, generate.isPending])
  const labels = new Map<string, string>()
  Object.entries(context.data?.entities ?? {}).forEach(([kind, rows]) => rows.forEach((row) => {
    const title = row.name ?? row.title ?? row.label ?? kind.replaceAll('_', ' ')
    if (typeof row.id === 'string' && typeof title === 'string') labels.set(row.id, title)
  }))
  selected?.proposal.operations.forEach((operation) => {
    const title = operation.data.name ?? operation.data.title ?? operation.data.label
    if (typeof title === 'string' && operation.op === 'create') labels.set(operation.ref, title)
  })
  const displayValue = (value: unknown): string => {
    if (value === null) return 'Not set'
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'string') return labels.get(value) ?? (value.startsWith('new:') ? value.slice(4).replaceAll('_', ' ') : value)
    return JSON.stringify(value)
  }
  return (
    <div className="space-y-5">
      <header><p className="text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-300">Your story, in conversation</p><h2 className="mt-1 text-2xl font-semibold">Story assistant</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">Chat about your ideas, ask questions, and develop a plan together. Ask the assistant to populate characters, beats, arcs, chapters, scenes, places, or the timeline, then review and apply its changes here.</p></header>
      {connections.isPending && <p className="text-sm text-slate-500 dark:text-slate-400">Loading your AI connections…</p>}
      {connections.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(connections.error)}</p>}
      {!connections.isPending && available.length === 0 && <p className="rounded-lg bg-violet-50 dark:bg-violet-950 p-4 text-sm text-violet-900 dark:text-violet-300"><Link to="/settings" className="font-medium underline">Connect OpenRouter, Claude or OpenAI in Settings</Link> to start authoring. Your provider key is used only for your account.</p>}
      <form className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5" onSubmit={(event) => { event.preventDefault(); if (!busy && selectedConnection && prompt.trim()) { setElapsed(0); generate.mutate(prompt.trim()) } }}>
        <div className="flex flex-wrap gap-3"><label className="text-xs text-slate-600 dark:text-slate-300">Model<select aria-label="Authoring model" value={selectedConnection} onChange={(event) => setConnectionId(event.target.value)} className="ml-2 max-w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-1.5 text-sm"><option value="" disabled>Choose a connection</option>{available.map((item) => <option key={item.id} value={item.id}>{item.provider === 'anthropic' ? 'Claude' : item.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} · {item.model}</option>)}</select></label><select aria-label="Assistant task" value={mode} onChange={(event) => setMode(event.target.value as 'author' | 'review')} className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-1.5 text-sm"><option value="author">Build or change structure</option><option value="review">Review and suggest</option></select></div>
        <div className="flex flex-wrap gap-2">{['Build an outline', 'Improve suggestions', 'Map the timeline'].map((label, index) => <button key={label} type="button" onClick={() => { setPrompt(prompts[index]); setMode(index === 1 ? 'review' : 'author') }} className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950">{label}</button>)}</div>
        <textarea aria-label="Message to story assistant" value={prompt} disabled={generate.isPending} onChange={(event) => setPrompt(event.target.value)} maxLength={12000} rows={3} placeholder="Talk about your story… e.g. ‘Help me decide Mara’s arc’, then ‘Use that idea to populate the beats and timeline’." className="w-full rounded-lg border border-slate-300 dark:border-slate-600 p-3 text-sm focus:border-violet-400 focus:outline-none disabled:opacity-60" />
        <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><input type="checkbox" checked={includeProse} onChange={(event) => setIncludeProse(event.target.checked)} />Share prose excerpts with this model</label><button type="submit" disabled={busy || !selectedConnection || !prompt.trim()} className="rounded-md bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm text-white dark:text-slate-950 disabled:opacity-40">{generate.isPending ? 'Thinking…' : 'Send message'}</button></div>
        <p className="text-xs text-slate-400">Replies use your current story, reader observations, and the latest 20 exchanges. Changes take effect when you apply them. New prose excerpts are shared only when selected; earlier messages stay in the conversation.</p>
        {generate.isPending && <p role="status" className="text-xs text-violet-700 dark:text-violet-300">Waiting for the model · {elapsed}s. Free models can be busy; the model request stops after 90 seconds.</p>}
      </form>
      <section aria-label="Story conversation" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/50 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Conversation</h3><span className="text-xs text-slate-400">Saved with this story</span></div>
        {runs.isPending && <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading your conversation…</p>}
        {!runs.isPending && conversation.length === 0 && <p className="my-6 text-sm leading-6 text-slate-500 dark:text-slate-400">Start with an idea, or ask “What does my story need next?” You can discuss options before asking for changes.</p>}
        <div className="mt-4 max-h-[34rem] space-y-5 overflow-y-auto pr-1" aria-live="polite" aria-busy={generate.isPending}>
          {conversation.map((run, index) => <article key={run.id} className="space-y-3">
            <div className="ml-auto max-w-[90%] rounded-xl bg-violet-100 dark:bg-violet-950 px-4 py-3"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">{run.provider === 'external' ? 'External review' : 'You'}</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100">{run.prompt}</p></div>
            <div className="mr-auto max-w-[95%] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{index === conversation.length - 1 ? 'Story assistant · latest reply' : 'Story assistant'}</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">{run.summary}</p>
              <AIChangePreview run={run} entities={context.data?.entities} />
              {(run.proposal.operations.length > 0 || run.proposal.recommendations.length > 0) && <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 dark:border-slate-800 pt-3"><button type="button" onClick={() => { setSelectedId(run.id); window.setTimeout(() => reviewPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }} className="text-xs font-medium text-violet-700 dark:text-violet-300 underline">Review {run.proposal.operations.length} story changes{run.proposal.recommendations.length > 0 ? ` · ${run.proposal.recommendations.length} suggestions` : ''}</button><span className="text-xs capitalize text-slate-500 dark:text-slate-400">{run.status === 'proposed' ? 'Awaiting your review' : run.status}</span></div>}
            </div>
          </article>)}
          {(generate.isPending || generate.isError) && <div className="space-y-3"><p className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-xl bg-violet-100 dark:bg-violet-950 px-4 py-3 text-sm">{generate.variables}</p>{generate.isPending ? <p role="status" className="text-sm text-violet-600 dark:text-violet-300">Thinking about your story…</p> : <div role="alert" className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-300"><p className="font-medium">Couldn’t get an assistant reply</p><p className="mt-1">{errorText(generate.error)}</p><p className="mt-2 text-xs">No story changes were applied. Check your <Link to="/settings" className="underline">model connection in Settings</Link> or retry your message.</p></div>}</div>}
          <div ref={conversationEnd} />
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400"><button type="button" disabled={read.isPending || busy} onClick={() => read.mutate()} className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 disabled:opacity-40">{read.isPending ? 'Reading scenes…' : 'Refresh reader observations'}</button><span>Run the reader before requesting improvements to use its latest findings.</span></div>
      {read.isSuccess && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">Read {read.data.scenes_read} scenes; added {read.data.suggestions_added} observations to the suggestions panel.</p>}
      {read.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(read.error)}</p>}
      {runs.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(runs.error)}</p>}
      {selected && (selected.proposal.operations.length > 0 || selected.proposal.recommendations.length > 0) && <section ref={reviewPanel} aria-label="Review assistant changes" className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Proposed changes</h3><span className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-xs capitalize text-slate-600 dark:text-slate-300">{selected.status}</span></div><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{selected.summary}</p>
        {selected.proposal.assumptions.length > 0 && <div className="rounded-lg bg-amber-50 dark:bg-amber-950 p-3"><h4 className="text-xs font-semibold text-amber-900 dark:text-amber-300">Assumptions to review</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-amber-800 dark:text-amber-300">{selected.proposal.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></div>}
        {selected.proposal.recommendations.map((recommendation, index) => <article key={index} className="rounded-lg border-l-2 border-violet-300 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/40 p-4"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">{recommendation.title}</h4><span className="text-xs capitalize text-violet-600 dark:text-violet-300">{recommendation.priority}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{recommendation.explanation}</p>{recommendation.observation_ids.length > 0 && <ReaderEvidence rows={selected.evidence} ids={recommendation.observation_ids} />}</article>)}
        <details><summary className="cursor-pointer text-sm font-medium">{selected.proposal.operations.length} story changes · inspect details</summary><ol className="mt-3 space-y-3">{selected.proposal.operations.map((operation, index) => <li key={index} className="rounded-md bg-slate-50 dark:bg-slate-950 p-3"><p className="text-xs font-semibold capitalize text-slate-700 dark:text-slate-200">{operation.op} {operation.entity.replaceAll('_', ' ')}{labels.has(operation.ref) ? ` · ${labels.get(operation.ref)}` : ''}</p><dl className="mt-2 space-y-1">{Object.entries(operation.data).filter(([field]) => field !== 'expected_content_hash' && field !== 'expected_field_hash').map(([field, value]) => <div key={field} className="text-xs leading-5"><dt className="inline font-medium capitalize text-slate-500 dark:text-slate-400">{field === 'sort_ordinal' || field === 'story_time_ordinal' ? 'World time' : field === 'sort_key' ? 'Reading order' : field.replace(/_id$/, '').replaceAll('_', ' ')}: </dt><dd className="inline whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">{displayValue(value)}</dd></div>)}</dl></li>)}</ol></details>
        <div className="flex flex-wrap gap-3">{selected.status === 'proposed' && <><button type="button" disabled={busy || !selected.proposal.operations.length} onClick={() => apply.mutate(selected.id)} className="rounded-md bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm text-white dark:text-slate-950 disabled:opacity-40">{apply.isPending ? 'Applying…' : 'Apply changes'}</button><button type="button" disabled={busy || dismiss.isPending} onClick={() => dismiss.mutate(selected.id)} className="text-sm text-slate-500 dark:text-slate-400">Dismiss proposal</button></>}{selected.status === 'applied' && <button type="button" disabled={busy} onClick={() => undo.mutate(selected.id)} className="rounded-md border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm disabled:opacity-40">{undo.isPending ? 'Undoing…' : 'Undo this batch'}</button>}</div>
        {[apply, undo, dismiss].map((mutation, index) => mutation.isError && <p role="alert" key={index} className="text-sm text-red-600 dark:text-red-300">{errorText(mutation.error)}</p>)}
        {selected.status === 'invalid' && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{String(selected.result?.validation_error ?? 'This plan could not be validated.')} No changes were applied. Ask the assistant to revise it.</p>}
        {selected.result && ['applied', 'undone'].includes(selected.status) && <p className="text-xs text-emerald-700 dark:text-emerald-300">{selected.status === 'undone' ? 'This batch was undone.' : `Applied ${String(selected.result.operations_applied)} operations.`}</p>}
        <p className="text-xs text-slate-400">{selected.provider} · {selected.model}{selected.usage.input_tokens !== undefined ? ` · ${selected.usage.input_tokens} input tokens` : ''}{selected.usage.output_tokens !== undefined ? ` · ${selected.usage.output_tokens} output tokens` : ''}</p>
      </section>}
    </div>
  )
}


function ReaderEvidence({ rows, ids }: { rows: AIObservation[]; ids: string[] }) {
  const supporting = rows.filter((row) => ids.includes(row.id))
  return <details className="mt-3"><summary className="cursor-pointer text-xs text-violet-700 dark:text-violet-300">Reader evidence · {supporting.length} observations</summary><ul className="mt-2 space-y-3">{supporting.map((row) => {
    const structure = row.payload.structure as { probability?: number; evidence?: string; elements?: Record<string, number | null> } | null
    const characters = row.payload.characters as { evidence?: string }[] | undefined
    const quotes = [...new Set([structure?.evidence, ...(characters ?? []).map((item) => item.evidence)].filter((value): value is string => typeof value === 'string' && value.length > 0))].slice(0, 3)
    return <li key={row.id} className="rounded-md bg-white/70 dark:bg-slate-900/70 p-3 text-xs leading-5 text-slate-600 dark:text-slate-300"><p className="font-medium">{row.scene_title} · {row.source}</p>{typeof structure?.probability === 'number' && <p>Turning-point probability: {Math.round(structure.probability * 100)}%</p>}{structure?.elements && <p>{Object.entries(structure.elements).filter(([,value]) => typeof value === 'number').map(([name,value]) => `${name} present: ${Math.round((value ?? 0) * 100)}%`).join(' · ')}</p>}{quotes.map((quote,index) => <blockquote key={index} className="mt-2 border-l-2 border-violet-200 dark:border-violet-800 pl-2">{quote}</blockquote>)}<p className="mt-1 text-slate-400">Reader judgments retain their uncertainty.</p></li>
  })}</ul></details>
}
