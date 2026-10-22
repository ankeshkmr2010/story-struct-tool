import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Character } from '../api/client'
import { errorText } from '../api/errors'
import { Dialog } from '../ui/Dialog'
import { offerRename } from './rename'

/**
 * Merge a duplicate character into another. Nothing changes until the author has read the
 * preview of what moves and confirmed; afterwards the usual rename offer can update the prose.
 */
export function MergeCharacter({ storyId, character, characters }: { storyId: string; character: Character; characters: Character[] }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [intoId, setIntoId] = useState('')
  const others = characters.filter(other => other.id !== character.id)
  const into = others.find(other => other.id === intoId)
  const preview = useQuery({ queryKey: ['merge-preview', storyId, character.id, intoId], queryFn: () => api.mergePreview(storyId, character.id, intoId), enabled: open && !!intoId, staleTime: 0 })
  const merge = useMutation({
    mutationFn: () => api.mergeCharacter(storyId, character.id, intoId),
    onSuccess: summary => {
      setOpen(false)
      void qc.invalidateQueries({ predicate: query => query.queryKey.includes(storyId) })
      offerRename({ kind: 'character', id: summary.target_id, from: summary.source_name, to: summary.target_name })
    },
  })
  if (!others.length) return null
  const p = preview.data
  const lines = p ? [
    [p.pov_scenes, 'scene POV', 'scene POVs'], [p.pov_chapters, 'chapter POV', 'chapter POVs'], [p.mentions, 'scene appearance', 'scene appearances'],
    [p.events, 'event', 'events'], [p.relationships, 'relationship', 'relationships'], [p.arcs, 'arc', 'arcs'], [p.threads, 'owned thread', 'owned threads'], [p.images, 'reference image', 'reference images'],
  ].filter(([count]) => Number(count) > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`) : []
  return <>
    <button type="button" className="open-beside-button" title={`Merge ${character.name} into another character`} onClick={() => { setOpen(true); setIntoId('') }}>Merge…</button>
    <Dialog open={open} onClose={() => { if (!merge.isPending) setOpen(false) }} title={`Merge ${character.name} into…`} className="rename-dialog">
      <p className="writer-help">For a duplicate of the same person. Everything that points at {character.name} moves to the character you choose, {character.name}’s names become aliases, and {character.name} is deleted. The story is checkpointed first, so History can undo it.</p>
      <label className="draft-compare-against">Keep
        <select value={intoId} onChange={event => setIntoId(event.target.value)}>
          <option value="">Choose a character…</option>
          {others.map(other => <option key={other.id} value={other.id}>{other.name}</option>)}
        </select>
      </label>
      {intoId && (preview.isPending ? <p className="writer-help">Checking what would move…</p>
        : preview.error ? <p role="alert">{errorText(preview.error)}</p>
        : p && into && <div className="merge-preview">
          <p><strong>{p.source_name}</strong> → <strong>{p.target_name}</strong></p>
          <ul>
            <li>Moves: {lines.length ? lines.join(', ') : 'nothing else points at this character'}.</li>
            {p.relationships_removed > 0 && <li>Removes {p.relationships_removed === 1 ? 'the relationship' : `${p.relationships_removed} relationships`} between them.</li>}
            <li>{p.aliases_added.length ? `Adds ${p.aliases_added.map(name => `“${name}”`).join(', ')} to ${p.target_name}’s aliases.` : 'No new aliases.'}</li>
            <li>Deletes {p.source_name}. The prose is not changed; you can update it next.</li>
          </ul>
        </div>)}
      <div className="rename-actions">
        <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="ui-btn ui-btn-primary" disabled={!p || merge.isPending} onClick={() => merge.mutate()}>{merge.isPending ? 'Merging…' : into ? `Merge into ${into.name}` : 'Merge'}</button>
      </div>
      {merge.error && <p role="alert" className="writer-error">{errorText(merge.error)}</p>}
    </Dialog>
  </>
}
