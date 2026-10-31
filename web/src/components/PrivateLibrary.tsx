import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUiLanguage, plural, t } from '../i18n'
import { createPrivate, deletePrivate, getLinkedFile, getPrivateMeta, listPrivate, privateSize, PRIVATE_META_EVENT, PRIVATE_SAVED_EVENT, setLinkedFile, setPrivateMeta, transact, type Backup, type PrivateMeta, type PrivateSummary, type Row } from '../sandbox/storage'
import { Menu, MenuItem } from '../ui/Menu'

/**
 * Private library (roadmap): stories kept only in this browser and never sent to StoryTool's
 * servers. They run on the same in-browser engine as the /try sandbox (sandbox/adapter.ts), so
 * server features (AI, sharing, beta readers, server checks, versions, images) are off for them.
 */

const sortBy = (a: Row, b: Row) => Number(a.sort_key ?? a.number ?? 0) - Number(b.sort_key ?? b.number ?? 0)

/** The manuscript in reading order: chapters, their scenes, then unfiled scenes. */
function manuscript(state: Record<string, unknown>) {
  const table = (name: string) => (Array.isArray(state[name]) ? state[name] as Row[] : [])
  const chapters = [...table('chapter')].sort(sortBy)
  const scenes = [...table('scene')].sort(sortBy)
  const parts = chapters.map(chapter => ({ chapter, scenes: scenes.filter(scene => scene.chapter_id === chapter.id) }))
  const unfiled = scenes.filter(scene => !chapters.some(chapter => chapter.id === scene.chapter_id))
  return { title: String(table('story')[0]?.title || t('Untitled story')), parts, unfiled }
}

function asMarkdown(state: Record<string, unknown>) {
  const { title, parts, unfiled } = manuscript(state)
  const scene = (row: Row) => [row.title ? `### ${row.title}` : '', String(row.content ?? '').trim()].filter(Boolean).join('\n\n')
  return [`# ${title}`, ...parts.map(({ chapter, scenes }) => [`## ${t('Chapter {0}', String(chapter.number ?? ''))}${chapter.title ? `: ${chapter.title}` : ''}`, ...scenes.map(scene)].join('\n\n')), ...unfiled.map(scene)].join('\n\n') + '\n'
}

function asText(state: Record<string, unknown>) {
  const { title, parts, unfiled } = manuscript(state)
  const prose = (row: Row) => String(row.content ?? '').trim()
  return [title.toUpperCase(), ...parts.map(({ chapter, scenes }) => [`${t('Chapter {0}', String(chapter.number ?? ''))}${chapter.title ? `: ${chapter.title}` : ''}`, ...scenes.map(prose)].filter(Boolean).join('\n\n')), ...unfiled.map(prose)].filter(Boolean).join('\n\n\n') + '\n'
}

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fileName = (title: string) => title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'story'

/** Downloads made in the browser: nothing is uploaded. */
export function PrivateExportMenu({ storyId, beforeExport }: { storyId: string; beforeExport: () => Promise<boolean> }) {
  const [error, setError] = useState('')
  const run = async (kind: 'md' | 'txt' | 'json') => {
    setError('')
    if (!await beforeExport()) { setError(t('Your writing has not saved yet. Retry the save before exporting.')); return }
    const backup = await transact(value => value.backup, false, storyId)
    const name = fileName(String((backup.state.story as Row[] | undefined)?.[0]?.title ?? backup.title))
    if (kind === 'md') download(`${name}.md`, 'text/markdown', asMarkdown(backup.state))
    if (kind === 'txt') download(`${name}.txt`, 'text/plain', asText(backup.state))
    if (kind === 'json') await downloadBackup(storyId)
  }
  return <>
    <Menu label={t('Download')} triggerClassName="share-story-button">
      <MenuItem onSelect={() => { void run('md') }}>{t('Markdown (.md)')}</MenuItem>
      <MenuItem onSelect={() => { void run('txt') }}>{t('Plain text (.txt)')}</MenuItem>
      <MenuItem onSelect={() => { void run('json') }}>{t('Backup (.json)')}</MenuItem>
    </Menu>
    {error && <span role="alert" className="writer-error">{error}</span>}
  </>
}

