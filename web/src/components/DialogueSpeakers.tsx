import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type DialogueLine, type DialogueList } from '../api/client'
import { errorText } from '../api/errors'
import { isLocalStory } from '../sandbox/storage'
import { t, tx } from '../i18n'

const SOURCE: Record<string, string> = { code: tx('from the text'), reader: tx('shared reader'), agent: tx('AI agent'), author: tx('you') }
type OpenPassage = (id: string, find: string, paragraph: number) => void
type Filter = { sceneId?: string; characterId?: string; onlyEmpty?: boolean }

function useDialogue(storyId: string, filter: Filter, enabled = true) {
  return useQuery({
    queryKey: ['dialogue', storyId, filter.sceneId ?? '', filter.characterId ?? '', !!filter.onlyEmpty],
    queryFn: () => api.listDialogue(storyId, filter),
    enabled: enabled && !isLocalStory(storyId),
  })
}

function useFill(storyId: string) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (useReader: boolean) => api.populateDialogue(storyId, useReader), onSuccess: () => qc.invalidateQueries({ queryKey: ['dialogue', storyId] }) })
}

const alert = 'text-sm text-rose-700 dark:text-rose-300'

/** Lines with a speaker picker each; `grouped` adds scene headings. Changing a speaker refreshes
 *  every dialogue list of the story (scene, character, Dialogue voice). */
