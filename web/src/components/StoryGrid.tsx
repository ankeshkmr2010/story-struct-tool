import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Authorship, type Scene } from '../api/client'
import { orderScenes } from '../api/ordering'
import { InlineSelect, InlineText } from './fields'
import { SceneDetails } from './SceneDetails'

const STATUSES = ['placeholder', 'outlined', 'drafted', 'revised']
const STATUS_DOT: Record<string, string> = {
  placeholder: 'bg-slate-400',
  outlined: 'bg-sky-500',
  drafted: 'bg-emerald-500',
  revised: 'bg-violet-500',
}
const AGENT_ORIGINS = new Set(['mcp', 'assistant'])
const DAY = 24 * 60 * 60 * 1000

type Prefs = { hidden: string[]; collapsed: string[]; status: string; pov: string; noShift: boolean; gaps: boolean; compact: boolean }
const DEFAULTS: Prefs = { hidden: [], collapsed: [], status: '', pov: '', noShift: false, gaps: false, compact: false }

function usePrefs(storyId: string) {
  const key = `story-grid:${storyId}`
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(key) ?? '{}') } } catch { return DEFAULTS }
  })
  const update = (patch: Partial<Prefs>) => setPrefs((current) => {
    const next = { ...current, ...patch }
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* per-viewer convenience only */ }
    return next
  })
  return [prefs, update] as const
}

/** Agent edits since this viewer's previous visit to the grid (or the last day on a first visit). */
function useLastVisit(storyId: string) {
  const key = `story-grid-visit:${storyId}`
  const [since] = useState(() => {
    try { return Number(localStorage.getItem(key)) || Date.now() - DAY } catch { return Date.now() - DAY }
  })
  useEffect(() => {
    try { localStorage.setItem(key, String(Date.now())) } catch { /* ignore */ }
  }, [key])
  return since
}

const shiftKind = (scene: Scene) => {
  const from = scene.emotional_value_from?.trim().toLowerCase()
  const to = scene.emotional_value_to?.trim().toLowerCase()
  if (!from || !to) return 'missing'
  return from === to ? 'flat' : 'shift'
}
const SHIFT_COLOR = { shift: 'bg-emerald-500', flat: 'bg-amber-500', missing: 'bg-slate-300 dark:bg-slate-600' }

