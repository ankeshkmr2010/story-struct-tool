import { t } from '../i18n'
export const SANDBOX_ID = '00000000-0000-4000-8000-000000000001'
export const FIRST_SCENE = '00000000-0000-4000-8000-000000000010'
export type Row = Record<string, unknown> & { id?: string }
export type Backup = { format: string; version: number; state: Record<string, Row[] | number>; title: string }
export type Edit = { scene_id: string; content: string; created_at: string }
export type Sandbox = { backup: Backup; created: number; step: number; doneSteps?: number[]; skipped: boolean; completed: boolean; editedScene: string; edits: Edit[]; events: string[]; importId: string; imported?: string; importedUser?: string }
const key = 'last-lantern-v1'
/** Private library: stories kept only in this browser. Their ids start with this marker. */
export const PRIVATE_PREFIX = 'ffffffff-'
export const isPrivateId = (id?: string | null) => !!id && id.startsWith(PRIVATE_PREFIX)
/** Stories answered in the browser (the /try sandbox and the private library): no server features. */
export const isLocalStory = (id?: string | null) => id === SANDBOX_ID || isPrivateId(id)
const storeKey = (storyId: string) => storyId === SANDBOX_ID ? key : `private:${storyId}`
let connection: Promise<IDBDatabase> | undefined
let queue: Promise<unknown> = Promise.resolve()
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('storytool-sandbox', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('stories')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => { connection = undefined; reject(new Error(t('Browser storage is unavailable. Enable site storage and try again.'))) }
  })
}
async function read(name = key): Promise<Sandbox | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('stories').objectStore('stories').get(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function write(value: Sandbox, name = key) {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('stories', 'readwrite')
    transaction.objectStore('stories').put(value, name)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error(t('Your changes could not be saved in this browser. Free up storage and retry.')))
    transaction.onabort = () => reject(new Error(t('Browser save interrupted. Please retry.')))
  })
}
async function load(storyId = SANDBOX_ID) {
  if (isPrivateId(storyId)) {
    const story = await read(storeKey(storyId))
    if (!story) throw new Error(t('This private story is not in this browser.'))
    return story
  }
  const saved = await read()
  if (saved && Date.now() - saved.created < 7 * 24 * 60 * 60 * 1000) return saved
  const response = await fetch('/sandbox/last-lantern-v1.json')
  if (!response.ok) throw new Error(t('The sample story could not load. Please retry.'))
  const backup = await response.json() as Backup
  const fresh: Sandbox = { backup, created: Date.now(), step: 1, skipped: false, completed: false, editedScene: FIRST_SCENE, edits: [], events: ['try_start'], importId: crypto.randomUUID() }
  await write(fresh)
  return fresh
}
export function sandboxData() { return transact(value => value, false) }
export function transact<T>(operation: (value: Sandbox) => T, save = true, storyId = SANDBOX_ID): Promise<T> {
  const execute = async () => {
    const value = await load(storyId)
    const result = operation(value)
    if (save && isPrivateId(storyId)) { const story = rows(value, 'story')[0]; if (story) story.updated_at = new Date().toISOString() }
    if (save) await write(value, storeKey(storyId))
    if (save && isPrivateId(storyId)) window.dispatchEvent(new CustomEvent(PRIVATE_SAVED_EVENT, { detail: storyId }))
    return result
  }
  // One browser lock per story, so two open tabs never overwrite each other's edits.
  const lock = storyId === SANDBOX_ID ? 'storytool-sandbox' : `storytool-private:${storyId}`
  const next = queue.catch(() => {}).then(async () => await (navigator.locks ? navigator.locks.request(lock, execute) : execute()))
  queue = next
  return next
}
export async function resetSandbox() {
  await transact(value => { value.created = 0 })
  for (const store of [localStorage, sessionStorage]) for (const name of Object.keys(store)) {
    if (name.includes(SANDBOX_ID)) store.removeItem(name)
  }
  await sandboxData()
}
export function tourEvent(name: string) {
  window.dispatchEvent(new CustomEvent('storytool-try-event', { detail: name }))
}
export const PRIVATE_SAVED_EVENT = 'storytool:private-saved'
export const PRIVATE_META_EVENT = 'storytool:private-meta'
/** When a private story last reached disk: its linked file, or a downloaded backup. */
export type PrivateMeta = { lastFileSave?: string; lastBackup?: string }
export type PrivateSummary = { id: string; title: string; updated: string; created: number; scenes: number; words: number } & PrivateMeta

