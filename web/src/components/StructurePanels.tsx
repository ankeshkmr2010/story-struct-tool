import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { AddForm, Chip, DeleteButton, InlineNumber, InlineSelect, InlineText } from './fields'

function useRefresh(storyId: string, collection: string) {
  const qc = useQueryClient()
  return () => {
    for (const key of [collection, 'ladder', 'health', 'brief', 'continuity', 'suggestions', 'timeline']) {
      void qc.invalidateQueries({ queryKey: [key, storyId] })
    }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="block">{children}</span>
    </label>
  )
}

const TYPE_OPTIONS = ['a_story', 'b_story', 'c_story', 'throughline']

export function EventsPanel({ storyId }: { storyId: string }) {
  const refresh = useRefresh(storyId, 'events')
  const events = useQuery({ queryKey: ['events', storyId], queryFn: () => api.listEvents(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const locations = useQuery({ queryKey: ['locations', storyId], queryFn: () => api.listLocations(storyId) })
  const create = useMutation({
    mutationFn: (label: string) => api.createEvent(storyId, { label, is_turning_point: true }),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.updateEvent(storyId, id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteEvent(storyId, id), onSuccess: refresh })
  const save = (id: string, field: string, value: unknown) => update.mutateAsync({ id, body: { [field]: value } })

  return (
    <div>
      <h2 className="text-sm font-semibold">Arc skeleton</h2>
      <p className="mb-3 text-xs text-slate-400">Map three to five major turning points, then refine their order and place on the page.</p>
      <AddForm placeholder="Turning point…" onAdd={(label) => create.mutateAsync(label)} pending={create.isPending} />
      <ul className="mt-4 space-y-3">
        {events.data?.map((event) => (
          <li key={event.id} className="rounded border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <InlineText value={event.label} placeholder="event label" onSave={(v) => save(event.id, 'label', v)} className="font-medium" />
              </div>
              <Chip complete={event.completeness.is_complete} missing={event.completeness.missing} />
              <DeleteButton onConfirm={() => remove.mutate(event.id)} what="event" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Story order"><InlineNumber value={event.sort_ordinal} onSave={(v) => save(event.id, 'sort_ordinal', v)} /></Field>
              <Field label="Time label"><InlineText value={event.display_label} placeholder="e.g. the following morning" onSave={(v) => save(event.id, 'display_label', v)} /></Field>
              <Field label="Turning point"><InlineSelect value={String(event.is_turning_point)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} onSave={(v) => save(event.id, 'is_turning_point', v === 'true')} /></Field>
              <Field label="On the page"><InlineSelect value={String(event.is_on_page)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} onSave={(v) => save(event.id, 'is_on_page', v === 'true')} /></Field>
              <Field label="Depicted in scene"><InlineSelect value={event.scene_id} options={(scenes.data ?? []).map((scene) => ({ value: scene.id, label: scene.title ?? 'Untitled scene' }))} onSave={(v) => save(event.id, 'scene_id', v)} /></Field>
              <Field label="Location"><InlineSelect value={event.location_id} options={(locations.data ?? []).map((location) => ({ value: location.id, label: location.name }))} onSave={(v) => save(event.id, 'location_id', v)} /></Field>
            </div>
            <div className="mt-2"><Field label="Description"><InlineText value={event.description} placeholder="What changes here?" onSave={(v) => save(event.id, 'description', v)} multiline /></Field></div>
          </li>
        ))}
      </ul>
      {events.data?.length === 0 && <p className="mt-3 text-sm text-slate-400">No events yet.</p>}
    </div>
  )
}

export function ActsPanel({ storyId, framework }: { storyId: string; framework: string }) {
  const refresh = useRefresh(storyId, 'acts')
  const qc = useQueryClient()
  const acts = useQuery({ queryKey: ['acts', storyId], queryFn: () => api.listActs(storyId) })
  const events = useQuery({ queryKey: ['events', storyId], queryFn: () => api.listEvents(storyId) })
  const scaffold = useMutation({
    mutationFn: () => api.scaffold(storyId),
    onSuccess: () => { refresh(); void qc.invalidateQueries({ queryKey: ['beats', storyId] }) },
  })
  const create = useMutation({
    mutationFn: (title: string) => api.createAct(storyId, { title, number: Math.max(0, ...(acts.data ?? []).map((act) => act.number)) + 1 }),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateAct(storyId, id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteAct(storyId, id), onSuccess: refresh })
  const save = (id: string, field: string, value: unknown) => update.mutateAsync({ id, body: { [field]: value } })
  const eventOptions = (events.data ?? []).map((event) => ({ value: event.id, label: event.label }))

  return (
    <div>
      <h2 className="text-sm font-semibold">Acts</h2>
      <p className="mb-3 text-xs text-slate-400">What changes in each act?</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => scaffold.mutate()} disabled={scaffold.isPending} className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40">Seed {framework.replaceAll('_', ' ')}</button>
        {scaffold.data && <span className="self-center text-xs text-slate-500 dark:text-slate-400">{scaffold.data.changed ? `Added ${scaffold.data.acts_created} acts and ${scaffold.data.beats_created} beats.` : 'Already seeded.'}</span>}
      </div>
      <div className="mt-3"><AddForm placeholder="New act title…" onAdd={(title) => create.mutateAsync(title)} pending={create.isPending} /></div>
      <ul className="mt-4 space-y-3">
        {acts.data?.map((act) => (
          <li key={act.id} className="rounded border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center gap-2">
              <InlineNumber value={act.number} min={1} onSave={(v) => save(act.id, 'number', v)} />
              <div className="min-w-0 flex-1"><InlineText value={act.title} placeholder="act title" onSave={(v) => save(act.id, 'title', v)} className="font-medium" /></div>
              <Chip complete={act.completeness.is_complete} missing={act.completeness.missing} />
              <DeleteButton onConfirm={() => remove.mutate(act.id)} what="act" />
            </div>
            <div className="mt-2"><Field label="Summary"><InlineText value={act.summary} placeholder="What changes across this act?" onSave={(v) => save(act.id, 'summary', v)} multiline /></Field></div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Emotional shift from"><InlineText value={act.emotional_shift_from} placeholder="from" onSave={(v) => save(act.id, 'emotional_shift_from', v)} /></Field>
              <Field label="Emotional shift to"><InlineText value={act.emotional_shift_to} placeholder="to" onSave={(v) => save(act.id, 'emotional_shift_to', v)} /></Field>
              <Field label="Opening turning point"><InlineSelect value={act.opening_turning_point_id} options={eventOptions} onSave={(v) => save(act.id, 'opening_turning_point_id', v)} /></Field>
              <Field label="Closing turning point"><InlineSelect value={act.closing_turning_point_id} options={eventOptions} onSave={(v) => save(act.id, 'closing_turning_point_id', v)} /></Field>
            </div>
          </li>
        ))}
      </ul>
      {acts.data?.length === 0 && <p className="mt-3 text-sm text-slate-400">No acts yet.</p>}
    </div>
  )
}

export function BeatsPanel({ storyId, framework }: { storyId: string; framework: string }) {
  const refresh = useRefresh(storyId, 'beats')
  const qc = useQueryClient()
  const acts = useQuery({ queryKey: ['acts', storyId], queryFn: () => api.listActs(storyId) })
  const beats = useQuery({ queryKey: ['beats', storyId], queryFn: () => api.listBeats(storyId) })
  const scaffold = useMutation({
    mutationFn: () => api.scaffold(storyId),
    onSuccess: () => { refresh(); void qc.invalidateQueries({ queryKey: ['acts', storyId] }) },
  })
  const create = useMutation({ mutationFn: (label: string) => api.createBeat(storyId, { label }), onSuccess: refresh })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateBeat(storyId, id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteBeat(storyId, id), onSuccess: refresh })
  const save = (id: string, field: string, value: unknown) => update.mutateAsync({ id, body: { [field]: value } })

  return (
    <div>
      <h2 className="text-sm font-semibold">Beats</h2>
      <p className="mb-3 text-xs text-slate-400">What must happen to fulfil each act? Seeded beats are ordinary editable rows.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => scaffold.mutate()} disabled={scaffold.isPending} className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40">Seed {framework.replaceAll('_', ' ')}</button>
        {scaffold.data && <span className="self-center text-xs text-slate-500 dark:text-slate-400">{scaffold.data.changed ? `Added ${scaffold.data.acts_created} acts and ${scaffold.data.beats_created} beats.` : 'Already seeded.'}</span>}
      </div>
      <div className="mt-3"><AddForm placeholder="New beat label…" onAdd={(label) => create.mutateAsync(label)} pending={create.isPending} /></div>
      <ul className="mt-4 space-y-3">
        {beats.data?.map((beat) => (
          <li key={beat.id} className="rounded border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><InlineText value={beat.label} placeholder="beat label" onSave={(v) => save(beat.id, 'label', v)} className="font-medium" /></div>
              <Chip complete={beat.completeness.is_complete} missing={beat.completeness.missing} />
              <DeleteButton onConfirm={() => remove.mutate(beat.id)} what="beat" />
            </div>
            <div className="mt-2"><Field label="Act"><InlineSelect value={beat.act_id} options={(acts.data ?? []).map((act) => ({ value: act.id, label: `${act.number}. ${act.title ?? 'Untitled'}` }))} onSave={(v) => save(beat.id, 'act_id', v)} /></Field></div>
            <div className="mt-2"><Field label="Description"><InlineText value={beat.description} placeholder="What must happen?" onSave={(v) => save(beat.id, 'description', v)} multiline /></Field></div>
            {beat.framework_position && <p className="mt-1 text-[10px] text-slate-400">Framework: {beat.framework_position}</p>}
          </li>
        ))}
      </ul>
      {beats.data?.length === 0 && <p className="mt-3 text-sm text-slate-400">No beats yet.</p>}
    </div>
  )
}

export function ThreadsPanel({ storyId }: { storyId: string }) {
  const refresh = useRefresh(storyId, 'threads')
  const threads = useQuery({ queryKey: ['threads', storyId], queryFn: () => api.listThreads(storyId) })
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId) })
  const create = useMutation({ mutationFn: (title: string) => api.createThread(storyId, { title, type: 'a_story' }), onSuccess: refresh })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateThread(storyId, id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteThread(storyId, id), onSuccess: refresh })
  const save = (id: string, field: string, value: unknown) => update.mutateAsync({ id, body: { [field]: value } })

  return (
    <div>
      <h2 className="text-sm font-semibold">Threads</h2>
      <p className="mb-3 text-xs text-slate-400">Which storylines carry the scenes?</p>
      <AddForm placeholder="Thread title…" onAdd={(title) => create.mutateAsync(title)} pending={create.isPending} />
      <ul className="mt-4 space-y-3">
        {threads.data?.map((thread) => (
          <li key={thread.id} className="rounded border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><InlineText value={thread.title} placeholder="thread title" onSave={(v) => save(thread.id, 'title', v)} className="font-medium" /></div>
              <Chip complete={thread.completeness.is_complete} missing={thread.completeness.missing} />
              <DeleteButton onConfirm={() => remove.mutate(thread.id)} what="thread" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Storyline type"><InlineSelect value={thread.type} options={TYPE_OPTIONS} onSave={(v) => save(thread.id, 'type', v)} /></Field>
              <Field label="Owner"><InlineSelect value={thread.owner_character_id} options={(characters.data ?? []).map((c) => ({ value: c.id, label: c.name }))} onSave={(v) => save(thread.id, 'owner_character_id', v)} /></Field>
            </div>
          </li>
        ))}
      </ul>
      {threads.data?.length === 0 && <p className="mt-3 text-sm text-slate-400">No threads yet.</p>}
    </div>
  )
}
