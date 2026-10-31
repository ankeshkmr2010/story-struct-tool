import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { t } from '../i18n'
import { createPrivate, deletePrivate, listPrivate, PRIVATE_SAVED_EVENT, transact, type PrivateSummary, type Row } from '../sandbox/storage'
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
    if (kind === 'json') download(`${name}.storytool.json`, 'application/json', JSON.stringify(backup, null, 1))
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

/** The private shelf on Your stories. */
export function PrivateShelf({ refresh }: { refresh: number }) {
  const [stories, setStories] = useState<PrivateSummary[] | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  useEffect(() => {
    const load = () => listPrivate().then(setStories, failure => setError(String(failure?.message ?? failure)))
    void load()
    window.addEventListener(PRIVATE_SAVED_EVENT, load)
    return () => window.removeEventListener(PRIVATE_SAVED_EVENT, load)
  }, [refresh])
  if (!stories?.length && !error) return null
  const remove = async (id: string) => {
    if (confirming !== id) { setConfirming(id); return }
    setConfirming(null)
    await deletePrivate(id)
    setStories(await listPrivate())
  }
  return <section className="private-shelf" aria-labelledby="private-shelf-title">
    <header><h2 id="private-shelf-title">{t('Private library')}</h2><p>{t('Only in this browser. Never sent to StoryTool’s servers; clearing this browser’s data deletes them, so download a backup now and then.')}</p></header>
    {error && <p role="alert" className="writer-error">{error}</p>}
    <ul>{stories?.map(story => <li key={story.id}>
      <Link to={`/stories/${story.id}`}><strong>{story.title || t('Untitled story')}</strong><span>{t('{0} scenes · {1} words', story.scenes, story.words.toLocaleString())}</span></Link>
      <button type="button" className={confirming === story.id ? 'is-confirming' : ''} onClick={() => { void remove(story.id) }} onBlur={() => setConfirming(null)}>{confirming === story.id ? t('Delete from this browser') : t('Delete')}</button>
    </li>)}</ul>
  </section>
}

export async function createPrivateStory(title: string, mode: string) {
  return createPrivate(title.trim(), mode)
}
