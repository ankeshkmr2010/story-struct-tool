import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'

// The log records every column; ids and ordering keys mean nothing to a writer.
const TECHNICAL_FIELD = /(^id$|_id$|sort_key)/
const plain = (value: string) => { const text = value.replace(/_/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1) }

export function AuthorshipPanel({ storyId }: { storyId: string }) {
  const history = useQuery({ queryKey: ['authorship', storyId], queryFn: () => api.getAuthorship(storyId) })
  return <div><h2 id="authorship-title" className="text-xl font-semibold">Who changed this story?</h2><p className="writer-help">Changes are attributed to the author, app assistant, or external MCP client. Existing text from before tracking began has unknown authorship; it is not assumed to be yours. Values and provider keys are not stored in this log.</p>{history.isPending && <p>Loading…</p>}{history.isError && <p role="alert">{errorText(history.error)}</p>}{history.data?.length === 0 && <p className="writer-help">No tracked changes yet.</p>}<ul className="authorship-list">{history.data?.filter(entry => !TECHNICAL_FIELD.test(entry.field)).map((entry, index) => <li key={index}><strong>{plain(entry.entity_type)} · {plain(entry.field).toLowerCase()}</strong><span className={`authorship-origin origin-${entry.origin}`}>{entry.actor_label}</span><p>{plain(entry.action)} · {new Date(entry.created_at).toLocaleString()}</p></li>)}</ul></div>
}

export function OriginSummary({ storyId, entityId, entityType }: { storyId: string; entityId: string; entityType: string }) {
  const history = useQuery({ queryKey: ['authorship', storyId], queryFn: () => api.getAuthorship(storyId) })
  const latest = history.data?.find(row => row.entity_id === entityId && row.entity_type === entityType)
  return <p className="field-origin-summary">{latest ? <>Latest tracked edit: <span className={`authorship-origin origin-${latest.origin}`}>{latest.actor_label}</span> · {latest.field}. See History → Who wrote what for every change.</> : 'Authorship unknown until a tracked edit is made.'}</p>
}
