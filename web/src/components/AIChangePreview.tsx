import type { AIRun } from '../api/client'

type Entities = Record<string, Record<string, unknown>[]>

export function AIChangePreview({ run, entities = {} }: { run: AIRun; entities?: Entities }) {
  const operations = run.proposal.operations
  const labels = new Map<string, string>()
  const rows = new Map<string, Record<string, unknown>>()
  Object.entries(entities).forEach(([kind, items]) => items.forEach((item) => {
    if (typeof item.id !== 'string') return
    rows.set(item.id, item)
    labels.set(item.id, String(item.name ?? item.title ?? item.label ?? kind.replaceAll('_', ' ')))
  }))
  operations.forEach((operation) => {
    const title = operation.data.name ?? operation.data.title ?? operation.data.label
    if (operation.op === 'create' && typeof title === 'string') labels.set(operation.ref, title)
  })
  const short = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return 'Not set'
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    const text = String(value)
    if (labels.has(text)) return labels.get(text)!
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text)) return 'Story item'
    return text.length > 100 ? text.slice(0, 97) + '…' : text
  }
  const validationError = run.result?.validation_error
  if (operations.length === 0) return <p className="mt-3 text-xs text-slate-400">Reply only · no story changes</p>
  return (
    <div className="mt-3 rounded-lg border border-violet-100 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/50 p-3" aria-label="Short change preview">
      <p className="text-xs font-semibold text-violet-900 dark:text-violet-300">{run.status === 'applied' ? 'Changes applied' : run.status === 'undone' ? 'Changes undone' : run.status === 'invalid' ? 'Changes could not be applied' : run.status === 'dismissed' ? 'Changes dismissed' : 'Proposed changes · not applied'}</p>
      {typeof validationError === 'string' && <p className="mt-2 text-xs leading-5 text-red-700 dark:text-red-300">{validationError} Ask the assistant to revise this plan.</p>}
      <ul className="mt-2 space-y-2">
        {operations.slice(0, 4).map((operation, index) => {
          const title = labels.get(operation.ref) ?? operation.entity.replaceAll('_', ' ')
          const name = operation.entity.replaceAll('_', ' ')
          const verbs = run.status === 'applied' ? { create: 'Added', update: 'Updated', link: 'Connected', unlink: 'Disconnected', write_prose: 'Rewrote prose in' } : { create: 'Add', update: 'Update', link: 'Connect', unlink: 'Disconnect', write_prose: 'Rewrite prose in' }
          const verb = verbs[operation.op]
          const changes = Object.entries(operation.data).filter(([field]) => !['name', 'title', 'label', 'from_id', 'to_id', 'expected_content_hash'].includes(field)).slice(0, 2)
          return <li key={index} className="text-xs leading-5 text-slate-700 dark:text-slate-200">
            <p className="font-medium">{verb} {name}{title !== name ? `: ${title}` : ''}{operation.op === 'link' || operation.op === 'unlink' ? ` · ${short(operation.data.from_id)} → ${short(operation.data.to_id)}` : ''}</p>
            {changes.length > 0 && <p className="break-words text-slate-500 dark:text-slate-400">{changes.map(([field, value]) => {
              const before = rows.get(operation.ref)?.[field]
              const label = field === 'sort_ordinal' || field === 'story_time_ordinal' ? 'World time' : field === 'sort_key' ? 'Reading order' : field.replace(/_id$/, '').replaceAll('_', ' ')
              return `${label}: ${run.status === 'proposed' && operation.op === 'update' ? short(before) + ' → ' : ''}${short(value)}`
            }).join(' · ')}</p>}
          </li>
        })}
      </ul>
      {operations.length > 4 && <p className="mt-2 text-xs text-violet-700 dark:text-violet-300">+ {operations.length - 4} more changes in the full review</p>}
    </div>
  )
}
