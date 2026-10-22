import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { Dialog } from '../ui/Dialog'
import { applyPassageEdits } from './passageEdits'
import { OFFER_RENAME_EVENT, type Rename } from './rename'


/**
 * After a character or place is renamed, list every use of the old name in the prose and
 * replace the ones the author keeps ticked, as verified edits with a snapshot per scene.
 * Shows nothing when the old name does not appear.
 */
export function RenameDialog({ storyId, beforeEdit }: { storyId: string; beforeEdit: () => Promise<boolean> }) {
  const qc = useQueryClient()
  const [rename, setRename] = useState<Rename | null>(null)
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [keepAlias, setKeepAlias] = useState(false)
  useEffect(() => {
    const offer = (event: Event) => { setRename((event as CustomEvent<Rename>).detail); setSkipped(new Set()); setKeepAlias(false) }
    window.addEventListener(OFFER_RENAME_EVENT, offer)
    return () => window.removeEventListener(OFFER_RENAME_EVENT, offer)
  }, [])
  const uses = useQuery({ queryKey: ['name-uses', storyId, rename?.from, rename?.to], queryFn: () => api.nameUses(storyId, rename!.from, rename!.to), enabled: rename !== null, staleTime: 0 })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId), enabled: rename !== null })
  const list = uses.data?.uses ?? []
  const groups = [...new Set(list.map(use => `${use.passage.find} → ${use.replacement}`))]
  const kept = list.filter((_, index) => !skipped.has(index))

  const apply = useMutation({
    mutationFn: async () => {
      if (!rename) return
      const { stale } = await applyPassageEdits(storyId, kept.map(use => ({ passage: use.passage, replacement: use.replacement })), beforeEdit, `Rename ${rename.from} → ${rename.to}`)
      if (keepAlias && rename.kind === 'character') {
        const character = (await api.listCharacters(storyId)).find(item => item.id === rename.id)
        if (character && !(character.aliases ?? []).includes(rename.from)) await api.updateCharacter(storyId, character.id, { aliases: [...(character.aliases ?? []), rename.from] })
      } else if (keepAlias && rename.kind === 'glossary_entry') {
        const entry = (await api.listGlossary(storyId)).find(item => item.id === rename.id)
        if (entry && !(entry.aliases ?? []).includes(rename.from)) await api.updateGlossaryEntry(storyId, entry.id, { aliases: [...(entry.aliases ?? []), rename.from] })
      }
      await Promise.all(['content', 'characters', 'glossary', 'placeholders', 'scenes', 'progress'].map(key => qc.invalidateQueries({ queryKey: [key, storyId] })))
      if (stale) throw new Error(`${stale} ${stale === 1 ? 'use' : 'uses'} changed since this list loaded and ${stale === 1 ? 'was' : 'were'} left alone.`)
    },
    onSuccess: () => setRename(null),
  })

  const open = rename !== null && (uses.isPending || uses.isError || list.length > 0)
  const close = () => { if (!apply.isPending) setRename(null) }
  const toggle = (indexes: number[], on: boolean) => setSkipped(current => { const next = new Set(current); for (const index of indexes) { if (on) next.delete(index); else next.add(index) } return next })
  const title = (sceneId: string) => scenes.data?.find(scene => scene.id === sceneId)?.title || 'Untitled scene'

  return <Dialog open={open} onClose={close} title={rename ? `Update the prose: ${rename.from} → ${rename.to}` : 'Update the prose'} className="rename-dialog">
    {uses.isPending ? <p className="writer-help">Looking for “{rename?.from}” in the prose…</p>
      : uses.isError ? <p role="alert">{errorText(uses.error)}</p>
      : rename && <>
        <p className="writer-help">The {rename.kind === 'character' ? 'character' : rename.kind === 'location' ? 'place' : 'glossary term'} is renamed. “{rename.from}” still appears {list.length} {list.length === 1 ? 'time' : 'times'} in {new Set(list.map(use => use.passage.scene_id)).size} {new Set(list.map(use => use.passage.scene_id)).size === 1 ? 'scene' : 'scenes'}. Untick any to leave as written; each changed scene is snapshotted first.</p>
        {groups.map(group => {
          const indexes = list.flatMap((use, index) => `${use.passage.find} → ${use.replacement}` === group ? [index] : [])
          const all = indexes.every(index => !skipped.has(index))
          return <section key={group} className="rename-group">
            <label className="rename-group-head"><input type="checkbox" checked={all} onChange={event => toggle(indexes, event.target.checked)} /> <strong>{group}</strong> <span>({indexes.length}{list[indexes[0]].group === 'part' ? ', on its own' : ''})</span></label>
            <ul>{indexes.map(index => <li key={index}><label><input type="checkbox" checked={!skipped.has(index)} onChange={event => toggle([index], event.target.checked)} /> <span className="rename-scene">{title(list[index].passage.scene_id)}</span> {list[index].passage.excerpt}</label></li>)}</ul>
          </section>
        })}
        {rename.kind !== 'location' && <label className="rename-alias"><input type="checkbox" checked={keepAlias} onChange={event => setKeepAlias(event.target.checked)} /> Keep “{rename.from}” as an alias{rename.kind === 'character' ? ' (some characters may still call them that)' : ''}</label>}
        <div className="rename-actions">
          <button type="button" className="ui-btn ui-btn-ghost" onClick={close}>Leave the prose as it is</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={!kept.length || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? 'Replacing…' : `Replace ${kept.length}`}</button>
        </div>
        {apply.error && <p role="alert" className="writer-error">{errorText(apply.error)}</p>}
      </>}
  </Dialog>
}