function LineList({ storyId, data, grouped, onOpenPassage }: { storyId: string; data: DialogueList; grouped: boolean; onOpenPassage?: OpenPassage }) {
  const qc = useQueryClient()
  const set = useMutation({
    mutationFn: (line: DialogueLine & { character_id: string | null }) => api.setDialogueSpeakers(storyId, [{ line_id: line.line_id, text: line.text, character_id: line.character_id }]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dialogue', storyId] }),
  })
  const groups: DialogueLine[][] = []
  for (const line of data.lines) {
    const last = groups[groups.length - 1]
    if (grouped && last && last[0].scene_id === line.scene_id) last.push(line)
    else if (grouped || !last) groups.push([line])
    else last.push(line)
  }
  const cast = Object.entries(data.characters).sort((a, b) => a[1].localeCompare(b[1]))
  return <>
    {set.error && <p role="alert" className={alert}>{errorText(set.error)}</p>}
    {set.data?.stale.length ? <p role="alert" className="text-sm">{t('That line changed since the list loaded; it has been refreshed.')}</p> : null}
    {groups.map(group => (
      <section key={group[0].line_id} className="space-y-1">
        {grouped && <h4 className="text-sm font-semibold">{group[0].scene_title}</h4>}
        <ul className="space-y-1">
          {group.map(line => (
            <li key={line.line_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={line.text}>“{line.text}”</span>
              <select
                aria-label={t('Speaker of “{0}”', line.text.slice(0, 60))}
                value={line.speaker_id ?? ''}
                disabled={set.isPending}
                onChange={event => set.mutate({ ...line, character_id: event.target.value || null })}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">{t('Nobody yet')}</option>
                {cast.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              {line.source && <span className="text-xs opacity-70">{t(SOURCE[line.source] ?? line.source)}</span>}
              {onOpenPassage && <button type="button" className="underline" onClick={() => onOpenPassage(line.scene_id, line.find, line.paragraph)}>{t('Open in Write →')}</button>}
            </li>
          ))}
        </ul>
      </section>
    ))}
    {data.lines.length >= 500 && <p className="writer-help">{t('Showing the first 500 lines.')}</p>}
  </>
}

/** Who speaks each quoted line, story-wide: empty until filled from the text, by the shared
 *  reader, an agent or the author. Dialogue voice reads these first. */
export function DialogueSpeakers({ storyId, shared, onOpenPassage }: {
  storyId: string
  shared: boolean
  onOpenPassage?: OpenPassage
}) {
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const lines = useDialogue(storyId, { onlyEmpty })
  const fill = useFill(storyId)
  const data = lines.data

  return (
    <details className="eval-worth-a-look">
      <summary>{data ? t('Who speaks each line ({0} of {1} set)', data.attributed, data.total) : t('Who speaks each line')}</summary>
      <div className="mt-2 space-y-3">
        <p className="writer-help">{t('Every quoted line starts empty. Fill from the text uses speech tags (“said Maya”) and lines that start with a character’s name; the shared reader also names speakers it is sure of. Neither changes a speaker you or an agent set.')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="share-story-button" disabled={fill.isPending} onClick={() => fill.mutate(false)}>{fill.isPending && !fill.variables ? t('Filling…') : t('Fill from the text')}</button>
          {shared && <button type="button" className="share-story-button" disabled={fill.isPending} onClick={() => fill.mutate(true)}>{fill.isPending && fill.variables ? t('Reading…') : t('Fill with the shared reader')}</button>}
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyEmpty} onChange={event => setOnlyEmpty(event.target.checked)} />{t('Only lines without a speaker')}</label>
        </div>
        {fill.data && <p className="text-sm">{t('Filled {0} from the text and {1} by the shared reader; {2} still empty.', fill.data.by_code, fill.data.by_reader, fill.data.empty)}</p>}
        {fill.error && <p role="alert" className={alert}>{errorText(fill.error)}</p>}
        {lines.error && <p role="alert" className={alert}>{errorText(lines.error)}</p>}
        {data && data.lines.length === 0 && <p className="text-sm">{onlyEmpty ? t('Every line has a speaker.') : t('No quoted lines yet.')}</p>}
        {data && <LineList storyId={storyId} data={data} grouped onOpenPassage={onOpenPassage} />}
      </div>
    </details>
  )
}

/** One scene's quoted lines and their speakers (scene details in Write and Design). Loads on open. */
export function SceneDialogue({ storyId, sceneId, onOpenPassage }: { storyId: string; sceneId: string; onOpenPassage?: OpenPassage }) {
  const [open, setOpen] = useState(false)
  const lines = useDialogue(storyId, { sceneId }, open)
  const fill = useFill(storyId)
  const data = lines.data
  if (isLocalStory(storyId)) return null
  const set = data?.lines.filter(line => line.source).length ?? 0
  return (
    <details className="mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">{data ? t('Dialogue ({0} of {1} lines have a speaker)', set, data.lines.length) : t('Dialogue')}</summary>
      <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 p-3">
        <button type="button" className="share-story-button" disabled={fill.isPending} onClick={() => fill.mutate(false)}>{fill.isPending ? t('Filling…') : t('Fill from the text')}</button>
        {fill.error && <p role="alert" className={alert}>{errorText(fill.error)}</p>}
        {lines.error && <p role="alert" className={alert}>{errorText(lines.error)}</p>}
        {data && data.lines.length === 0 && <p className="text-sm">{t('No quoted lines in this scene yet.')}</p>}
        {data && <LineList storyId={storyId} data={data} grouped={false} onOpenPassage={onOpenPassage} />}
      </div>
    </details>
  )
}

/** The lines a character speaks, by scene; each can be moved to someone else. Loads on open. */
export function CharacterLines({ storyId, characterId, onOpenPassage }: { storyId: string; characterId: string; onOpenPassage?: OpenPassage }) {
  const [open, setOpen] = useState(false)
  const lines = useDialogue(storyId, { characterId }, open)
  const data = lines.data
  if (isLocalStory(storyId)) return null
  return (
    <details className="mt-1.5" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-400">{data ? t('Lines ({0})', data.lines.length) : t('Lines')}</summary>
      <div className="mt-1 space-y-2">
        {lines.error && <p role="alert" className={alert}>{errorText(lines.error)}</p>}
        {data && data.lines.length === 0 && <p className="writer-help">{t('No lines with this speaker yet. Fill from the text in a scene’s Dialogue, or pick speakers there.')}</p>}
        {data && <LineList storyId={storyId} data={data} grouped onOpenPassage={onOpenPassage} />}
      </div>
    </details>
  )
}
