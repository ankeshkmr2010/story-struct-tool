import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'

export function EventDelete({ storyId, eventId, title, onDeleted }: { storyId: string; eventId: string; title: string; onDeleted: () => void }) {
  const qc = useQueryClient()
  const remove = useMutation({ mutationFn: () => api.deleteEvent(storyId, eventId), onSuccess: () => { void qc.invalidateQueries({ predicate: query => query.queryKey.includes(storyId) }); onDeleted() } })
  return <div><button type="button" disabled={remove.isPending} className="scene-delete-button" onClick={() => { if (window.confirm(`Delete timeline event “${title}”? Its linked scene is kept. A recovery version is saved first.`)) remove.mutate() }}>{remove.isPending ? 'Deleting…' : 'Delete event'}</button>{remove.isError && <p role="alert" className="writer-help">{errorText(remove.error)}</p>}</div>
}
