import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'

export function EventDelete({ storyId, eventId, title, onDeleted }: { storyId: string; eventId: string; title: string; onDeleted: () => void }) {
  const qc = useQueryClient()
  const remove = useMutation({ mutationFn: () => api.deleteEvent(storyId, eventId), onSuccess: () => { void qc.invalidateQueries({ predicate: query => query.queryKey.includes(storyId) }); onDeleted() } })
  return <div><button type="button" disabled={remove.isPending} className="scene-delete-button" onClick={() => { if (window.confirm(t('Delete timeline event “{0}”? Its linked scene is kept. A recovery version is saved first.', title))) remove.mutate() }}>{remove.isPending ? t('Deleting…') : t('Delete event')}</button>{remove.isError && <p role="alert" className="writer-help">{errorText(remove.error)}</p>}</div>
}