type FileState = 'none' | 'linked' | 'reconnect' | 'unsupported'
type Picker = (options: object) => Promise<FileSystemFileHandle>
type Permitted = FileSystemFileHandle & { queryPermission?: (o: object) => Promise<string>; requestPermission?: (o: object) => Promise<string> }
const picker = () => (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker
const titleOf = (storyId: string) => transact(value => String((value.backup.state.story as Row[] | undefined)?.[0]?.title || value.backup.title || ''), false, storyId)

async function writeBackup(storyId: string, handle: FileSystemFileHandle) {
  const backup = await transact(value => value.backup, false, storyId)
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(backup, null, 1))
  await writable.close()
  await setPrivateMeta(storyId, { lastFileSave: new Date().toISOString() })
}

/** Downloads the JSON backup and notes when (the shelf and the backup nudge show it). */
export async function downloadBackup(storyId: string) {
  const backup = await transact(value => value.backup, false, storyId)
  download(`${fileName(await titleOf(storyId))}.storytool.json`, 'application/json', JSON.stringify(backup, null, 1))
  await setPrivateMeta(storyId, { lastBackup: new Date().toISOString() })
}

/** Picks a file, remembers it and writes the story to it now. Throws AbortError if cancelled. */
export async function linkPrivateFile(storyId: string): Promise<FileSystemFileHandle> {
  const chosen = await picker()!({ suggestedName: `${fileName(await titleOf(storyId))}.storytool.json`, types: [{ description: t('StoryTool backup'), accept: { 'application/json': ['.json'] } }] })
  await setLinkedFile(storyId, chosen)
  await writeBackup(storyId, chosen)
  return chosen
}

/** "5 minutes ago" in the interface language. */
function ago(iso: string) {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000)
  const format = new Intl.RelativeTimeFormat(getUiLanguage(), { numeric: 'auto' })
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(0, 'minute')
}

/** The newest of a linked-file save and a downloaded backup, for the shelf. */
function backupLine(meta: PrivateMeta) {
  const file = meta.lastFileSave ?? '', backup = meta.lastBackup ?? ''
  if (!file && !backup) return t('No backup yet')
  return file >= backup ? t('Saved to file {0}', ago(file)) : t('Backup downloaded {0}', ago(backup))
}

/**
 * Linked file (Chrome, Edge): every save of this private story is also written to a file the
 * writer chose, so it survives clearing the browser. The browser asks again for permission after
 * a restart, which only a click can grant: hence "Reconnect file".
 */
