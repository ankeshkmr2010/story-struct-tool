import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'

export function AuthorshipPanel({ storyId }: { storyId: string }) {
  const history = useQuery({ queryKey: ['authorship', storyId], queryFn: () => api.getAuthorship(storyId) })
  return <div><h2 id="authorship-title" className="text-xl font-semibold">Who changed this story?</h2><p className="writer-help">Changes are attributed to the author, app assistant, or external MCP client. Existing text from before tracking began has unknown authorship; it is not assumed to be yours. Values and provider keys are not stored in this log.</p>{history.isPending && <p>Loading…</p>}{history.isError && <p role="alert">{errorText(history.error)}</p>}{history.data?.length === 0 && <p className="writer-help">No tracked changes yet.</p>}<ul className="authorship-list">{history.data?.map((entry, index) => <li key={index}><strong>{entry.entity_type} · {entry.field}</strong><span className={`authorship-origin origin-${entry.origin}`}>{entry.actor_label}</span><p>{entry.action} · {new Date(entry.created_at).toLocaleString()}</p><small>{entry.entity_id}</small></li>)}</ul></div>
}

export function OriginSummary({ storyId, entityId, entityType }: { storyId: string; entityId: string; entityType: string }) {
  const history = useQuery({ queryKey: ['authorship', storyId], queryFn: () => api.getAuthorship(storyId) })
  const latest = history.data?.find(row => row.entity_id === entityId && row.entity_type === entityType)
  return <p className="field-origin-summary">{latest ? <>Latest tracked edit: <span className={`authorship-origin origin-${latest.origin}`}>{latest.actor_label}</span> · {latest.field}. See Authorship for individual fields.</> : 'Authorship unknown until a tracked edit is made.'}</p>
}
