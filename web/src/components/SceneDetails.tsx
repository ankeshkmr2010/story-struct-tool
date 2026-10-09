import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Scene } from '../api/client'
import { SceneDelete } from './SceneDelete'
import { Chip, InlineNumber, InlineSelect, InlineText } from './fields'

const STATUSES = ['placeholder', 'outlined', 'drafted', 'revised']

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span><span className="block">{children}</span></label>
}

export function SceneDetails({ storyId, scene, onDeleted }: { storyId: string; scene: Scene; onDeleted: () => void }) {
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
    owner: characters.data?.find((character) => character.id === arcs.data?.[index]?.character_id)?.name ?? 'Arc',
  })))

  return (
    <div><div className="scene-details-actions"><SceneDelete storyId={storyId} scene={scene} onDeleted={() => { onDeleted(); refresh() }} /></div><details className="mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-950">
        <span>Scene details and links</span>
        <span className="truncate text-xs font-normal text-slate-400">Draft: {scene.status} · {scene.word_count} words</span>
      </summary>
      <div className="border-t border-slate-100 dark:border-slate-800 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Structure</h3>
        <div className="flex items-center gap-2"><Chip complete={scene.completeness.is_complete} missing={scene.completeness.missing} /></div>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Title"><InlineText value={scene.title} placeholder="Scene title" onSave={save('title')} /></Field>
        <Field label="Chapter"><InlineSelect value={scene.chapter_id} options={(chapters.data ?? []).map((chapter) => ({ value: chapter.id, label: `${chapter.number}. ${chapter.title ?? 'Untitled'}` }))} onSave={save('chapter_id')} /></Field>
        <Field label="Type"><InlineSelect value={scene.type} options={['scene', 'sequel']} onSave={save('type')} /></Field>
        <Field label="Draft status"><InlineSelect value={scene.status} options={STATUSES} onSave={save('status')} /></Field>
        <Field label="POV character"><InlineSelect value={scene.pov_character_id} options={(characters.data ?? []).map((character) => ({ value: character.id, label: character.name }))} onSave={save('pov_character_id')} /></Field>
        <Field label="Place"><InlineSelect value={scene.location_id} options={(locations.data ?? []).map((location) => ({ value: location.id, label: location.name }))} onSave={save('location_id')} /></Field>
        <Field label="Story time"><InlineNumber value={scene.story_time_ordinal} onSave={save('story_time_ordinal')} /></Field>
        <Field label="Time label"><InlineText value={scene.time_label} placeholder="e.g. next morning" onSave={save('time_label')} /></Field>
        <Field label="Flashback"><InlineSelect value={String(scene.is_flashback)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} onSave={(v) => update.mutateAsync({ is_flashback: v === 'true' })} /></Field>
      </div>
      <div className="mt-2 space-y-2">
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">The completeness badge follows your filled details. Choose Draft status yourself: placeholder → outlined → drafted → revised.</p>
        <Field label="Summary"><InlineText value={scene.summary} placeholder="What happens?" onSave={save('summary')} multiline /></Field>
        <Field label="Goal"><InlineText value={scene.goal} placeholder="What does the POV character want?" onSave={save('goal')} multiline /></Field>
        <Field label="Conflict"><InlineText value={scene.conflict} placeholder="What opposes them?" onSave={save('conflict')} multiline /></Field>
        <Field label="Outcome"><InlineText value={scene.outcome} placeholder="What changes?" onSave={save('outcome')} multiline /></Field>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Emotional value from"><InlineText value={scene.emotional_value_from} placeholder="from" onSave={save('emotional_value_from')} /></Field>
        <Field label="Emotional value to"><InlineText value={scene.emotional_value_to} placeholder="to" onSave={save('emotional_value_to')} /></Field>
      </div>
      <div className="mt-4 space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
        <div><h4 className="text-xs font-semibold">Beats this scene fulfils</h4><div className="mt-1 flex flex-wrap gap-2">{beats.data?.map((beat) => <label key={beat.id} className="text-xs"><input type="checkbox" checked={links.data?.beat_ids.includes(beat.id) ?? false} onChange={(event) => toggle.mutate({ kind: 'beat', id: beat.id, checked: event.target.checked })} /> {beat.label}</label>)}</div></div>
        <div><h4 className="text-xs font-semibold">Threads advanced</h4><div className="mt-1 flex flex-wrap gap-2">{threads.data?.map((thread) => <label key={thread.id} className="text-xs"><input type="checkbox" checked={links.data?.thread_ids.includes(thread.id) ?? false} onChange={(event) => toggle.mutate({ kind: 'thread', id: thread.id, checked: event.target.checked })} /> {thread.title ?? thread.type}</label>)}</div></div>
        {stages.length > 0 && <div><h4 className="text-xs font-semibold">Arc stages advanced</h4><div className="mt-1 flex flex-wrap gap-2">{stages.map((stage) => <label key={stage.id} className="text-xs"><input type="checkbox" checked={links.data?.arc_stage_ids.includes(stage.id) ?? false} onChange={(event) => toggle.mutate({ kind: 'stage', id: stage.id, checked: event.target.checked })} /> {stage.owner}: {stage.label}</label>)}</div></div>}
      </div>
      </div>
    </details></div>
  )
}
