import { rows, type Sandbox } from './storage'

export function SandboxHistory({ value }: { value: Sandbox }) {
  return <section><h2 className="level-title">History</h2><p className="writer-help">Your saved writing in this browser.</p><ul className="authorship-list">{value.edits.slice().reverse().map((edit, index) => <li key={index}><strong>{String(rows(value, 'scene').find(scene => scene.id === edit.scene_id)?.title ?? 'Scene')} · prose</strong><span className="authorship-origin origin-author">You</span><p>{new Date(edit.created_at).toLocaleString()}</p><SandboxEdit content={edit.content} previous={value.edits.slice(0, value.edits.length - 1 - index).reverse().find(item => item.scene_id === edit.scene_id)?.content} /></li>)}</ul>{!value.edits.length && <p>No edits yet. Add a line in Write to begin your history.</p>}</section>
}

// Show what the visitor added rather than the whole scene; the full text stays one click away.
function SandboxEdit({ content, previous }: { content: string; previous?: string }) {
  let start = 0
  if (previous) while (start < previous.length && start < content.length && previous[start] === content[start]) start++
  else start = Math.max(0, content.lastIndexOf('\n\n') + 2)
  const added = content.slice(start).trim()
  return <>
    <p className="sandbox-edit-added">{start > 0 ? '… ' : ''}{added || 'Text removed or rearranged.'}</p>
    <details className="mt-1 text-xs"><summary className="cursor-pointer">Full scene text</summary><p className="whitespace-pre-wrap">{content}</p></details>
  </>
}
