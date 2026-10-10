import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AIRun } from '../api/client'
import { errorText } from '../api/errors'

type Operation = AIRun['proposal']['operations'][number]
type StatusFilter = 'pending' | 'applied' | 'closed' | 'all'
type SourceFilter = 'all' | 'agent' | 'assistant'

// No stored flag marks a run as a test, so this is a summary heuristic the author can switch off.
export const isTestRun = (run: AIRun) => /\b(test(ing|s)?|smoke|probe|dry[ -]?run)\b/i.test(run.summary)

const statusGroups: Record<StatusFilter, (status: string) => boolean> = {
  pending: (status) => status === 'proposed',
  applied: (status) => status === 'applied',
  closed: (status) => ['dismissed', 'undone', 'invalid'].includes(status),
  all: () => true,
}
const statusTone: Record<string, string> = {
  proposed: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  applied: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  invalid: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300',
}
const verbs: Record<string, string> = { create: 'Add', update: 'Update', link: 'Connect', unlink: 'Disconnect', write_prose: 'Rewrite prose in', patch_prose: 'Edit passage in', patch_list: 'Edit list in', delete: 'Delete' }
const hidden = new Set(['expected_content_hash', 'expected_field_hash'])
const fieldLabel = (field: string) => field === 'sort_ordinal' || field === 'story_time_ordinal' ? 'World time' : field === 'sort_key' ? 'Reading order' : field.replace(/_id$/, '').replaceAll('_', ' ')

