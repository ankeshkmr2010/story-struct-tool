import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Scene } from '../api/client'
import { OriginSummary } from './AuthorshipPanel'
import { SceneDelete } from './SceneDelete'
import { Chip, Field, InlineNumber, InlineSelect, InlineText } from './fields'



/**
 * Every scene field and link. With `essentials` (Write's Context panel) the fields a writer
 * reaches for mid-draft stay in view and everything else folds under More details and links.
 */
export function SceneDetails({ storyId, scene, onDeleted, essentials = false }: { storyId: string; scene: Scene; onDeleted: () => void; essentials?: boolean }) {
  const detailed = useDetailedStatuses()
  const qc = useQueryClient()
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId) })
  const locations = useQuery({ queryKey: ['locations', storyId], queryFn: () => api.listLocations(storyId) })
  const beats = useQuery({ queryKey: ['beats', storyId], queryFn: () => api.listBeats(storyId) })
  const threads = useQuery({ queryKey: ['threads', storyId], queryFn: () => api.listThreads(storyId) })
  const arcs = useQuery({ queryKey: ['arcs', storyId], queryFn: () => api.listArcs(storyId) })
  const stageQueries = useQueries({ queries: (arcs.data ?? []).map((arc) => ({ queryKey: ['arc-stages', arc.id], queryFn: () => api.listArcStages(arc.id) })) })
  const links = useQuery({ queryKey: ['scene-links', storyId, scene.id], queryFn: () => api.getSceneLinks(storyId, scene.id) })

  const refresh = () => {
    for (const key of ['scenes', 'brief', 'health', 'ladder', 'continuity', 'location-usage', 'progress', 'suggestions', 'timeline']) {
      void qc.invalidateQueries({ queryKey: [key, storyId] })
    }
  }
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateScene(storyId, scene.id, body),
    onSuccess: refresh,
  })
  const toggle = useMutation({
    mutationFn: async ({ kind, id, checked }: { kind: 'beat' | 'thread' | 'stage'; id: string; checked: boolean }) => {
      if (kind === 'beat') { await (checked ? api.linkSceneBeat(storyId, scene.id, id) : api.unlinkSceneBeat(storyId, scene.id, id)); return }
      if (kind === 'thread') { await (checked ? api.linkSceneThread(storyId, scene.id, id) : api.unlinkSceneThread(storyId, scene.id, id)); return }
      await (checked ? api.linkSceneArcStage(storyId, scene.id, id) : api.unlinkSceneArcStage(storyId, scene.id, id))
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['scene-links', storyId, scene.id] }); refresh() },
  })
  const save = (field: string) => (value: string | number | null) => update.mutateAsync({ [field]: value })
  const stages = stageQueries.flatMap((query, index) => (query.data ?? []).map((stage) => ({
    ...stage,
    owner: characters.data?.find((character) => character.id === arcs.data?.[index]?.character_id)?.name ?? t('Arc'),
  })))

  const pov = <Field label={t('POV character')}><InlineSelect value={scene.pov_character_id} options={(characters.data ?? []).map((character) => ({ value: character.id, label: character.name }))} onSave={save('pov_character_id')} /></Field>
  const place = <Field label={t('Place')}><InlineSelect value={scene.location_id} options={(locations.data ?? []).map((location) => ({ value: location.id, label: location.name }))} onSave={save('location_id')} /></Field>
  const summary = <Field label={t('Summary')}><InlineText value={scene.summary} placeholder={t('What happens?')} onSave={save('summary')} multiline /></Field>
  const goal = <Field label={t('Goal')}><InlineText value={scene.goal} placeholder={t('What does the POV character want?')} onSave={save('goal')} multiline /></Field>
  const valueFrom = <Field label={t('Emotional value from')}><InlineText value={scene.emotional_value_from} placeholder={t('from')} onSave={save('emotional_value_from')} /></Field>
  const valueTo = <Field label={t('Emotional value to')}><InlineText value={scene.emotional_value_to} placeholder={t('to')} onSave={save('emotional_value_to')} /></Field>

  // Write's Context: where this scene sits in each linked arc, and the threads it advances.
  const arcCards = essentials ? (arcs.data ?? []).flatMap((arc, index) => {
    const list = stageQueries[index]?.data ?? []
    const at = list.findIndex((stage) => links.data?.arc_stage_ids.includes(stage.id))
    if (at < 0) return []
    const owner = characters.data?.find((character) => character.id === arc.character_id)?.name ?? t('Arc')
    return [<div key={arc.id} className="ws-card"><h4>{t('Arc')}</h4><p>{arc.resolution ? `${owner} · ${arc.resolution}` : owner}</p><div className="ws-track" aria-hidden="true">{list.map((stage, step) => <i key={stage.id} className={step <= at ? 'on' : ''} />)}</div><p className="ws-card-note">{t('Step {0} of {1} · {2}', at + 1, list.length, list[at].label)}</p></div>]
  }) : []
  const linkedThreads = essentials ? (threads.data ?? []).filter((thread) => links.data?.thread_ids.includes(thread.id)) : []

  return (
    <div>{essentials && <section className="scene-essentials" aria-label={t('Scene essentials')}>
      {summary}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{pov}{place}</div>
      {goal}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{valueFrom}{valueTo}</div>
    </section>}{arcCards}{linkedThreads.length > 0 && <div className="ws-card"><h4>{t('Threads')}</h4>{linkedThreads.map((thread) => <p key={thread.id}>{thread.title || t('Untitled thread')}{thread.mice && <span className="ws-card-note"> · {thread.mice}</span>}</p>)}</div>}<div className="scene-details-actions"><SceneDelete storyId={storyId} scene={scene} onDeleted={() => { onDeleted(); refresh() }} /></div><SceneImages storyId={storyId} sceneId={scene.id} /><details className="mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-950">
        <span>{essentials ? t('More details and links') : t('Scene details and links')}</span>
        <span className="truncate text-xs font-normal text-slate-400">{t('Draft: {0} · {1} words', statusName(shownStatus(scene, detailed)), scene.word_count)}</span>
      </summary>
      <div className="border-t border-slate-100 dark:border-slate-800 p-3">
      <div className="flex items-center justify-between">
        <h3 className="section-title">{t('Structure')}</h3>
        <div className="flex items-center gap-2"><Chip complete={scene.completeness.is_complete} missing={scene.completeness.missing} /></div>
      </div>
      <ReferenceImages storyId={storyId} entity="scene" entityId={scene.id} hideGallery />
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t('Title')}><InlineText value={scene.title} placeholder={t('Scene title')} onSave={save('title')} /></Field>
        <Field label={t('Chapter')}><InlineSelect value={scene.chapter_id} options={(chapters.data ?? []).map((chapter) => ({ value: chapter.id, label: `${chapter.number}. ${chapter.title ?? t('Untitled')}` }))} onSave={save('chapter_id')} /></Field>
        <Field label={t('Type')}><InlineSelect value={scene.type} options={['scene', 'sequel']} onSave={save('type')} /></Field>
        <Field label={t('Draft status')}><InlineSelect value={shownStatus(scene, detailed)} options={(detailed ? DETAILED : SIMPLE).map(value => ({ value, label: statusName(value) }))} onSave={value => save('status')(value ? storedStatus(String(value), scene) : value)} /></Field>
        {!essentials && <>{pov}{place}</>}
        <Field label={t('Story time')}><InlineNumber value={scene.story_time_ordinal} onSave={save('story_time_ordinal')} /></Field>
        <Field label={t('Time label')}><InlineText value={scene.time_label} placeholder={t('e.g. next morning')} onSave={save('time_label')} /></Field>
        <Field label={t('Flashback')}><InlineSelect value={String(scene.is_flashback)} options={[{ value: 'true', label: t('Yes') }, { value: 'false', label: t('No') }]} onSave={(v) => update.mutateAsync({ is_flashback: v === 'true' })} /></Field>
      </div>
      <div className="mt-2 space-y-2">
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{t('The completeness badge follows your filled details. Choose Draft status yourself: placeholder → outlined → drafted → revised.')}</p>
        {!essentials && <>{summary}{goal}</>}
        <Field label={t('Conflict')}><InlineText value={scene.conflict} placeholder={t('What opposes them?')} onSave={save('conflict')} multiline /></Field>
        <OriginSummary storyId={storyId} entityId={scene.id} entityType="scene" />
        <Field label={t('Private scene notes')}><InlineText value={scene.notes} placeholder={t('Notes belong here; summary describes the scene')} onSave={save('notes')} multiline /></Field>
        <Field label={t('Outcome')}><InlineText value={scene.outcome} placeholder={t('What changes?')} onSave={save('outcome')} multiline /></Field>
      </div>
      {!essentials && <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{valueFrom}{valueTo}</div>}
      <div className="mt-4 space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
        <div><h4 className="field-label">{t('Beats this scene fulfils')}</h4><div className="mt-1 flex flex-wrap gap-2">{beats.data?.map((beat) => <label key={beat.id} className="text-xs"><input type="checkbox" checked={links.data?.beat_ids.includes(beat.id) ?? false} onChange={(event) => toggle.mutate({ kind: 'beat', id: beat.id, checked: event.target.checked })} /> {beat.label}</label>)}</div></div>
        <div><h4 className="field-label">{t('Threads advanced')}</h4><div className="mt-1 flex flex-wrap gap-2">{threads.data?.map((thread) => <label key={thread.id} className="text-xs"><input type="checkbox" checked={links.data?.thread_ids.includes(thread.id) ?? false} onChange={(event) => toggle.mutate({ kind: 'thread', id: thread.id, checked: event.target.checked })} /> {thread.title ?? thread.type}</label>)}</div></div>
        {stages.length > 0 && <div><h4 className="field-label">{t('Arc stages advanced')}</h4><div className="mt-1 flex flex-wrap gap-2">{stages.map((stage) => <label key={stage.id} className="text-xs"><input type="checkbox" checked={links.data?.arc_stage_ids.includes(stage.id) ?? false} onChange={(event) => toggle.mutate({ kind: 'stage', id: stage.id, checked: event.target.checked })} /> {stage.owner}: {stage.label}</label>)}</div></div>}
      </div>
      </div>
    </details></div>
  )
}
import { ReferenceImages, SceneImages } from './StoryImages'
import { t } from '../i18n'
import { DETAILED, SIMPLE, shownStatus, statusName, storedStatus, useDetailedStatuses } from './sceneStatus'
