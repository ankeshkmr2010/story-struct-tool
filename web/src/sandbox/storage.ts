export const SANDBOX_ID = '00000000-0000-4000-8000-000000000001'
export const FIRST_SCENE = '00000000-0000-4000-8000-000000000010'
export type Row = Record<string, unknown> & { id?: string }
export type Backup = { format: string; version: number; state: Record<string, Row[] | number>; title: string }
export type Edit = { scene_id: string; content: string; created_at: string }
export type Sandbox = { backup: Backup; created: number; step: number; skipped: boolean; completed: boolean; editedScene: string; edits: Edit[]; events: string[]; importId: string; imported?: string; importedUser?: string }
const key = 'last-lantern-v1'
let connection: Promise<IDBDatabase> | undefined
let queue: Promise<unknown> = Promise.resolve()
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('storytool-sandbox', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('stories')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => { connection = undefined; reject(new Error('Browser storage is unavailable. Enable site storage and try again.')) }
  })
}
async function read(): Promise<Sandbox | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('stories').objectStore('stories').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function write(value: Sandbox) {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('stories', 'readwrite')
    transaction.objectStore('stories').put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Your changes could not be saved in this browser. Free up storage and retry.'))
    transaction.onabort = () => reject(new Error('Browser save interrupted. Please retry.'))
  })
}
async function load() {
  const saved = await read()
  if (saved && Date.now() - saved.created < 7 * 24 * 60 * 60 * 1000) return saved
  const response = await fetch('/sandbox/last-lantern-v1.json')
  if (!response.ok) throw new Error('The sample story could not load. Please retry.')
  const backup = await response.json() as Backup
  const fresh: Sandbox = { backup, created: Date.now(), step: 1, skipped: false, completed: false, editedScene: FIRST_SCENE, edits: [], events: ['try_start'], importId: crypto.randomUUID() }
  await write(fresh)
  return fresh
}
export function sandboxData() { return transact(value => value, false) }
export function transact<T>(operation: (value: Sandbox) => T, save = true): Promise<T> {
  const execute = async () => {
    const value = await load()
    const result = operation(value)
    if (save) await write(value)
    return result
  }
  const next = queue.catch(() => {}).then(() => navigator.locks ? navigator.locks.request('storytool-sandbox', execute) : execute())
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
export function rows(value: Sandbox, kind: string): Row[] {
  const found = value.backup.state[kind]
  return Array.isArray(found) ? found : []
}
