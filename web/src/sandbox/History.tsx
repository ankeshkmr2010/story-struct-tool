import { rows, type Sandbox } from './storage'

export function SandboxHistory({ value }: { value: Sandbox }) {
  return <section><h2 className="level-title">History</h2><p className="writer-help">Your saved writing in this browser.</p><ul className="authorship-list">{value.edits.slice().reverse().map((edit, index) => <li key={index}><strong>{String(rows(value, 'scene').find(scene => scene.id === edit.scene_id)?.title ?? 'Scene')} · prose</strong><span className="authorship-origin origin-author">You</span><p>{new Date(edit.created_at).toLocaleString()}</p><p className="whitespace-pre-wrap">{edit.content}</p></li>)}</ul>{!value.edits.length && <p>No edits yet. Add a line in Write to begin your history.</p>}</section>
}