export function LinkedFile({ storyId }: { storyId: string }) {
  const [state, setState] = useState<FileState>(picker() ? 'none' : 'unsupported')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const handle = useRef<FileSystemFileHandle | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!picker()) return
    let alive = true
    const refresh = () => getLinkedFile(storyId).then(async found => {
      if (!alive || !found) return
      handle.current = found; setName(found.name)
      const permission = await (found as Permitted).queryPermission?.({ mode: 'readwrite' })
      setState(permission === 'granted' ? 'linked' : 'reconnect')
    })
    void refresh()
    // The backup nudge can link a file too.
    const linked = (event: Event) => { if ((event as CustomEvent<string>).detail === storyId) void refresh() }
    window.addEventListener(PRIVATE_META_EVENT, linked)
    const saved = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== storyId || !handle.current) return
      window.clearTimeout(timer.current)
      // At most one file write a second while typing.
      timer.current = window.setTimeout(() => {
        const current = handle.current
        if (!current) return
        void (current as Permitted).queryPermission?.({ mode: 'readwrite' }).then(permission => {
          if (permission !== 'granted') { setState('reconnect'); return }
          return writeBackup(storyId, current).then(() => setError(''), failure => setError(String(failure?.message ?? failure)))
        })
      }, 1000)
    }
    window.addEventListener(PRIVATE_SAVED_EVENT, saved)
    return () => { alive = false; window.removeEventListener(PRIVATE_SAVED_EVENT, saved); window.removeEventListener(PRIVATE_META_EVENT, linked); window.clearTimeout(timer.current) }
  }, [storyId])
  // Safari and Firefox cannot write to a chosen file; downloads and the backup nudge cover them.
  if (state === 'unsupported') return <span className="private-file-note">{t('Save to a file… needs Chrome or Edge. Download a backup instead.')}</span>
  const link = async () => {
    setError('')
    try {
      const chosen = await linkPrivateFile(storyId)
      handle.current = chosen; setName(chosen.name)
      setState('linked')
    } catch (failure) {
      if ((failure as Error)?.name !== 'AbortError') setError(String((failure as Error)?.message ?? failure))
    }
  }
  const reconnect = async () => {
    const current = handle.current as Permitted | null
    if (!current) return
    if (await current.requestPermission?.({ mode: 'readwrite' }) === 'granted') { await writeBackup(storyId, current); setState('linked') }
  }
  const unlink = async () => { await setLinkedFile(storyId, null); handle.current = null; setName(''); setState('none') }
  return <span className="private-file">
    {state === 'none' && <button type="button" className="share-story-button" onClick={() => { void link() }} title={t('Every save is also written to a file you choose, so the story survives clearing this browser.')}>{t('Save to a file…')}</button>}
    {state === 'reconnect' && <button type="button" className="share-story-button" onClick={() => { void reconnect() }}>{t('Reconnect file')}</button>}
    {state === 'linked' && <Menu label={t('Saving to {0}', name)} triggerClassName="private-file-linked"><MenuItem onSelect={() => { void unlink() }}>{t('Stop saving to this file')}</MenuItem></Menu>}
    {error && <span role="alert" className="writer-error">{error}</span>}
  </span>
}

/** A StoryTool backup (.json) from disk, checked before it becomes a private story. */
export async function readBackupFile(file: File): Promise<Backup> {
  let parsed: unknown
  try { parsed = JSON.parse(await file.text()) } catch { throw new Error(t('This file is not a StoryTool backup.')) }
  const backup = parsed as Backup
  const story = (backup?.state?.story as Row[] | undefined)?.[0]
  if (backup?.format !== 'storytool-backup' || !story?.id) throw new Error(t('This file is not a StoryTool backup.'))
  return backup
}

