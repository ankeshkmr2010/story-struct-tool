import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Scene } from '../api/client'
import { orderScenes } from '../api/ordering'
import { InlineSelect, InlineText } from './fields'

const STATUSES = ['placeholder', 'outlined', 'drafted', 'revised']
const DRAMA_KEY = (storyId: string) => `story-grid-drama:${storyId}`

function readDrama(storyId: string) {
  try { return localStorage.getItem(DRAMA_KEY(storyId)) !== 'hidden' } catch { return true }
}

function Shift({ scene }: { scene: Scene }) {
  const from = scene.emotional_value_from?.trim()
  const to = scene.emotional_value_to?.trim()
  if (!from && !to) return null
  const flat = Boolean(from && to && from.toLowerCase() === to.toLowerCase())
  return <span title={flat ? 'Value does not change in this scene' : undefined} className={`mt-1 inline-block rounded-full px-2 text-[11px] ${flat ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{from || '?'} → {to || '?'}{flat ? ' · no shift' : ''}</span>
}

function Plain({ text }: { text: string | null | undefined }) {
  return text?.trim()
    ? <span title={text} className="line-clamp-2 text-slate-700 dark:text-slate-300">{text}</span>
    : <span className="text-slate-300 dark:text-slate-600">—</span>
}

const name = (options: { value: string; label: string }[], id: string | null | undefined) => options.find((option) => option.value === id)?.label ?? null

export function StoryGrid({ storyId, onOpenScene }: { storyId: string; onOpenScene: (scene: Scene) => void }) {
  const qc = useQueryClient()
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId) })
  const locations = useQuery({ queryKey: ['locations', storyId], queryFn: () => api.listLocations(storyId) })
  const [status, setStatus] = useState('')
  const [pov, setPov] = useState('')
  const [noShift, setNoShift] = useState(false)
  const [drama, setDrama] = useState(() => readDrama(storyId))
  const [editing, setEditing] = useState<string | null>(null)

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateScene(storyId, id, body),
    onSuccess: () => {
      for (const key of ['scenes', 'brief', 'health', 'ladder', 'continuity', 'location-usage', 'progress', 'suggestions', 'timeline']) {
        void qc.invalidateQueries({ queryKey: [key, storyId] })
      }
    },
  })
  const save = (id: string, field: string) => (value: string | number | null) => update.mutateAsync({ id, body: { [field]: value } })
  const toggleDrama = () => {
    const next = !drama
    setDrama(next)
    try { localStorage.setItem(DRAMA_KEY(storyId), next ? 'shown' : 'hidden') } catch { /* per-viewer convenience only */ }
  }

  const all = scenes.data ?? []
  const visible = all.filter((scene) =>
    (!status || scene.status === status)
    && (!pov || (pov === 'none' ? !scene.pov_character_id : scene.pov_character_id === pov))
    && (!noShift || !scene.emotional_value_from?.trim() || !scene.emotional_value_to?.trim()
      || scene.emotional_value_from.trim().toLowerCase() === scene.emotional_value_to.trim().toLowerCase()))
  const groups = [
    ...(chapters.data ?? []).map((chapter) => ({ id: chapter.id, label: `${chapter.number}. ${chapter.title ?? 'Untitled'}` })),
    { id: null as string | null, label: 'Unfiled scenes' },
  ].map((group) => ({ ...group, scenes: orderScenes(visible.filter((scene) => (scene.chapter_id ?? null) === group.id)) }))
    .filter((group) => group.scenes.length > 0)
  const characterOptions = (characters.data ?? []).map((character) => ({ value: character.id, label: character.name }))
  const locationOptions = (locations.data ?? []).map((location) => ({ value: location.id, label: location.name }))
  const words = visible.reduce((sum, scene) => sum + (scene.word_count ?? 0), 0)
  const byStatus = STATUSES.map((name) => `${visible.filter((scene) => scene.status === name).length} ${name}`).join(' · ')
  const columns = drama ? 10 : 7
  const filter = 'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-700 dark:text-slate-200'
  let index = 0

  return (
    <div className="min-w-0">
      <p className="eyebrow">STORY GRID</p>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Every scene at a glance</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Click a row to edit it. Click a title to open the scene.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)} className={filter}>
          <option value="">All statuses</option>
          {STATUSES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select aria-label="Filter by POV" value={pov} onChange={(event) => setPov(event.target.value)} className={filter}>
          <option value="">All POVs</option>
          <option value="none">No POV set</option>
          {characterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={noShift} onChange={(event) => setNoShift(event.target.checked)} />Missing or flat value shift</label>
        <button type="button" onClick={toggleDrama} className="workspace-shortcut rounded-md px-2 py-1 text-sm">{drama ? 'Hide' : 'Show'} goal / conflict / outcome</button>
      </div>
      {scenes.isLoading && <p className="mt-4 text-sm text-slate-500">Loading scenes…</p>}
      {scenes.data && all.length === 0 && <p className="mt-4 text-sm text-slate-500">No scenes yet.</p>}
      {all.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className={`w-full table-fixed border-collapse text-left text-sm ${drama ? 'min-w-[1300px]' : 'min-w-[860px]'}`}>
            <colgroup>
              <col className="w-8" /><col className="w-44" /><col className="w-24" /><col className="w-28" /><col className="w-36" /><col className="w-24" />
              {drama && <><col /><col /><col /></>}
              <col className="w-32" /><col className="w-16" />
            </colgroup>
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 dark:bg-slate-950">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Scene</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">POV</th>
                <th className="px-2 py-2">Place</th>
                <th className="px-2 py-2">Time</th>
                {drama && <><th className="px-2 py-2">Goal</th><th className="px-2 py-2">Conflict</th><th className="px-2 py-2">Outcome</th></>}
                <th className="px-2 py-2">Value shift</th>
                <th className="px-2 py-2 text-right">Words</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => [
                <tr key={`group-${group.id ?? 'unfiled'}`} className="bg-slate-100/70 dark:bg-slate-800/60">
                  <th colSpan={columns + 1} className="px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{group.label}</th>
                </tr>,
                ...group.scenes.map((scene) => editing !== scene.id ? (
                  <tr key={scene.id} onClick={() => setEditing(scene.id)} title="Click to edit this row" className="cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                    <td className="px-2 py-2 text-xs text-slate-400">{++index}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={(event) => { event.stopPropagation(); onOpenScene(scene) }} className="text-left font-medium text-slate-800 hover:underline dark:text-slate-100">{scene.title || 'Untitled scene'}</button>
                      {scene.is_flashback && <span className="ml-1 rounded bg-indigo-100 px-1 text-[10px] text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">flashback</span>}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">{scene.status}</td>
                    <td className="px-2 py-2"><Plain text={name(characterOptions, scene.pov_character_id)} /></td>
                    <td className="px-2 py-2"><Plain text={name(locationOptions, scene.location_id)} /></td>
                    <td className="px-2 py-2"><Plain text={scene.time_label} /></td>
                    {drama && <>
                      <td className="px-2 py-2"><Plain text={scene.goal} /></td>
                      <td className="px-2 py-2"><Plain text={scene.conflict} /></td>
                      <td className="px-2 py-2"><Plain text={scene.outcome} /></td>
                    </>}
                    <td className="px-2 py-2"><Shift scene={scene} /></td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-500">{scene.word_count ?? 0}</td>
                  </tr>
                ) : (
                  <tr key={scene.id} className="border-t border-slate-100 bg-slate-50 align-top dark:border-slate-800 dark:bg-slate-800/40 [&_select]:w-full [&_select]:max-w-full">
                    <td className="px-2 py-2 text-xs text-slate-400">{++index}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onOpenScene(scene)} className="text-left font-medium text-slate-800 hover:underline dark:text-slate-100">{scene.title || 'Untitled scene'}</button>
                      <button type="button" onClick={() => setEditing(null)} className="workspace-shortcut mt-2 block rounded px-2 text-xs">Done</button>
                    </td>
                    <td className="px-2 py-2"><InlineSelect value={scene.status} options={STATUSES} onSave={save(scene.id, 'status')} /></td>
                    <td className="px-2 py-2"><InlineSelect value={scene.pov_character_id} options={characterOptions} onSave={save(scene.id, 'pov_character_id')} /></td>
                    <td className="px-2 py-2"><InlineSelect value={scene.location_id} options={locationOptions} onSave={save(scene.id, 'location_id')} /></td>
                    <td className="px-2 py-2"><InlineText value={scene.time_label} placeholder="—" onSave={save(scene.id, 'time_label')} /></td>
                    {drama && <>
                      <td className="px-2 py-2"><InlineText value={scene.goal} placeholder="—" multiline onSave={save(scene.id, 'goal')} /></td>
                      <td className="px-2 py-2"><InlineText value={scene.conflict} placeholder="—" multiline onSave={save(scene.id, 'conflict')} /></td>
                      <td className="px-2 py-2"><InlineText value={scene.outcome} placeholder="—" multiline onSave={save(scene.id, 'outcome')} /></td>
                    </>}
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-1">
                        <InlineText value={scene.emotional_value_from} placeholder="from" onSave={save(scene.id, 'emotional_value_from')} />
                        <InlineText value={scene.emotional_value_to} placeholder="to" onSave={save(scene.id, 'emotional_value_to')} />
                      </div>
                      <Shift scene={scene} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-500">{scene.word_count ?? 0}</td>
                  </tr>
                )),
              ])}
            </tbody>
            <tfoot className="border-t border-slate-200 text-xs text-slate-500 dark:border-slate-700">
              <tr>
                <td colSpan={columns} className="px-2 py-2">{visible.length} of {all.length} scenes · {byStatus}</td>
                <td className="px-2 py-2 text-right tabular-nums">{words}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {update.isError && <p className="mt-2 text-sm text-red-600">Could not save: {(update.error as Error).message}</p>}
    </div>
  )
}
