import { rows, SANDBOX_ID, transact, type Row, type Sandbox } from './storage'

const kinds: Record<string, string> = { characters: 'character', relationships: 'relationship', arcs: 'arc', stages: 'arc_stage', acts: 'act', beats: 'beat', threads: 'thread', chapters: 'chapter', scenes: 'scene', events: 'event', locations: 'location', glossary: 'glossary_entry' }
const required: Record<string, string[]> = { story: ['title', 'premise'], character: ['name', 'role', 'want', 'need'], arc: ['resolution'], arc_stage: ['label'], act: ['summary'], beat: ['label'], thread: ['type'], chapter: ['title'], scene: ['summary', 'goal', 'conflict', 'outcome'], event: ['label'], location: ['name'], glossary_entry: ['term'] }
const wordCount = (content: unknown) => String(content ?? '').trim().split(/\s+/).filter(Boolean).length
const sorted = (items: Row[]) => [...items].sort((a, b) => Number(a.sort_key ?? 0) - Number(b.sort_key ?? 0) || String(a.id).localeCompare(String(b.id)))
function out(row: Row, kind: string) {
  const missing = (required[kind] ?? []).filter(field => !row[field])
  return { ...row, completeness: { is_complete: !missing.length, missing }, word_count: wordCount(row.content) }
}
function linked(s: Sandbox, kind: string, left: string, id: unknown, right: string) {
  return rows(s, kind).filter(row => row[left] === id).map(row => row[right])
}
function deleteEntity(s: Sandbox, kind: string, id: string) {
  s.backup.state[kind] = rows(s, kind).filter(row => row.id !== id)
  for (const [table, values] of Object.entries(s.backup.state)) {
    if (!Array.isArray(values) || table === kind) continue
    for (const row of [...values]) {
      const references = Object.keys(row).filter(field => field.endsWith('_id') && row[field] === id)
      if (!references.length) continue
      if (['arc', 'arc_stage', 'relationship'].includes(table) && row.id) deleteEntity(s, table, row.id)
      else if (Object.values(kinds).includes(table)) references.forEach(field => { row[field] = null })
      else s.backup.state[table] = rows(s, table).filter(value => value !== row)
    }
  }
}
function timeline(s: Sandbox) {
  const chapters = sorted(rows(s, 'chapter'))
  const scenes = sorted(rows(s, 'scene')).sort((a, b) => chapters.findIndex(c => c.id === a.chapter_id) - chapters.findIndex(c => c.id === b.chapter_id))
  const characters = rows(s, 'character')
  return { story_id: SANDBOX_ID, characters, entries: [...scenes.map((row, index) => {
    const presence = rows(s, 'scene_presence').filter(p => p.scene_id === row.id && !p.is_rejected)
    const cast = characters.filter(c => c.id === row.pov_character_id || presence.some(p => p.character_id === c.id))
    return { id: row.id, kind: 'scene', scene_id: row.id, title: row.title ?? 'Untitled scene', summary: row.summary, ordinal: row.story_time_ordinal ?? null, time_label: row.time_label, location_id: row.location_id, location_name: rows(s, 'location').find(p => p.id === row.location_id)?.name, is_flashback: row.is_flashback ?? false, is_turning_point: false, is_on_page: true, reading_order: index + 1, reading_label: `Scene ${index + 1}`, participants: cast.map(c => ({ character_id: c.id, name: c.name, source: 'author', is_pov: c.id === row.pov_character_id })), threads: [], beats: [], arc_stages: [] }
  }), ...rows(s, 'event').map(row => ({ id: row.id, kind: 'event', title: row.label, summary: row.description, ordinal: row.sort_ordinal ?? null, time_label: row.display_label, location_id: row.location_id, location_name: rows(s, 'location').find(p => p.id === row.location_id)?.name, scene_id: row.scene_id, is_on_page: row.is_on_page, is_turning_point: row.is_turning_point, reading_order: scenes.findIndex(scene => scene.id === row.scene_id) + 1 || null, participants: characters.filter(c => linked(s, 'event_character', 'event_id', row.id, 'character_id').includes(c.id)).map(c => ({ character_id: c.id, name: c.name, source: 'author', is_pov: false })), threads: [], beats: [], arc_stages: [] }))] }
}
function brief(s: Sandbox, id: string) {
  const chapter = rows(s, 'chapter').find(row => row.id === id)!
  const act = rows(s, 'act').find(row => row.id === chapter.act_id)
  const scenes = sorted(rows(s, 'scene').filter(row => row.chapter_id === id))
  const beatIds = linked(s, 'chapter_beat', 'chapter_id', id, 'beat_id')
  const stageIds = scenes.flatMap(scene => linked(s, 'scene_arc_advance', 'scene_id', scene.id, 'arc_stage_id'))
  const arcs = rows(s, 'arc').filter(arc => rows(s, 'arc_stage').some(stage => stage.arc_id === arc.id && stageIds.includes(stage.id)))
  return { ...chapter, chapter_id: id, act_number: act?.number, act_title: act?.title, beats: rows(s, 'beat').filter(beat => beatIds.includes(beat.id)).map(beat => ({ beat_id: beat.id, label: beat.label, framework_position: beat.framework_position, is_fulfilled: scenes.some(scene => linked(s, 'scene_beat', 'scene_id', scene.id, 'beat_id').includes(beat.id)) })), arcs_advancing: arcs.map(arc => ({ arc_id: arc.id, summary: `${rows(s, 'character').find(c => c.id === arc.character_id)?.name ?? 'Character'} (${sorted(rows(s, 'arc_stage').filter(stage => stage.arc_id === arc.id)).map(stage => stage.label).join(' → ')})` })), threads: rows(s, 'thread').filter(thread => scenes.some(scene => linked(s, 'scene_thread', 'scene_id', scene.id, 'thread_id').includes(thread.id))).map(thread => ({ thread_id: thread.id, title: thread.title, type: thread.type })), pov_character_name: rows(s, 'character').find(c => c.id === scenes[0]?.pov_character_id)?.name, emotional_shift_from: act?.emotional_shift_from, emotional_shift_to: act?.emotional_shift_to, emotional_shift_inherited: true, scenes: scenes.map(scene => ({ scene_id: scene.id, title: scene.title, type: scene.type, status: scene.status, is_complete: out(scene, 'scene').completeness.is_complete })), placeholder_scene_count: scenes.filter(scene => !scene.content).length }
}
function search(s: Sandbox, params: URLSearchParams) {
  const query = (params.get('q') ?? '').toLocaleLowerCase()
  const context = params.get('context') ?? 'prose'
  const field = params.get('field')
  const entity = params.get('entity')
  const allowed = context === 'prose' ? ['scene'] : context === 'timeline' ? ['scene', 'event'] : [context]
  const hits = allowed.filter(kind => !entity || entity === kind).flatMap(kind => rows(s, kind).flatMap(row => {
    const matches = Object.entries(row).filter(([name, value]) => typeof value === 'string' && !name.endsWith('_id') && name !== 'id' && (!field || field === name) && (context !== 'prose' || name === 'content') && value.toLocaleLowerCase().includes(query)).map(([name, value]) => { const text = String(value), at = text.toLocaleLowerCase().indexOf(query); return { field: name, excerpt: text.slice(Math.max(0, at - 80), at + query.length + 160) } })
    return matches.length ? [{ story_id: SANDBOX_ID, story_title: rows(s, 'story')[0].title, entity: kind, id: row.id, title: row.title ?? row.name ?? row.label ?? row.term, chapter_id: row.chapter_id, chapter_title: rows(s, 'chapter').find(c => c.id === row.chapter_id)?.title, matches }] : []
  }))
  const offset = Number(params.get('offset') ?? 0)
  return { items: hits.slice(offset, offset + 30), next_offset: hits.length > offset + 30 ? offset + 30 : null, semantic_available: false, indexing: false }
}
export function isSandboxRequest(path: string) {
  return path.startsWith(`/api/stories/${SANDBOX_ID}`) || (location.pathname === '/try' && (path.startsWith('/api/arcs/') || path === '/api/auth/me'))
}
export async function sandboxRequest(path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, location.origin)
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) as Row : {}
  if (path === '/api/auth/me') return { id: SANDBOX_ID, name: 'You', email: '', author_name: null }
  return transact(s => {
    const story = rows(s, 'story')[0]
    const parts = url.pathname.replace(`/api/stories/${SANDBOX_ID}`, '').split('/').filter(Boolean)
    if (url.pathname.startsWith('/api/arcs/')) parts.splice(0, parts.length, 'stages', url.pathname.split('/')[3], ...url.pathname.split('/').slice(5))
    const [collection, id, action, linkedId] = parts
    if (!collection) { if (method === 'PATCH') Object.assign(story, body); return out(story, 'story') }
    if (collection === 'activity') return { change_token: `${s.edits.length}:${story.updated_at ?? s.created}` }
    if (collection === 'reader') return { share: { title: story.title, owner_name: 'You', allow_import: false }, structure: s.backup.state, timeline: timeline(s), base_fingerprint: 'local' }
    if (collection === 'timeline') return timeline(s)
    if (collection === 'search') {
      if (id === 'capabilities') return { semantic_available: false }
      if (id === 'target') { const row = rows(s, url.searchParams.get('entity')!).find(r => r.id === url.searchParams.get('id')); if (!row) throw new Error('This item was removed.'); return row }
      return search(s, url.searchParams)
    }
    if (collection === 'ladder') {
      const levelKinds = ['story', 'event', 'character', 'act', 'beat', 'thread', 'chapter', 'scene']
      const levels = ['Premise', 'Events', 'Characters', 'Acts', 'Beats', 'Threads', 'Chapters', 'Scenes'].map((label, i) => { const records = rows(s, levelKinds[i]); const missing = [...new Set(records.flatMap(row => out(row, levelKinds[i]).completeness.missing))]; return { level: i + 1, label, is_ready: records.length > 0 && !missing.length, blocked_by: !records.length ? [`Add ${label.toLowerCase()}`] : missing } })
      return { story_id: SANDBOX_ID, furthest_ready_level: levels.find(level => !level.is_ready)?.level ?? 8, snapshot: {}, levels }
    }
    if (collection === 'health') return { findings: [], counts: {} }
    if (collection === 'continuity') return { contradictions: [], possible_anomalies: [], findings: [] }
    if (collection === 'progress') { const scenes = rows(s, 'scene'); return { word_count: scenes.reduce((sum, scene) => sum + wordCount(scene.content), 0), scene_count: scenes.length, drafted_scene_count: scenes.filter(scene => scene.content).length, chapters: [] } }
    if (collection === 'authorship') return s.edits.slice().reverse().map(edit => ({ entity_type: 'scene', entity_id: edit.scene_id, field: 'content', actor_label: 'You', origin: 'author', action: 'update', created_at: edit.created_at }))
    if (collection === 'ai' || collection === 'suggestions') return []
    if (collection === 'locations' && id === 'usage') return rows(s, 'location').map(place => {
      const scenes = rows(s, 'scene').filter(scene => scene.location_id === place.id)
      const times = scenes.map(scene => scene.story_time_ordinal).filter((time): time is number => typeof time === 'number')
      return { location_id: place.id, scene_count: scenes.length, chapter_numbers: [...new Set(rows(s, 'chapter').filter(chapter => scenes.some(scene => scene.chapter_id === chapter.id)).map(chapter => chapter.number))], first_story_time: times.length ? Math.min(...times) : null, last_story_time: times.length ? Math.max(...times) : null }
    })
    const kind = kinds[collection]
    if (!kind) throw new Error('Available with a free account')
    const list = rows(s, kind)
    if (!s.backup.state[kind]) s.backup.state[kind] = list
    const row = list.find(r => r.id === id)
    if (kind === 'arc_stage' && url.pathname.startsWith('/api/arcs/')) {
      const stageId = action
      if (method === 'GET') return sorted(list.filter(stage => stage.arc_id === id)).map(stage => out(stage, kind))
      if (method === 'POST') { const created = { ...body, arc_id: id, id: crypto.randomUUID() }; list.push(created); return out(created, kind) }
      const stage = list.find(item => item.id === stageId)
      if (!stage) throw new Error('Stage not found')
      if (method === 'PATCH') Object.assign(stage, body)
      if (method === 'DELETE') s.backup.state[kind] = list.filter(item => item !== stage)
      return out(stage, kind)
    }
    if (!id) {
      if (method === 'GET') return sorted(list).map(r => out(r, kind))
      if (method === 'POST') { const created = { type: kind === 'thread' ? 'a_story' : 'scene', status: 'placeholder', sort_key: 100, ...body, id: crypto.randomUUID(), story_id: SANDBOX_ID, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; if (kind !== 'scene' && kind !== 'thread') delete (created as Row).type; if (kind !== 'scene' && kind !== 'chapter') delete (created as Row).status; if (!['scene', 'chapter', 'act', 'beat', 'thread'].includes(kind)) delete (created as Row).sort_key; list.push(created); return out(created, kind) }
    }
    if (!row) throw new Error('This item no longer exists.')
    if (action === 'brief') return brief(s, id)
    if (action === 'content') {
      if (method === 'GET') return { scene_id: id, content: row.content ?? null, word_count: wordCount(row.content) }
      if ('expected_content' in body && String(row.content ?? '') !== String(body.expected_content ?? '')) throw new Error('Your scene changed in another tab. Reload the saved draft before retrying.')
      const revisions = rows(s, 'scene_revision')
      if (body.snapshot) { revisions.push({ id: crypto.randomUUID(), scene_id: id, content: row.content, label: body.snapshot_label ?? 'Writing checkpoint', word_count: wordCount(row.content), created_at: new Date().toISOString() }); s.backup.state.scene_revision = revisions }
      row.content = body.content; row.updated_at = new Date().toISOString(); story.updated_at = row.updated_at
      s.editedScene = id; s.edits.push({ scene_id: id, content: String(body.content ?? ''), created_at: String(row.updated_at) })
      return { word_count: wordCount(row.content), revision_created: !!body.snapshot, annotations_reanchored: 0, annotations_orphaned: 0 }
    }
    if (action === 'move') { row.chapter_id = 'chapter_id' in body ? body.chapter_id : row.chapter_id; const siblings = sorted(list.filter(r => r.chapter_id === row.chapter_id && r.id !== id)); let index = body.before_scene_id ? siblings.findIndex(r => r.id === body.before_scene_id) : body.after_scene_id ? siblings.findIndex(r => r.id === body.after_scene_id) + 1 : siblings.length; if (index < 0) index = siblings.length; siblings.splice(index, 0, row); siblings.forEach((r, i) => { r.sort_key = (i + 1) * 100 }); return { sort_key: row.sort_key, chapter_id: row.chapter_id, rebalanced: true } }
    if (action === 'links' || ['beats', 'threads', 'arc-stages'].includes(action)) {
      const left = kind === 'chapter' ? 'chapter_id' : 'scene_id'
      const tables = { beats: [`${kind}_beat`, 'beat_id'], threads: ['scene_thread', 'thread_id'], 'arc-stages': ['scene_arc_advance', 'arc_stage_id'] } as const
      if (action !== 'links') { const [table, right] = tables[action as keyof typeof tables]; const joins = rows(s, table); const target = body[right] ?? linkedId; s.backup.state[table] = joins.filter(j => !(j[left] === id && j[right] === target)); if (method !== 'DELETE') (s.backup.state[table] as Row[]).push({ [left]: id, [right]: target, ...(table === 'scene_thread' ? { is_primary: false } : {}) }) }
      return { beat_ids: linked(s, `${kind}_beat`, left, id, 'beat_id'), thread_ids: linked(s, 'scene_thread', left, id, 'thread_id'), arc_stage_ids: linked(s, 'scene_arc_advance', left, id, 'arc_stage_id') }
    }
    if (action === 'presence') { const table = kind === 'scene' ? 'scene_presence' : 'event_character', left = `${kind}_id`; const joins = rows(s, table).filter(j => !(j[left] === id && j.character_id === linkedId)); if (body.is_present) joins.push({ [left]: id, character_id: linkedId, ...(kind === 'scene' ? { id: crypto.randomUUID(), source: 'author', is_rejected: false } : {}) }); s.backup.state[table] = joins; return { is_present: body.is_present } }
    if (action === 'mentions') return rows(s, 'scene_presence').filter(p => p.scene_id === id).map(p => ({ ...p, name: rows(s, 'character').find(c => c.id === p.character_id)?.name }))
    if (action === 'annotations' || action === 'revisions') {
      const table = action === 'annotations' ? 'annotation' : 'scene_revision'
      const records = rows(s, table)
      if (method === 'GET') return records.filter(r => r.scene_id === id)
      if (method === 'DELETE') { s.backup.state[table] = records.filter(r => r.id !== linkedId); return }
      if (action === 'revisions' && parts[4] === 'restore') { const revision = records.find(r => r.id === linkedId); if (!revision) throw new Error('Revision not found'); const moment = new Date().toISOString(); records.push({ id: crypto.randomUUID(), scene_id: id, content: row.content, label: 'Before restore', word_count: wordCount(row.content), created_at: moment }); s.backup.state.scene_revision = records; row.content = revision.content; s.editedScene = id; s.edits.push({ scene_id: id, content: String(row.content ?? ''), created_at: moment }); return { word_count: wordCount(row.content), revision_created: true, annotations_reanchored: 0, annotations_orphaned: 0 } }
      const created = { ...body, ...(action === 'revisions' ? { content: row.content, label: url.searchParams.get('label'), word_count: wordCount(row.content) } : {}), id: crypto.randomUUID(), scene_id: id, created_at: new Date().toISOString() }; records.push(created); s.backup.state[table] = records; return created
    }
    if (action === 'usage') return { scenes: rows(s, 'scene').filter(scene => scene.location_id === id), events: rows(s, 'event').filter(event => event.location_id === id) }
    if (method === 'GET') return out(row, kind)
    if (method === 'PATCH') { Object.assign(row, body); return out(row, kind) }
    if (method === 'DELETE') {
      deleteEntity(s, kind, id)
      return
    }
    throw new Error('Available with a free account')
  }, method !== 'GET')
}