/** The private shelf on Your stories. */
export function PrivateShelf({ refresh, onCount }: { refresh: number; onCount?: (count: number) => void }) {
  const navigate = useNavigate()
  const opener = useRef<HTMLInputElement>(null)
  const [stories, setStories] = useState<PrivateSummary[] | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  useEffect(() => {
    const load = () => listPrivate().then(list => { setStories(list); onCount?.(list.length) }, failure => setError(String(failure?.message ?? failure)))
    void load()
    window.addEventListener(PRIVATE_SAVED_EVENT, load)
    window.addEventListener(PRIVATE_META_EVENT, load)
    return () => { window.removeEventListener(PRIVATE_SAVED_EVENT, load); window.removeEventListener(PRIVATE_META_EVENT, load) }
  }, [refresh, onCount])
  // Opening a backup creates a private story from it, in this browser only.
  const open = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      const backup = await readBackupFile(file)
      const story = (backup.state.story as Row[])[0]
      navigate(`/stories/${await createPrivate(String(story.title ?? backup.title ?? ''), String(story.authoring_mode ?? 'hybrid'), backup)}`)
    } catch (failure) { setError(String((failure as Error)?.message ?? failure)) }
  }
  const remove = async (id: string) => {
    if (confirming !== id) { setConfirming(id); return }
    setConfirming(null)
    await deletePrivate(id)
    const list = await listPrivate()
    setStories(list); onCount?.(list.length)
  }
  return <section className="private-shelf" aria-labelledby="private-shelf-title">
    <header><div><h2 id="private-shelf-title">{t('Private library')}</h2><p>{t('Only in this browser. Never sent to StoryTool’s servers; clearing this browser’s data deletes them, so link a file or download a backup.')}</p></div>
      <button type="button" className="ui-btn ui-btn-secondary" onClick={() => opener.current?.click()}>{t('Open backup file…')}</button>
      <input ref={opener} type="file" accept=".json,application/json" hidden onChange={event => { void open(event.target.files?.[0]); event.target.value = '' }} />
    </header>
    {stories?.length === 0 && <p className="private-shelf-empty">{t('No private stories yet. Tick Keep it private when you create one, or open a backup file.')}</p>}
    {error && <p role="alert" className="writer-error">{error}</p>}
    <ul>{stories?.map(story => <li key={story.id}>
      <Link to={`/stories/${story.id}`}><strong>{story.title || t('Untitled story')}<span className="story-card-tag private-tag">{t('Private')}</span></strong><span>{plural(story.scenes, '{0} scene', '{0} scenes', story.scenes)} · {plural(story.words, '{0} word', '{0} words', story.words.toLocaleString())} · {backupLine(story)}</span></Link>
      <button type="button" className={confirming === story.id ? 'is-confirming' : ''} onClick={() => { void remove(story.id) }} onBlur={() => setConfirming(null)}>{confirming === story.id ? t('Delete from this browser') : t('Delete')}</button>
    </li>)}</ul>
  </section>
}

const NUDGE_WORDS = 500
const NUDGE_AGE = 24 * 60 * 60 * 1000

/**
 * Backup nudge: a private story with no linked file and no downloaded backup, once it has 500
 * words or is a day old. Lives only in this browser, so one cleared cache would lose it.
 */
export function BackupNudge({ storyId }: { storyId: string }) {
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const dismissKey = `storytool-backup-nudge:${storyId}`
  useEffect(() => {
    let alive = true
    const check = async () => {
      try { if (sessionStorage.getItem(dismissKey)) { setShow(false); return } } catch { /* Optional browser storage. */ }
      const [meta, file, size] = await Promise.all([getPrivateMeta(storyId), getLinkedFile(storyId), privateSize(storyId)])
      if (alive) setShow(!meta.lastFileSave && !meta.lastBackup && !file && (size.words >= NUDGE_WORDS || Date.now() - size.created >= NUDGE_AGE))
    }
    void check()
    window.addEventListener(PRIVATE_SAVED_EVENT, check)
    window.addEventListener(PRIVATE_META_EVENT, check)
    return () => { alive = false; window.removeEventListener(PRIVATE_SAVED_EVENT, check); window.removeEventListener(PRIVATE_META_EVENT, check) }
  }, [storyId, dismissKey])
  if (!show) return null
  const act = async (run: () => Promise<unknown>) => {
    setError('')
    try { await run() } catch (failure) { if ((failure as Error)?.name !== 'AbortError') setError(String((failure as Error)?.message ?? failure)) }
  }
  return <div className="backup-nudge" role="status">
    <span>{t('This story is only in this browser, with no backup yet. Clearing the browser’s data would delete it.')}</span>
    <span className="backup-nudge-actions">
      {picker() && <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { void act(() => linkPrivateFile(storyId)) }}>{t('Save to a file…')}</button>}
      <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { void act(() => downloadBackup(storyId)) }}>{t('Download backup')}</button>
      <button type="button" className="backup-nudge-later" onClick={() => { try { sessionStorage.setItem(dismissKey, '1') } catch { /* Optional browser storage. */ } setShow(false) }}>{t('Not now')}</button>
    </span>
    {error && <span role="alert" className="writer-error">{error}</span>}
  </div>
}

export async function createPrivateStory(title: string, mode: string) {
  return createPrivate(title.trim(), mode)
}
