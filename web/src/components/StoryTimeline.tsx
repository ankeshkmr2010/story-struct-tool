import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type TimelineEntry } from '../api/client'
import { AddForm, InlineNumber, InlineSelect, InlineText } from './fields'

const entryKey = (entry: TimelineEntry) => `${entry.kind}:${entry.id}`
const isSuggested = (source: string, isPov: boolean) => source === 'inferred' && !isPov

export function StoryTimeline({ storyId, onOpenScene }: {
  storyId: string
  onOpenScene: (id: string) => void
}) {
  const qc = useQueryClient()
  const timeline = useQuery({ queryKey: ['timeline', storyId], queryFn: () => api.getTimeline(storyId) })
  const locations = useQuery({ queryKey: ['locations', storyId], queryFn: () => api.listLocations(storyId) })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [characterFilter, setCharacterFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [showScenes, setShowScenes] = useState(false)
  const [order, setOrder] = useState<'world' | 'reading'>('world')
  const [showAdd, setShowAdd] = useState(false)
  const refresh = () => {
    for (const key of ['timeline', 'scenes', 'events', 'mentions', 'continuity', 'health', 'brief', 'location-usage', 'ladder']) {
      void qc.invalidateQueries({ queryKey: [key, storyId] })
    }
  }
  const edit = useMutation({
    mutationFn: async ({ entry, body }: { entry: TimelineEntry; body: Record<string, unknown> }) => {
      if (entry.kind === 'scene') await api.updateScene(storyId, entry.id, body)
      else await api.updateEvent(storyId, entry.id, body)
    },
    onSuccess: refresh,
  })
  const presence = useMutation({
    mutationFn: async ({ entry, characterId, present }: { entry: TimelineEntry; characterId: string; present: boolean }) => {
      if (entry.kind === 'scene') await api.setScenePresence(storyId, entry.id, characterId, present)
      else await api.setEventPresence(storyId, entry.id, characterId, present)
    },
    onSuccess: refresh,
  })
  const create = useMutation({
    mutationFn: (label: string) => api.createEvent(storyId, {
      label,
      sort_ordinal: Math.max(0, ...(timeline.data?.entries ?? []).flatMap((entry) => entry.ordinal === null ? [] : [entry.ordinal])) + 10,
      is_turning_point: true,
    }),
    onSuccess: (event) => { setSelectedKey(`event:${event.id}`); setShowAdd(false); setCharacterFilter(''); setLocationFilter(''); refresh() },
  })

  if (timeline.isPending) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading the story timeline…</p>
  if (timeline.isError) return <p role="alert" className="text-sm text-red-600 dark:text-red-300">Could not load the timeline. <button type="button" className="underline" onClick={() => void timeline.refetch()}>Try again</button></p>

  const entries = timeline.data.entries
  const positionOf = (entry: TimelineEntry) => order === 'world' ? entry.ordinal : entry.reading_order
  const visibleEntries = entries.filter((entry) =>
    (showScenes || entry.kind === 'event')
    && (!locationFilter || entry.location_id === locationFilter)
    && (!characterFilter || entry.participants.some((person) => person.character_id === characterFilter)),
  ).sort((a, b) => (positionOf(a) ?? Infinity) - (positionOf(b) ?? Infinity))
  const timed = visibleEntries.filter((entry) => positionOf(entry) !== null)
  const unplaced = visibleEntries.filter((entry) => positionOf(entry) === null)
  const moments = [...new Set(timed.map((entry) => positionOf(entry)!))].map((position) => ({ position, entries: timed.filter((entry) => positionOf(entry) === position) }))
  const selected = visibleEntries.find((entry) => entryKey(entry) === selectedKey) ?? visibleEntries[0]
  const select = (entry: TimelineEntry) => setSelectedKey(entryKey(entry))
  const selectedIndex = selected ? visibleEntries.findIndex((entry) => entryKey(entry) === entryKey(selected)) : -1
  const save = (field: string) => (value: string | number | boolean | null) => selected && edit.mutateAsync({ entry: selected, body: { [field]: value } })
  const eventCount = entries.filter((entry) => entry.kind === 'event').length

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-300">The whole story, one timeline</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Story timeline</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">Follow the important events with their people and places. Switch between when they happen in the world and when the reader encounters them.</p></div>
        <button type="button" onClick={() => setShowAdd(!showAdd)} className="rounded-md bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm text-white dark:text-slate-950 hover:bg-slate-700 dark:hover:bg-slate-300">{showAdd ? 'Cancel' : '+ Add event'}</button>
      </header>
      {showAdd && <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-4"><AddForm placeholder="What happens in this event?" onAdd={(title) => create.mutateAsync(title)} pending={create.isPending} /><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">The new event starts at the end of the timeline. Select it to set its time, people, and place.</p></section>}

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5" role="group" aria-label="Timeline order">{(['world', 'reading'] as const).map((value) => <button key={value} type="button" aria-pressed={order === value} onClick={() => setOrder(value)} className={`rounded px-3 py-1.5 ${order === value ? 'bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-950' : 'text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-900'}`}>{value === 'world' ? 'World time' : 'Reading order'}</button>)}</div>
        <label>Person<select aria-label="Filter timeline by person" value={characterFilter} onChange={(event) => setCharacterFilter(event.target.value)} className="ml-2 max-w-48 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5"><option value="">Everyone</option>{timeline.data.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
        <label>Place<select aria-label="Filter timeline by place" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="ml-2 max-w-48 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5"><option value="">Everywhere</option>{locations.data?.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={showScenes} onChange={(event) => setShowScenes(event.target.checked)} />Include scenes</label>
        <span className="ml-auto text-slate-400">{eventCount} events · {entries.length - eventCount} scenes</span>
      </div>

      {moments.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-gradient-to-b from-slate-50 to-white" aria-label="Visual story timeline">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400"><span>{order === 'world' ? 'Earlier ← when it happened → Later' : 'Opening ← when it is told → Ending'}</span><span>◆ Turning point</span></div>
          <div className="overflow-x-auto px-6 py-5" tabIndex={0} aria-label="Scroll horizontally through story events">
            <div className="relative flex w-max min-w-full gap-7 pb-4">
              <div aria-hidden="true" className="absolute left-0 right-0 top-[60px] h-0.5 bg-sky-200" />
              {moments.map((moment, index) => (
                <section key={moment.position} className="relative w-72 shrink-0">
                  <div className="h-20">
                    <p className="line-clamp-1 text-xs font-semibold text-slate-800 dark:text-slate-100">{order === 'world' ? [...new Set(moment.entries.map((entry) => entry.time_label).filter(Boolean))].join(' · ') || `Story time ${moment.position}` : moment.entries[0].reading_label || `Scene ${moment.position}`}</p>
                    <p className="mt-1 text-[10px] text-slate-400">{order === 'world' ? `World position ${moment.position}` : `Reading position ${moment.position}`}</p>
                    <button type="button" aria-label={`Select ${order === 'world' ? 'story time' : 'reading position'} ${moment.position}`} onClick={() => select(moment.entries[0])} className={`absolute left-0 top-[52px] z-10 size-4 border-2 border-white shadow-sm ${moment.entries.some((entry) => entry.is_turning_point) ? 'rotate-45 rounded-sm bg-amber-500' : 'rounded-full bg-sky-500'} ${selected && positionOf(selected) === moment.position ? 'ring-2 ring-sky-400 ring-offset-2' : ''}`} />
                  </div>
                  <div className={`relative space-y-3 border-l border-sky-200 dark:border-sky-800 pl-4 ${index % 2 ? 'pt-8' : ''}`}>{moment.entries.map((entry) => <EventCard key={entryKey(entry)} entry={entry} active={Boolean(selected && entryKey(selected) === entryKey(entry))} onSelect={() => select(entry)} />)}</div>
                </section>
              ))}
              <span aria-hidden="true" className="absolute right-0 top-[53px] text-sky-300">→</span>
            </div>
          </div>
          <p className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{order === 'world' ? 'World time follows what actually happened. Flashbacks stay at their original times, even when revealed near the ending. Spacing shows sequence rather than elapsed duration.' : 'Reading order follows chapter and scene order. A late confession can reveal early events here without moving them on the world-time timeline.'}</p>
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-950 p-8 text-center">
          <h3 className="text-sm font-semibold">{visibleEntries.length > 0 ? 'These events need a story time' : eventCount === 0 ? 'Place your first event on the timeline' : 'No events match these filters'}</h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{visibleEntries.length > 0 ? 'Select an unscheduled event below and assign its time. In Reading order, link it to a scene in a chapter.' : eventCount === 0 ? 'Add an important event, then give it a time, people, and location. You can also include existing scenes.' : 'Choose Everyone and Everywhere to see the global story timeline.'}</p>
        </section>
      )}

      {unplaced.length > 0 && <section className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/40 p-4"><h3 className="text-sm font-medium text-amber-900 dark:text-amber-300">{order === 'world' ? 'Time not assigned' : 'Not placed in reading order'} · {unplaced.length}</h3><p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{order === 'world' ? 'Select a scene and set its story time to place it on the timeline.' : 'Link an event to the scene that depicts it, and assign scenes to chapters to place them in reading order.'}</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{unplaced.map((entry) => <EventCard key={entryKey(entry)} entry={entry} active={Boolean(selected && entryKey(selected) === entryKey(entry))} onSelect={() => select(entry)} />)}</div></section>}

      {selected && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6" aria-label="Selected timeline event">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Edit {selected.kind} · {selected.ordinal === null ? 'Time not assigned' : `Position ${selected.ordinal}`}</p><div className="flex gap-2"><button type="button" disabled={selectedIndex <= 0} onClick={() => select(visibleEntries[selectedIndex - 1])} className="rounded border px-2 py-1 text-xs disabled:opacity-30">← Previous</button><button type="button" disabled={selectedIndex >= visibleEntries.length - 1} onClick={() => select(visibleEntries[selectedIndex + 1])} className="rounded border px-2 py-1 text-xs disabled:opacity-30">Next →</button></div></div>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <label className="block text-xs text-slate-500 dark:text-slate-400">What happens?<InlineText value={selected.title} placeholder="Event title" className="font-semibold" onSave={(value) => value ? save(selected.kind === 'event' ? 'label' : 'title')(value) : Promise.reject(new Error('Enter a title'))} /></label>
              <div className="flex flex-wrap gap-5"><label className="block text-xs text-slate-500 dark:text-slate-400">Story time<InlineNumber value={selected.ordinal} onSave={save(selected.kind === 'scene' ? 'story_time_ordinal' : 'sort_ordinal')} /></label><label className="block min-w-40 flex-1 text-xs text-slate-500 dark:text-slate-400">Time label<InlineText value={selected.time_label} placeholder="e.g. Saturday, midnight" onSave={save(selected.kind === 'scene' ? 'time_label' : 'display_label')} /></label></div>
              <label className="block text-xs text-slate-500 dark:text-slate-400">Location<InlineSelect value={selected.location_id} options={(locations.data ?? []).map((location) => ({ value: location.id, label: location.name }))} onSave={save('location_id')} /></label>
              <label className="block text-xs text-slate-500 dark:text-slate-400">Description<InlineText value={selected.summary} placeholder="What changes in this moment?" onSave={save(selected.kind === 'event' ? 'description' : 'summary')} multiline /></label>
              {selected.kind === 'event' && <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={selected.is_turning_point} disabled={edit.isPending} onChange={(event) => edit.mutate({ entry: selected, body: { is_turning_point: event.target.checked } })} />Major turning point</label>}
              {selected.chapter_title && <p className="text-xs text-slate-500 dark:text-slate-400">Chapter: {selected.chapter_title}</p>}
              {selected.arc_stages?.length > 0 && <p className="text-xs text-violet-700 dark:text-violet-300">Arc advancing: {selected.arc_stages.join(' · ')}</p>}
              {selected.reading_label && <p className="text-xs text-violet-700 dark:text-violet-300">{selected.is_flashback ? 'Revealed in a flashback' : 'Told'}: {selected.reading_label}</p>}
              {selected.scene_id && <button type="button" onClick={() => onOpenScene(selected.scene_id!)} className="text-sm text-sky-700 dark:text-sky-300 underline">{selected.kind === 'scene' ? 'Open scene editor' : 'Open linked scene'} →</button>}
              {edit.isError && <p role="alert" className="text-xs text-red-600 dark:text-red-300">Could not save this change. Please try again.</p>}
            </div>
            <div><h3 className="text-sm font-semibold">{selected.kind === 'event' ? 'People involved' : 'Who is here?'}</h3><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{selected.kind === 'event' ? 'Choose the people involved in this event, including events that happen off-page.' : 'Confirm who is present. An inferred name mention may refer to someone who is elsewhere.'}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">{timeline.data.characters.map((character) => {
                const participant = selected.participants.find((person) => person.character_id === character.id)
                const suggested = participant && isSuggested(participant.source, participant.is_pov)
                return <div key={character.id} className="flex items-start gap-2"><label className="flex flex-1 items-start gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" className="mt-1" checked={Boolean(participant && !suggested)} disabled={presence.isPending || participant?.is_pov} onChange={(event) => presence.mutate({ entry: selected, characterId: character.id, present: event.target.checked })} /><span>{character.name}{participant?.is_pov && <span className="ml-1 text-xs text-slate-400">POV</span>}{suggested && <span className="block text-xs text-amber-700 dark:text-amber-300">Mentioned · confirm presence</span>}</span></label>{suggested && <button type="button" disabled={presence.isPending} onClick={() => presence.mutate({ entry: selected, characterId: character.id, present: false })} className="text-xs text-slate-400 underline">Dismiss</button>}</div>
              })}</div>
              {timeline.data.characters.length === 0 && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Add people in Characters to attach them to events.</p>}
              {presence.isError && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">Could not update the people involved. Please try again.</p>}
              {selected.kind === 'event' && <p className="mt-4 text-xs text-slate-400">{selected.is_on_page ? 'Shown on the page' : 'Off-page event'} · event details are independent of its linked scene.</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function EventCard({ entry, active, onSelect }: { entry: TimelineEntry; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={active} className={`w-full rounded-xl border bg-white dark:bg-slate-900 p-4 text-left shadow-sm transition hover:border-sky-300 dark:hover:border-sky-800 hover:shadow-md ${active ? 'border-sky-400 ring-2 ring-sky-200' : 'border-slate-200 dark:border-slate-700'}`}>
      <span className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-slate-400"><span>{entry.kind}</span>{entry.is_turning_point && <span className="text-amber-700 dark:text-amber-300">◆ Turning point</span>}{entry.is_flashback && <span className="text-violet-600 dark:text-violet-300">Flashback</span>}</span>
      <span className="mt-2 block text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">{entry.title}</span>
      {entry.summary && <span className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{entry.summary}</span>}
      <span className="mt-2 block text-[10px] text-slate-400">Happens: {entry.time_label ?? (entry.ordinal === null ? 'Time unknown' : `world position ${entry.ordinal}`)}</span>
      {entry.reading_label && <span className="mt-1 block text-[10px] text-violet-600 dark:text-violet-300">{entry.is_flashback ? 'Revealed later' : 'Told'}: {entry.reading_label}</span>}
      <span className="mt-3 flex items-start gap-2 border-t border-slate-100 dark:border-slate-800 pt-3 text-xs text-slate-600 dark:text-slate-300"><span aria-hidden="true">⌖</span><span>{entry.location_name ?? 'Location not set'}</span></span>
      <span className="mt-2 flex flex-wrap gap-1.5">{entry.participants.length > 0 ? entry.participants.map((person) => <span key={person.character_id} className={`rounded-full border px-2 py-0.5 text-[10px] ${isSuggested(person.source, person.is_pov) ? 'border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300' : 'border-sky-100 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 text-sky-800 dark:text-sky-300'}`}>{person.name}{isSuggested(person.source, person.is_pov) ? ' ?' : ''}</span>) : <span className="text-xs text-slate-400">People not set</span>}</span>
      {entry.arc_stages?.map((stage) => <span key={stage} className="mt-2 block rounded-md bg-violet-50 dark:bg-violet-950 px-2 py-1 text-[10px] leading-4 text-violet-700 dark:text-violet-300">Arc · {stage}</span>)}
    </button>
  )
}
