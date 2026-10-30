import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Character } from '../api/client'
import { errorText } from '../api/errors'
import { Dialog } from '../ui/Dialog'
import { offerRename } from './rename'
import { plural, t, tx } from '../i18n'

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
    [p.pov_scenes, tx('scene POV'), tx('scene POVs')], [p.pov_chapters, tx('chapter POV'), tx('chapter POVs')], [p.mentions, tx('scene appearance'), tx('scene appearances')],
    [p.events, tx('event'), tx('events')], [p.relationships, tx('relationship'), tx('relationships')], [p.arcs, tx('arc'), tx('arcs')], [p.threads, tx('owned thread'), tx('owned threads')], [p.images, tx('reference image'), tx('reference images')],
  ].filter(([count]) => Number(count) > 0).map(([count, one, many]) => `${count} ${t(String(count === 1 ? one : many))}`) : []
  return <>
    <button type="button" className="open-beside-button" title={t('Merge {0} into another character', character.name)} onClick={() => { setOpen(true); setIntoId('') }}>{t('Merge…')}</button>
    <Dialog open={open} onClose={() => { if (!merge.isPending) setOpen(false) }} title={t('Merge {0} into…', character.name)} className="rename-dialog">
      <p className="writer-help">{t('For a duplicate of the same person. Everything that points at {0} moves to the character you choose, {1}’s names become aliases, and {2} is deleted. The story is checkpointed first, so History can undo it.', character.name, character.name, character.name)}</p>
      <label className="draft-compare-against">{t('Keep')}
        <select value={intoId} onChange={event => setIntoId(event.target.value)}>
          <option value="">{t('Choose a character…')}</option>
          {others.map(other => <option key={other.id} value={other.id}>{other.name}</option>)}
        </select>
      </label>
      {intoId && (preview.isPending ? <p className="writer-help">{t('Checking what would move…')}</p>
        : preview.error ? <p role="alert">{errorText(preview.error)}</p>
        : p && into && <div className="merge-preview">
          <p><strong>{p.source_name}</strong> → <strong>{p.target_name}</strong></p>
          <ul>
            <li>{t('Moves: {0}.', lines.length ? lines.join(', ') : t('nothing else points at this character'))}</li>
            {p.relationships_removed > 0 && <li>{t('Removes {0} between them.', p.relationships_removed === 1 ? t('the relationship') : plural(p.relationships_removed, '{0} relationship', '{0} relationships', p.relationships_removed))}</li>}
            <li>{p.aliases_added.length ? t('Adds {0} to {1}’s aliases.', p.aliases_added.map(name => `“${name}”`).join(', '), p.target_name) : t('No new aliases.')}</li>
            <li>{t('Deletes {0}. The prose is not changed; you can update it next.', p.source_name)}</li>
          </ul>
        </div>)}
      <div className="rename-actions">
        <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setOpen(false)}>{t('Cancel')}</button>
        <button type="button" className="ui-btn ui-btn-primary" disabled={!p || merge.isPending} onClick={() => merge.mutate()}>{merge.isPending ? t('Merging…') : into ? t('Merge into {0}', into.name) : t('Merge')}</button>
      </div>
      {merge.error && <p role="alert" className="writer-error">{errorText(merge.error)}</p>}
    </Dialog>
  </>
}