export function ProposalInbox({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const runs = useQuery({ queryKey: ['ai-runs', storyId, 'inbox'], queryFn: () => api.listAIRuns(storyId, undefined, 200) })
  const context = useQuery({ queryKey: ['ai-context', storyId], queryFn: () => api.getAIContext(storyId) })
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [source, setSource] = useState<SourceFilter>('all')
  const [hideTests, setHideTests] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const refresh = () => { void qc.invalidateQueries({ predicate: (query) => query.queryKey.includes(storyId) }); void qc.invalidateQueries({ queryKey: ['stories'] }) }
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'apply' | 'undo' | 'dismiss' }) =>
      action === 'apply' ? api.applyAIRun(storyId, id) : action === 'undo' ? api.undoAIRun(storyId, id) : api.dismissAIRun(storyId, id),
    onSuccess: refresh,
  })

  const labels = new Map<string, string>()
  const rows = new Map<string, Record<string, unknown>>()
  Object.entries(context.data?.entities ?? {}).forEach(([kind, items]) => items.forEach((item) => {
    if (typeof item.id !== 'string') return
    rows.set(item.id, item)
    labels.set(item.id, String(item.name ?? item.title ?? item.label ?? kind.replaceAll('_', ' ')))
  }))

  const all = runs.data ?? []
  const bySource = all.filter((run) => source === 'all' || (source === 'agent') === (run.provider === 'external'))
  const visible = bySource.filter((run) => !hideTests || !isTestRun(run))
  const tests = bySource.length - visible.length
  const shown = visible.filter((run) => statusGroups[status](run.status))
  const count = (key: StatusFilter) => visible.filter((run) => statusGroups[key](run.status)).length

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-2xl font-semibold">Agent changes</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">Every batch an agent or the assistant staged for this story. Apply or dismiss pending batches; undo an applied batch while nothing has changed since.</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {(['pending', 'applied', 'closed', 'all'] as StatusFilter[]).map((key) => (
          <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)} className={`rounded-full border px-3 py-1 text-xs capitalize ${status === key ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-950' : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            {key === 'closed' ? 'Dismissed / undone' : key} · {count(key)}
          </button>
        ))}
        <select aria-label="Change source" value={source} onChange={(event) => setSource(event.target.value as SourceFilter)} className="ml-auto rounded border border-slate-300 bg-white p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
          <option value="all">All sources</option>
          <option value="agent">External agents (MCP)</option>
          <option value="assistant">In-app assistant</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><input type="checkbox" checked={hideTests} onChange={(event) => setHideTests(event.target.checked)} />Hide test runs{tests > 0 ? ` (${tests})` : ''}</label>
      </div>
      {runs.isPending && <p className="text-sm text-slate-500 dark:text-slate-400">Loading changes…</p>}
      {runs.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(runs.error)}</p>}
      {act.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(act.error)}</p>}
      {runs.isSuccess && shown.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{status === 'pending' ? 'Nothing waiting for review.' : 'No batches match these filters.'}</p>}
      <ul className="space-y-3">
        {shown.map((run) => {
          const open = openId === run.id
          const operations = run.proposal.operations
          const created = new Map(operations.filter((operation) => operation.op === 'create').map((operation) => [operation.ref, String(operation.data.name ?? operation.data.title ?? operation.data.label ?? operation.entity.replaceAll('_', ' '))]))
          const label = (value: unknown) => typeof value === 'string' ? labels.get(value) ?? created.get(value) : undefined
          const busy = act.isPending && act.variables?.id === run.id
          return (
            <li key={run.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 capitalize ${statusTone[run.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{run.status === 'proposed' ? 'pending' : run.status}</span>
                <span className="text-slate-500 dark:text-slate-400">{run.provider === 'external' ? 'External agent' : 'Assistant'} · {new Date(run.created_at).toLocaleString()} · {operations.length} change{operations.length === 1 ? '' : 's'}</span>
                {isTestRun(run) && <span className="text-slate-400">· looks like a test</span>}
              </div>
              <p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200 ${open ? '' : 'line-clamp-2'}`}>{run.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {operations.length > 0 && <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : run.id)} className="text-xs font-medium underline">{open ? 'Hide changes' : 'Show changes'}</button>}
                {run.status === 'proposed' && <>
                  <button type="button" disabled={act.isPending || !operations.length} onClick={() => act.mutate({ id: run.id, action: 'apply' })} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950">{busy && act.variables?.action === 'apply' ? 'Applying…' : 'Apply'}</button>
                  <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: run.id, action: 'dismiss' })} className="text-xs text-slate-500 disabled:opacity-40 dark:text-slate-400">Dismiss</button>
                </>}
                {run.status === 'applied' && <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: run.id, action: 'undo' })} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-600">{busy ? 'Undoing…' : 'Undo batch'}</button>}
                {run.status === 'invalid' && <span className="text-xs text-red-700 dark:text-red-300">{String(run.result?.validation_error ?? 'This batch could not be validated.')}</span>}
              </div>
              {open && <>
                {run.proposal.assumptions.length > 0 && <ul className="mt-3 list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-7 text-xs leading-5 text-amber-900 dark:bg-amber-950 dark:text-amber-300">{run.proposal.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul>}
                <ol className="mt-3 space-y-2">{operations.map((operation, index) => <OperationDiff key={index} operation={operation} pending={run.status === 'proposed'} before={rows.get(operation.ref)} title={label(operation.ref)} label={label} />)}</ol>
              </>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function OperationDiff({ operation, pending, before, title, label }: { operation: Operation; pending: boolean; before?: Record<string, unknown>; title?: string; label: (value: unknown) => string | undefined }) {
  const show = (value: unknown) => {
    if (value === null || value === undefined || value === '') return 'Not set'
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'string') return label(value) ?? (value.startsWith('new:') ? value.slice(4).replaceAll('_', ' ') : value)
    return JSON.stringify(value)
  }
  const fields = Object.entries(operation.data).filter(([field]) => !hidden.has(field))
  return (
    <li className="rounded-md bg-slate-50 p-3 text-xs leading-5 dark:bg-slate-950">
      <p className="font-semibold text-slate-700 dark:text-slate-200">{verbs[operation.op] ?? operation.op} {operation.entity.replaceAll('_', ' ')}{title ? ` · ${title}` : ''}</p>
      {operation.op === 'patch_prose' && Array.isArray(operation.data.edits) ? (
        <ul className="mt-2 space-y-2">{(operation.data.edits as { find?: string; text?: string; replace?: string; action?: string }[]).map((edit, index) => (
          <li key={index} className="grid gap-1">
            <span className="text-slate-500 dark:text-slate-400">{edit.action ?? 'replace'}</span>
            <del className="whitespace-pre-wrap break-words rounded bg-red-50 px-2 py-1 text-red-900 dark:bg-red-950 dark:text-red-200">{edit.find}</del>
            {(edit.text ?? edit.replace) ? <ins className="whitespace-pre-wrap break-words rounded bg-emerald-50 px-2 py-1 text-emerald-900 no-underline dark:bg-emerald-950 dark:text-emerald-200">{edit.text ?? edit.replace}</ins> : <span className="text-slate-500">Passage removed</span>}
          </li>
        ))}</ul>
      ) : operation.op !== 'delete' && fields.length > 0 && (
        <dl className="mt-2 space-y-1">{fields.map(([field, value]) => {
          const old = pending && operation.op === 'update' ? before?.[field] : undefined
          const long = typeof value === 'string' && value.length > 120
          return (
            <div key={field}>
              <dt className="inline font-medium capitalize text-slate-500 dark:text-slate-400">{fieldLabel(field)}: </dt>
              <dd className={long ? 'mt-1 space-y-1' : 'inline'}>
                {old !== undefined && <><del className={`whitespace-pre-wrap break-words text-red-800 dark:text-red-300 ${long ? 'block rounded bg-red-50 px-2 py-1 dark:bg-red-950' : ''}`}>{show(old)}</del>{long ? null : ' → '}</>}
                <span className={`whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200 ${long ? 'block rounded bg-white px-2 py-1 dark:bg-slate-900' : ''}`}>{show(value)}</span>
              </dd>
            </div>
          )
        })}</dl>
      )}
    </li>
  )
}
