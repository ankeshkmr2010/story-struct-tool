import type { AIRun } from '../api/client'
import { t } from '../i18n'

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
    if (value === null || value === undefined || value === '') return t('Not set')
    if (typeof value === 'boolean') return value ? t('Yes') : t('No')
    const text = String(value)
    if (labels.has(text)) return labels.get(text)!
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text)) return t('Story item')
    return text.length > 100 ? text.slice(0, 97) + '…' : text
  }
  const validationError = run.result?.validation_error
  if (operations.length === 0) return <p className="mt-3 text-xs text-slate-400">{t('Reply only · no story changes')}</p>
  return (
    <div className="mt-3 rounded-lg border border-violet-100 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/50 p-3" aria-label={t('Short change preview')}>
      <p className="text-xs font-semibold text-violet-900 dark:text-violet-300">{run.status === 'applied' ? t('Changes applied') : run.status === 'undone' ? t('Changes undone') : run.status === 'invalid' ? t('Changes could not be applied') : run.status === 'dismissed' ? t('Changes dismissed') : t('Proposed changes · not applied')}</p>
      {typeof validationError === 'string' && <p className="mt-2 text-xs leading-5 text-red-700 dark:text-red-300">{t('{0} Ask the assistant to revise this plan.', validationError)}</p>}
      <ul className="mt-2 space-y-2">
        {operations.slice(0, 4).map((operation, index) => {
          const title = labels.get(operation.ref) ?? operation.entity.replaceAll('_', ' ')
          const name = operation.entity.replaceAll('_', ' ')
          const verbs: Record<string, string> = run.status === 'applied' ? { create: t('Added'), update: t('Updated'), link: t('Connected'), unlink: t('Disconnected'), write_prose: t('Rewrote prose in'), patch_prose: t('Edited passage in'), patch_list: t('Edited list in'), delete: t('Deleted') } : { create: t('Add'), update: t('Update'), link: t('Connect'), unlink: t('Disconnect'), write_prose: t('Rewrite prose in'), patch_prose: t('Edit passage in'), patch_list: t('Edit list in'), delete: t('Delete') }
          const verb = verbs[operation.op]
          const changes = Object.entries(operation.data).filter(([field]) => !['name', 'title', 'label', 'from_id', 'to_id', 'expected_content_hash', 'expected_field_hash'].includes(field)).slice(0, 2)
          return <li key={index} className="text-xs leading-5 text-slate-700 dark:text-slate-200">
            <p className="font-medium">{verb} {name}{title !== name ? `: ${title}` : ''}{operation.op === 'link' || operation.op === 'unlink' ? ` · ${short(operation.data.from_id)} → ${short(operation.data.to_id)}` : ''}</p>
            {changes.length > 0 && <p className="break-words text-slate-500 dark:text-slate-400">{changes.map(([field, value]) => {
              if (field === 'edits' && Array.isArray(value)) return value.slice(0, 2).map(edit => {
                const action = edit.action ?? 'replace'
                if (operation.op === 'patch_prose') return `${action}: “${short(edit.find)}” → ${(edit.text ?? edit.replace) === '' ? 'delete passage' : `“${short(edit.text ?? edit.replace)}”`}`
                return `${action}${edit.index == null ? '' : ` item ${edit.index + 1}`}: ${edit.expected_value == null ? '' : short(edit.expected_value) + ' → '}${action === 'remove' ? 'remove item' : action === 'move' ? `position ${Number(edit.to_index) + 1}` : short(edit.value)}`
              }).join(' · ')
              const before = rows.get(operation.ref)?.[field]
              const label = field === 'sort_ordinal' || field === 'story_time_ordinal' ? t('World time') : field === 'sort_key' ? t('Reading order') : field.replace(/_id$/, '').replaceAll('_', ' ')
              return `${label}: ${run.status === 'proposed' && operation.op === 'update' ? short(before) + ' → ' : ''}${short(value)}`
            }).join(' · ')}</p>}
          </li>
        })}
      </ul>
      {operations.length > 4 && <p className="mt-2 text-xs text-violet-700 dark:text-violet-300">{t('+ {0} more changes in the full review', operations.length - 4)}</p>}
    </div>
  )
}