const wordsIn = (value: Sandbox) => rows(value, 'scene').reduce((sum, scene) => sum + String(scene.content ?? '').trim().split(/\s+/).filter(Boolean).length, 0)

/** Kept beside the story, not in it: recording a file save must not count as an edit (and re-save). */
export async function getPrivateMeta(id: string): Promise<PrivateMeta> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('stories').objectStore('stories').get(`meta:${id}`)
    request.onsuccess = () => resolve(request.result ?? {})
    request.onerror = () => reject(request.error)
  })
}

export async function setPrivateMeta(id: string, change: PrivateMeta) {
  const next = { ...await getPrivateMeta(id), ...change }
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('stories', 'readwrite')
    transaction.objectStore('stories').put(next, `meta:${id}`)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  window.dispatchEvent(new CustomEvent(PRIVATE_META_EVENT, { detail: id }))
}

/** Words and age of one private story, for the backup nudge. */
export async function privateSize(id: string) {
  const value = await read(storeKey(id))
  return { words: value ? wordsIn(value) : 0, created: value?.created ?? Date.now() }
}

/** The private library shelf: every private story in this browser, newest first. */
export async function listPrivate(): Promise<PrivateSummary[]> {
  const db = await database()
  const found: PrivateSummary[] = await new Promise((resolve, reject) => {
    const out: PrivateSummary[] = []
    const metas: Record<string, PrivateMeta> = {}
    const request = db.transaction('stories').objectStore('stories').openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { resolve(out.map(story => ({ ...story, ...metas[story.id] }))); return }
      const name = String(cursor.key)
      if (name.startsWith('meta:')) metas[name.slice(5)] = cursor.value as PrivateMeta
      if (name.startsWith('private:')) {
        const value = cursor.value as Sandbox
        const story = rows(value, 'story')[0] ?? {}
        out.push({ id: String(story.id), title: String(story.title ?? ''), updated: String(story.updated_at ?? new Date(value.created).toISOString()), created: value.created, scenes: rows(value, 'scene').length, words: wordsIn(value) })
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
  return found.sort((a, b) => b.updated.localeCompare(a.updated))
}

export async function createPrivate(title: string, mode: string, backup?: Backup): Promise<string> {
  const id = PRIVATE_PREFIX + crypto.randomUUID().slice(PRIVATE_PREFIX.length)
  const now = new Date().toISOString()
  const fresh: Backup = backup ? rehome(backup, id) : { format: 'storytool-backup', version: 1, title, state: { format_version: 1, story: [{ id, title, premise: null, authoring_mode: mode, structure_framework: 'three_act', created_at: now, updated_at: now }] } }
  await write({ backup: fresh, created: Date.now(), step: 0, skipped: true, completed: true, editedScene: '', edits: [], events: [], importId: crypto.randomUUID() }, storeKey(id))
  // Ask the browser not to evict this storage under pressure (granted silently in most browsers).
  void navigator.storage?.persist?.().catch(() => false)
  return id
}

/** The file a private story also saves to (Private library, linked file). Handles survive reloads. */
export async function getLinkedFile(id: string): Promise<FileSystemFileHandle | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('stories').objectStore('stories').get(`file:${id}`)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function setLinkedFile(id: string, handle: FileSystemFileHandle | null) {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('stories', 'readwrite')
    if (handle) transaction.objectStore('stories').put(handle, `file:${id}`)
    else transaction.objectStore('stories').delete(`file:${id}`)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function deletePrivate(id: string) {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('stories', 'readwrite')
    transaction.objectStore('stories').delete(storeKey(id))
    transaction.objectStore('stories').delete(`file:${id}`)
    transaction.objectStore('stories').delete(`meta:${id}`)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

/** A backup's rows, moved onto a new private story id (other ids are kept: they are unique already). */
function rehome(backup: Backup, id: string): Backup {
  const old = String((backup.state.story as Row[] | undefined)?.[0]?.id ?? '')
  const state = JSON.parse(JSON.stringify(backup.state).replaceAll(old, id)) as Backup['state']
  return { ...backup, state }
}

export function rows(value: Sandbox, kind: string): Row[] {
  const found = value.backup.state[kind]
  return Array.isArray(found) ? found : []
}