function Shift({ scene }: { scene: Scene }) {
  const from = scene.emotional_value_from?.trim()
  const to = scene.emotional_value_to?.trim()
  if (!from && !to) return null
  const flat = shiftKind(scene) === 'flat'
  return <span title={flat ? 'Value does not change in this scene' : undefined} className={`inline-block rounded-full px-2 text-[11px] ${flat ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{from || '?'} → {to || '?'}{flat ? ' · no shift' : ''}</span>
}

type Column = {
  key: string
  label: string
  width?: string
  fields: string[]
  filled: (scene: Scene) => boolean
  view: (scene: Scene) => ReactNode
  edit: (scene: Scene) => ReactNode
}

export function StoryGrid({ storyId, onOpenScene, onOpenInbox }: { storyId: string; onOpenScene: (scene: Scene) => void; onOpenInbox: () => void }) {
  const qc = useQueryClient()
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId) })
  const locations = useQuery({ queryKey: ['locations', storyId], queryFn: () => api.listLocations(storyId) })
  const authorship = useQuery({ queryKey: ['authorship', storyId], queryFn: () => api.getAuthorship(storyId) })
  const [prefs, setPrefs] = usePrefs(storyId)
  const since = useLastVisit(storyId)
  const [editing, setEditing] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // The scene whose move is saving; held for at least a second so the spinner is noticeable.
  const [moving, setMoving] = useState<string | null>(null)
  const movingSince = useRef(0)

  const refresh = () => {
    for (const key of ['scenes', 'brief', 'health', 'ladder', 'continuity', 'location-usage', 'progress', 'suggestions', 'timeline', 'authorship']) {
      void qc.invalidateQueries({ queryKey: [key, storyId] })
    }
  }
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateScene(storyId, id, body),
    onSuccess: refresh,
  })
  // Moves show instantly: the target chapter's order is rebuilt in the cache (sequential keys, so tied
  // agent-written sort keys can't misplace it) and rolled back on failure.
  const move = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { chapter_id: string | null; before_scene_id?: string; after_scene_id?: string } }) => api.moveScene(storyId, id, body),
    onMutate: ({ id, body }) => {
      setMoving(id)
      movingSince.current = Date.now()
      void qc.cancelQueries({ queryKey: ['scenes', storyId] })
      const previous = qc.getQueryData<Scene[]>(['scenes', storyId])
      qc.setQueryData<Scene[]>(['scenes', storyId], (current) => {
        const moved = current?.find((scene) => scene.id === id)
        if (!current || !moved) return current
        const siblings = orderScenes(current.filter((scene) => (scene.chapter_id ?? null) === body.chapter_id && scene.id !== id))
        const at = body.before_scene_id ? siblings.findIndex((scene) => scene.id === body.before_scene_id) : siblings.length
        siblings.splice(at < 0 ? siblings.length : at, 0, { ...moved, chapter_id: body.chapter_id })
        const keys = new Map(siblings.map((scene, index) => [scene.id, (index + 1) * 100]))
        return current.map((scene) => keys.has(scene.id) ? { ...scene, chapter_id: scene.id === id ? body.chapter_id : scene.chapter_id, sort_key: keys.get(scene.id)! } : scene)
      })
      return { previous }
    },
    onError: (_error, _vars, context) => { if (context?.previous) qc.setQueryData(['scenes', storyId], context.previous) },
    onSettled: (_data, _error, { id }) => {
      refresh()
      window.setTimeout(() => setMoving((current) => current === id ? null : current), Math.max(0, 1000 - (Date.now() - movingSince.current)))
    },
  })
  const save = (id: string, field: string) => (value: string | number | null) => update.mutateAsync({ id, body: { [field]: value } })

  const characterOptions = (characters.data ?? []).map((character) => ({ value: character.id, label: character.name }))
  const locationOptions = (locations.data ?? []).map((location) => ({ value: location.id, label: location.name }))
  const name = (options: { value: string; label: string }[], id: string | null | undefined) => options.find((option) => option.value === id)?.label ?? null

  // Latest edit per scene field, kept only when an agent made it after the viewer's last visit.
  const agentEdits = new Map<string, Authorship>()
  const seen = new Set<string>()
  for (const row of authorship.data ?? []) {
    if (row.entity_type !== 'scene') continue
    const key = `${row.entity_id}:${row.field}`
    if (seen.has(key)) continue
    seen.add(key)
    if (AGENT_ORIGINS.has(row.origin) && Date.parse(row.created_at) > since) agentEdits.set(key, row)
  }
  const agentEdit = (scene: Scene, fields: string[]) => fields.map((field) => agentEdits.get(`${scene.id}:${field}`)).find(Boolean)
  const sceneHasAgentEdit = (scene: Scene) => [...agentEdits.keys()].some((key) => key.startsWith(`${scene.id}:`))

  const clamp = prefs.compact ? 'line-clamp-1' : 'line-clamp-2'
  const text = (value: string | null | undefined) => value?.trim()
    ? <span title={value} className={`${clamp} text-slate-700 dark:text-slate-300`}>{value}</span>
    : <span className="text-slate-300 dark:text-slate-600">—</span>
  const has = (value: unknown) => typeof value === 'string' ? value.trim() !== '' : value != null

  const columns: Column[] = [
    { key: 'pov', label: 'POV', width: 'w-28', fields: ['pov_character_id'], filled: (s) => has(s.pov_character_id), view: (s) => text(name(characterOptions, s.pov_character_id)), edit: (s) => <InlineSelect value={s.pov_character_id} options={characterOptions} onSave={save(s.id, 'pov_character_id')} /> },
    { key: 'place', label: 'Place', width: 'w-36', fields: ['location_id'], filled: (s) => has(s.location_id), view: (s) => text(name(locationOptions, s.location_id)), edit: (s) => <InlineSelect value={s.location_id} options={locationOptions} onSave={save(s.id, 'location_id')} /> },
    { key: 'time', label: 'Time', width: 'w-24', fields: ['time_label'], filled: (s) => has(s.time_label), view: (s) => text(s.time_label), edit: (s) => <InlineText value={s.time_label} placeholder="—" onSave={save(s.id, 'time_label')} /> },
    { key: 'goal', label: 'Goal', fields: ['goal'], filled: (s) => has(s.goal), view: (s) => text(s.goal), edit: (s) => <InlineText value={s.goal} placeholder="—" multiline onSave={save(s.id, 'goal')} /> },
    { key: 'conflict', label: 'Conflict', fields: ['conflict'], filled: (s) => has(s.conflict), view: (s) => text(s.conflict), edit: (s) => <InlineText value={s.conflict} placeholder="—" multiline onSave={save(s.id, 'conflict')} /> },
    { key: 'outcome', label: 'Outcome', fields: ['outcome'], filled: (s) => has(s.outcome), view: (s) => text(s.outcome), edit: (s) => <InlineText value={s.outcome} placeholder="—" multiline onSave={save(s.id, 'outcome')} /> },
    {
      key: 'shift', label: 'Value shift', width: 'w-36', fields: ['emotional_value_from', 'emotional_value_to'], filled: (s) => shiftKind(s) === 'shift',
      view: (s) => <Shift scene={s} />,
      edit: (s) => <div className="flex flex-col gap-1"><InlineText value={s.emotional_value_from} placeholder="from" onSave={save(s.id, 'emotional_value_from')} /><InlineText value={s.emotional_value_to} placeholder="to" onSave={save(s.id, 'emotional_value_to')} /><Shift scene={s} /></div>,
    },
    { key: 'words', label: 'Words', width: 'w-16', fields: [], filled: (s) => (s.word_count ?? 0) > 0, view: (s) => <span className="block text-right tabular-nums text-slate-500">{s.word_count ?? 0}</span>, edit: (s) => <span className="block text-right tabular-nums text-slate-500">{s.word_count ?? 0}</span> },
  ]
  const shown = columns.filter((column) => !prefs.hidden.includes(column.key))
  const flexible = shown.filter((column) => !column.width).length

  const all = scenes.data ?? []
  const groupsAll = [
    ...(chapters.data ?? []).map((chapter) => ({ id: chapter.id as string | null, label: `${chapter.number}. ${chapter.title ?? 'Untitled'}` })),
    { id: null as string | null, label: 'Unfiled scenes' },
  ].map((group) => ({ ...group, key: group.id ?? 'unfiled', all: orderScenes(all.filter((scene) => (scene.chapter_id ?? null) === group.id)) }))
  const numbers = new Map(groupsAll.flatMap((group) => group.all).map((scene, index) => [scene.id, index + 1]))
  const matches = (scene: Scene) =>
    (!prefs.status || scene.status === prefs.status)
    && (!prefs.pov || (prefs.pov === 'none' ? !scene.pov_character_id : scene.pov_character_id === prefs.pov))
    && (!prefs.noShift || shiftKind(scene) !== 'shift')
  const groups = groupsAll
    .map((group) => ({ ...group, scenes: group.all.filter(matches), shut: prefs.collapsed.includes(group.key) }))
    .filter((group) => group.scenes.length > 0 || (group.id !== null && dragging))
  const visible = groups.flatMap((group) => group.scenes)
  const navigable = groups.flatMap((group) => group.shut ? [] : group.scenes)
  const words = visible.reduce((sum, scene) => sum + (scene.word_count ?? 0), 0)
  const span = 3 + shown.length
  const pad = prefs.compact ? 'py-1' : 'py-2'
  const drawerScene = all.find((scene) => scene.id === drawer)

  const toggleGroup = (key: string) => setPrefs({ collapsed: prefs.collapsed.includes(key) ? prefs.collapsed.filter((item) => item !== key) : [...prefs.collapsed, key] })
  const toggleColumn = (key: string) => setPrefs({ hidden: prefs.hidden.includes(key) ? prefs.hidden.filter((item) => item !== key) : [...prefs.hidden, key] })
  const advanceStatus = (scene: Scene) => {
    const next = STATUSES[(STATUSES.indexOf(scene.status) + 1) % STATUSES.length]
    void update.mutateAsync({ id: scene.id, body: { status: next } })
  }
  const focusRow = (id: string) => {
    setCursor(id)
    document.getElementById(`grid-row-${id}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (event.key === 'Escape') {
      // Fields save on blur, and an unmounted input never blurs: blur first so typed text is kept.
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) target.blur()
      setEditing(null); setDrawer(null); return
    }
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return
    const at = navigable.findIndex((scene) => scene.id === cursor)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = navigable[Math.max(0, Math.min(navigable.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (next) focusRow(next.id)
    } else if (event.key === 'Enter' && cursor) {
      event.preventDefault()
      setEditing(cursor)
    }
  }
  const over = (id: string) => (event: React.DragEvent) => {
    if (!dragging) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropTarget !== id) setDropTarget(id)
  }
  const dropOnScene = (event: React.DragEvent, target: Scene) => {
    event.preventDefault()
    if (dragging && dragging !== target.id) move.mutate({ id: dragging, body: { chapter_id: target.chapter_id ?? null, before_scene_id: target.id } })
    setDragging(null); setDropTarget(null)
  }
  const dropOnChapter = (event: React.DragEvent, group: (typeof groupsAll)[number]) => {
    event.preventDefault()
    const last = group.all.filter((scene) => scene.id !== dragging).at(-1)
    if (dragging) move.mutate({ id: dragging, body: { chapter_id: group.id, ...(last ? { after_scene_id: last.id } : {}) } })
    setDragging(null); setDropTarget(null)
  }

  const toolButton = (active: boolean) => `rounded-md px-2 py-1 text-sm ${active ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-950' : 'workspace-shortcut'}`
  const filter = 'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-700 dark:text-slate-200'
  const headCell = 'sticky top-0 z-20 h-8 bg-slate-50 px-2 dark:bg-slate-950'

  return (
    <div className="min-w-0">
      <p className="eyebrow">STORY GRID</p>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Every scene at a glance</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Click a row to edit · ↑ ↓ Enter Esc · drag rows to reorder · click a title for details.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="Filter by status" value={prefs.status} onChange={(event) => setPrefs({ status: event.target.value })} className={filter}>
          <option value="">All statuses</option>
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select aria-label="Filter by POV" value={prefs.pov} onChange={(event) => setPrefs({ pov: event.target.value })} className={filter}>
          <option value="">All POVs</option>
          <option value="none">No POV set</option>
          {characterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" aria-pressed={prefs.noShift} onClick={() => setPrefs({ noShift: !prefs.noShift })} className={toolButton(prefs.noShift)}>No value shift</button>
        <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />
        <button type="button" aria-pressed={prefs.gaps} onClick={() => setPrefs({ gaps: !prefs.gaps })} className={toolButton(prefs.gaps)} title="Fade filled cells and highlight empty ones">Gaps</button>
        <button type="button" aria-pressed={prefs.compact} onClick={() => setPrefs({ compact: !prefs.compact })} className={toolButton(prefs.compact)}>Compact</button>
        <details className="relative">
          <summary className={`${toolButton(false)} cursor-pointer list-none`}>Columns ▾</summary>
          <div className="absolute z-30 mt-1 w-44 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {columns.map((column) => <label key={column.key} className="flex items-center gap-2 py-0.5 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={!prefs.hidden.includes(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}</label>)}
          </div>
        </details>
        <button type="button" onClick={() => setPrefs({ collapsed: prefs.collapsed.length ? [] : groupsAll.map((group) => group.key) })} className={toolButton(false)}>{prefs.collapsed.length ? 'Expand' : 'Collapse'} all</button>
        {moving && <span role="status" className="flex items-center gap-1 text-xs text-slate-500"><span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-200" />Saving order…</span>}
        {agentEdits.size > 0 && <button type="button" onClick={onOpenInbox} className="ml-auto rounded-full border border-[var(--accent)] px-2 py-0.5 text-xs text-slate-600 dark:text-slate-300">{agentEdits.size} agent edits since your last visit →</button>}
      </div>
      {scenes.isLoading && <p className="mt-4 text-sm text-slate-500">Loading scenes…</p>}
      {scenes.data && all.length === 0 && <p className="mt-4 text-sm text-slate-500">No scenes yet.</p>}
      {all.length > 0 && (
        <div tabIndex={0} onKeyDown={onKeyDown} className="mt-4 max-h-[calc(100vh-10rem)] overflow-auto rounded-md border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700">
          <table className="w-full table-fixed border-collapse text-left text-sm" style={{ minWidth: 560 + flexible * 200 }}>
            <colgroup>
              <col className="w-8" /><col className="w-44" /><col className="w-10" />
              {shown.map((column) => <col key={column.key} className={column.width} />)}
            </colgroup>
            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className={headCell}>#</th>
                <th className={headCell}>Scene</th>
                <th className={headCell} title="Draft status — click a dot to advance">St</th>
                {shown.map((column) => <th key={column.key} className={`${headCell} ${column.key === 'words' ? 'text-right' : ''}`}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => [
                <tr key={`group-${group.key}`}>
                  <th
                    colSpan={span}
                    onClick={() => toggleGroup(group.key)}
                    onDragOver={over(group.key)}
                    onDrop={(event) => dropOnChapter(event, group)}
                    aria-expanded={!group.shut}
                    className={`sticky top-8 z-10 cursor-pointer px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 ${dropTarget === group.key ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700'}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-3">{group.shut ? '▸' : '▾'}</span>
                      <span className="truncate">{group.label}</span>
                      <span className="font-normal text-slate-400">{group.scenes.length} scenes · {group.scenes.reduce((sum, scene) => sum + (scene.word_count ?? 0), 0)} words</span>
                      <span className="ml-auto flex gap-0.5" aria-label="Value shift per scene">
                        {group.scenes.map((scene) => <span key={scene.id} title={`${scene.title ?? 'Untitled'}: ${shiftKind(scene) === 'shift' ? 'value shifts' : shiftKind(scene) === 'flat' ? 'no shift' : 'not set'}`} className={`h-3 w-1.5 rounded-sm ${SHIFT_COLOR[shiftKind(scene)]}`} />)}
                      </span>
                    </span>
                  </th>
                </tr>,
                ...(group.shut ? [] : group.scenes).map((scene) => {
                  const isEditing = editing === scene.id
                  const agent = sceneHasAgentEdit(scene)
                  return (
                    <tr
                      key={scene.id}
                      id={`grid-row-${scene.id}`}
                      draggable={!isEditing}
                      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', scene.id); setDragging(scene.id) }}
                      onDragEnd={() => { setDragging(null); setDropTarget(null) }}
                      onDragOver={over(scene.id)}
                      onDrop={(event) => dropOnScene(event, scene)}
                      onClick={() => { setCursor(scene.id); if (!isEditing) setEditing(scene.id) }}
                      className={[
                        'border-t border-slate-100 align-top dark:border-slate-800',
                        isEditing ? 'bg-slate-50 dark:bg-slate-800/40 [&_select]:w-full [&_select]:max-w-full' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40',
                        cursor === scene.id ? 'outline outline-2 -outline-offset-2 outline-slate-400' : '',
                        dropTarget === scene.id ? 'border-t-2 border-t-emerald-500' : '',
                        dragging === scene.id ? 'opacity-40' : moving === scene.id ? 'bg-emerald-50 dark:bg-emerald-900/20' : '',
                      ].join(' ')}
                    >
                      <td className={`px-2 ${pad} text-xs text-slate-400`}>{moving === scene.id ? <span aria-label="Saving order" className="mt-0.5 block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600 dark:border-slate-600 dark:border-t-emerald-300" /> : numbers.get(scene.id)}</td>
                      <td className={`px-2 ${pad}`}>
                        <button type="button" onClick={(event) => { event.stopPropagation(); setDrawer(scene.id) }} className="text-left font-medium text-slate-800 hover:underline dark:text-slate-100">{scene.title || 'Untitled scene'}</button>
                        {scene.is_flashback && <span className="ml-1 rounded bg-indigo-100 px-1 text-[10px] text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">flashback</span>}
                        {agent && <span title="Changed by an agent since your last visit" className="ml-1 rounded border border-[var(--accent)] px-1 text-[10px] text-slate-500">agent</span>}
                        {isEditing && <button type="button" onClick={(event) => { event.stopPropagation(); setEditing(null) }} className="workspace-shortcut mt-2 block rounded px-2 text-xs">Done</button>}
                      </td>
                      <td className={`px-2 ${pad}`}>
                        <button type="button" aria-label={`Status ${scene.status}, click to advance`} title={`${scene.status} — click to advance`} onClick={(event) => { event.stopPropagation(); advanceStatus(scene) }} className={`mt-1 block h-3 w-3 rounded-full ${STATUS_DOT[scene.status] ?? 'bg-slate-300'}`} />
                      </td>
                      {shown.map((column) => {
                        const edit = agentEdit(scene, column.fields)
                        const gap = prefs.gaps && !isEditing ? (column.filled(scene) ? 'opacity-30' : 'bg-amber-50 dark:bg-amber-900/20') : ''
                        return (
                          <td key={column.key} className={`relative px-2 ${pad} ${gap}`}>
                            {isEditing ? column.edit(scene) : column.view(scene)}
                            {edit && !isEditing && <span title={`${edit.actor_label} · ${new Date(edit.created_at).toLocaleString()}`} className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                          </td>
                        )
                      })}
                    </tr>
                  )
                }),
              ])}
            </tbody>
            <tfoot className="border-t border-slate-200 text-xs text-slate-500 dark:border-slate-700">
              <tr>
                <td colSpan={span} className="px-2 py-2">
                  <span className="flex flex-wrap items-center gap-3">
                    <span>{visible.length} of {all.length} scenes · {words} words</span>
                    {STATUSES.map((status) => <span key={status} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />{visible.filter((scene) => scene.status === status).length} {status}</span>)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {(update.isError || move.isError) && <p className="mt-2 text-sm text-red-600">Could not save: {((update.error ?? move.error) as Error).message}</p>}
      {drawerScene && (
        <aside aria-label="Scene details" className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="eyebrow">SCENE {numbers.get(drawerScene.id)}</p>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{drawerScene.title || 'Untitled scene'}</h3>
            </div>
            <button type="button" onClick={() => setDrawer(null)} aria-label="Close details" className="workspace-shortcut rounded px-2">✕</button>
          </div>
          {drawerScene.summary && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{drawerScene.summary}</p>}
          <button type="button" onClick={() => onOpenScene(drawerScene)} className="workspace-shortcut mt-3 rounded-md px-3 py-1 text-sm">Open in scene editor →</button>
          <SceneDetails key={drawerScene.id} storyId={storyId} scene={drawerScene} onDeleted={() => setDrawer(null)} />
        </aside>
      )}
    </div>
  )
}
