import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CharacterState, type MisbeliefStage, type WantStage } from '../api/client'
import { errorText } from '../api/errors'
import { isLocalStory } from '../sandbox/storage'
import { InlineSelect, InlineText } from './fields'
import { t, tx } from '../i18n'

const MISBELIEF: { value: MisbeliefStage; label: string }[] = [
  { value: 'holds', label: tx('Holds the misbelief') },
  { value: 'doubts', label: tx('Doubts it') },
  { value: 'tested', label: tx('Tested') },
  { value: 'lets_go', label: tx('Lets go') },
  { value: 'relapses', label: tx('Relapses') },
]
const WANT: { value: WantStage; label: string }[] = [
  { value: 'pursued', label: tx('Pursued') },
  { value: 'blocked', label: tx('Blocked') },
  { value: 'won', label: tx('Won') },
  { value: 'given_up', label: tx('Given up') },
]

/**
 * A character's arc laid along the scenes, in reading order: where their misbelief stands and how
 * their want is going in each scene they appear in (or have a state for). Check my story →
 * Character arcs reads the accepted states; an agent's states wait here for Accept or Remove.
 */
export function CharacterScenes({ storyId, characterId }: { storyId: string; characterId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [extra, setExtra] = useState<string[]>([])
  const data = useQuery({ queryKey: ['character-states', storyId], queryFn: () => api.listCharacterStates(storyId), enabled: open })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['character-states', storyId] })
    void qc.invalidateQueries({ queryKey: ['evaluators', storyId] })
  }
  const save = useMutation({
    mutationFn: (body: { scene_id: string; misbelief: MisbeliefStage | null; want: WantStage | null; note: string | null }) =>
      api.setCharacterState(storyId, { ...body, character_id: characterId }),
    onSuccess: refresh,
  })
  const accept = useMutation({ mutationFn: (id: string) => api.acceptCharacterState(storyId, id), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteCharacterState(storyId, id), onSuccess: refresh })
  if (isLocalStory(storyId)) return null

  const states = new Map((data.data?.states ?? []).filter(s => s.character_id === characterId).map(s => [s.scene_id, s]))
  const scenes = (data.data?.scenes ?? []).filter(s => s.characters.includes(characterId) || states.has(s.id) || extra.includes(s.id))
  const others = (data.data?.scenes ?? []).filter(s => !scenes.includes(s))
  const recorded = [...states.values()].filter(s => s.status === 'active').length
  const change = (sceneId: string, state: CharacterState | undefined, field: 'misbelief' | 'want' | 'note') => (value: string | null) =>
    save.mutateAsync({
      scene_id: sceneId,
      misbelief: state?.misbelief ?? null,
      want: state?.want ?? null,
      note: state?.note ?? null,
      [field]: value,
    } as { scene_id: string; misbelief: MisbeliefStage | null; want: WantStage | null; note: string | null })

  return (
    <details className="mt-1.5" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-400">{data.data ? t('Scene by scene ({0})', recorded) : t('Scene by scene')}</summary>
      <div className="mt-1 space-y-1">
        <p className="writer-help">{t('Where their misbelief stands and how their want is going in each scene. Check my story → Character arcs reads these.')}</p>
        {[data.error, save.error, accept.error, remove.error].filter(Boolean).slice(0, 1).map((error, index) => <p key={index} role="alert" className="text-sm text-rose-700 dark:text-rose-300">{errorText(error)}</p>)}
        {data.data && scenes.length === 0 && <p className="writer-help">{t('They are not in a placed scene yet. Add a scene below.')}</p>}
        <ol className="space-y-1">
          {scenes.map(scene => {
            const state = states.get(scene.id)
            const suggested = state?.status === 'suggested'
            return (
              <li key={scene.id} className={`rounded p-1 ${suggested ? 'border border-dashed border-sky-400 dark:border-sky-700' : 'bg-slate-50 dark:bg-slate-950'}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="min-w-[8rem] flex-1 truncate text-xs">{scene.title}</span>
                  <InlineSelect value={state?.misbelief ?? null} options={MISBELIEF.map(o => ({ ...o, label: t(o.label) }))} onSave={change(scene.id, state, 'misbelief')} placeholder={t('— misbelief —')} />
                  <InlineSelect value={state?.want ?? null} options={WANT.map(o => ({ ...o, label: t(o.label) }))} onSave={change(scene.id, state, 'want')} placeholder={t('— want —')} />
                  {suggested && <>
                    <span className="text-[10px] text-sky-700 dark:text-sky-300">{t('Suggested by your AI')}</span>
                    <button type="button" className="text-xs text-sky-700 dark:text-sky-300 hover:underline" disabled={accept.isPending} onClick={() => accept.mutate(state.id)}>{t('Accept')}</button>
                  </>}
                  {state && <button type="button" className="text-xs text-slate-500 hover:underline" disabled={remove.isPending} onClick={() => remove.mutate(state.id)}>{t('Remove')}</button>}
                </div>
                <InlineText value={state?.note ?? null} placeholder={t('What happens to them here?')} onSave={change(scene.id, state, 'note')} />
              </li>
            )
          })}
        </ol>
        {others.length > 0 && (
          <select
            aria-label={t('Add a scene')}
            className="rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-xs"
            value=""
            onChange={event => { const id = event.target.value; if (id) setExtra(current => [...current, id]) }}
          >
            <option value="">{t('+ Add a scene…')}</option>
            {others.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
          </select>
        )}
      </div>
    </details>
  )
}
