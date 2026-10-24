import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Story, type DocxImport, type ImportFormat } from '../api/client'
import { errorText } from '../api/errors'
import { StorySharing } from '../components/StorySharing'
import { WordImportDialog } from '../components/WordImportDialog'
import { SearchDialog } from '../components/StorySearch'
import { Menu, MenuItem } from '../ui/Menu'
import { getUiLanguage, t } from '../i18n'

// Library cards show when a story was last touched rather than a completeness bar.
function editedLabel(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return t('Edited just now')
  if (minutes < 60) return t('Edited {0} min ago', minutes)
  if (minutes < 60 * 24) return t('Edited {0} h ago', Math.round(minutes / 60))
  return t('Edited {0}', new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))
}

// Seeded study examples and the tutorial are marked so they read as practice material.
function exampleTag(story: Story) {
  if (story.genre === 'Tutorial · timelines and arcs') return t('Tutorial')
  if (story.genre?.endsWith('original study outline')) return t('Example')
  return null
}

export default function StoryList() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser })
  const [searchOpen, setSearchOpen] = useState(() => {
    try { return localStorage.getItem('storytool-library-search-open') === 'true' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem('storytool-library-search-open', String(searchOpen)) } catch { /* Optional browser storage. */ } }, [searchOpen])
  const [title, setTitle] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Story | null>(null)
  const [pendingPurge, setPendingPurge] = useState<Story | null>(null)
  const [purgeConfirmation, setPurgeConfirmation] = useState('')
  const purgeDialog = useRef<HTMLDialogElement>(null)
  const [message, setMessage] = useState('')
  const confirmDialog = useRef<HTMLDialogElement>(null)
  const trashToggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (pendingDelete) confirmDialog.current?.showModal()
    else confirmDialog.current?.close()
  }, [pendingDelete])
  useEffect(() => {
    if (pendingPurge) purgeDialog.current?.showModal()
    else purgeDialog.current?.close()
  }, [pendingPurge])

  const stories = useQuery({ queryKey: ['stories'], queryFn: api.listStories, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const feedbackCounts = useQuery({ queryKey: ['beta-feedback-counts'], queryFn: api.betaFeedbackCounts, refetchInterval: 60_000, refetchOnWindowFocus: true })
  const lastPlace = useQuery({ queryKey: ['workspace-position', 'latest'], queryFn: api.getLatestWorkspacePosition, refetchOnWindowFocus: true })
  const trash = useQuery({ queryKey: ['trashed-stories'], queryFn: api.listTrashedStories })
  const shared = useQuery({ queryKey: ['shared-stories'], queryFn: api.listSharedStories, refetchInterval: 30_000, refetchOnWindowFocus: true })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['stories'] })
    void qc.invalidateQueries({ queryKey: ['trashed-stories'] })
  }

  const create = useMutation({
    mutationFn: () => api.createStory({ title }),
    onSuccess: () => {
      setTitle('')
      void qc.invalidateQueries({ queryKey: ['stories'] })
    },
  })

  const backupInput = useRef<HTMLInputElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFormat, setImportFormat] = useState<ImportFormat>('docx')
  const [promptStory, setPromptStory] = useState<Story | null>(null)
  const libraryStories = stories.data ? [...stories.data].sort((a, b) =>
    Number(b.prose_imported) - Number(a.prose_imported)
    || (a.prose_imported && b.prose_imported ? Date.parse(b.updated_at) - Date.parse(a.updated_at) : 0)
  ) : undefined
  const importBackup = useMutation({
    mutationFn: async (file: File) => {
      let backup: unknown
      try { backup = JSON.parse(await file.text()) } catch { throw new Error(t('That file is not a StoryTool backup.')) }
      return api.importBackup(backup)
    },
    onSuccess: (story) => {
      setMessage(t('“{0}” restored from backup as a new story.', story.title))
      void qc.invalidateQueries({ queryKey: ['stories'] })
    },
  })

  const remove = useMutation({
    mutationFn: api.deleteStory,
    onSuccess: () => {
      setMessage(t('“{0}” moved to Trash. Its contents and versions are preserved.', pendingDelete?.title))
      setPendingDelete(null)
      refresh()
      window.setTimeout(() => trashToggle.current?.focus(), 0)
    },
  })
  const restore = useMutation({
    mutationFn: api.restoreStory,
    onSuccess: (story) => {
      setMessage(t('“{0}” restored to your library.', story.title))
      refresh()
    },
  })
  const purge = useMutation({ mutationFn: api.purgeStory, onSuccess: () => {
    setMessage(t('“{0}” permanently deleted from the database.', pendingPurge?.title))
    setPendingPurge(null); setPurgeConfirmation(''); refresh()
    void qc.invalidateQueries({ queryKey: ['oauth-grants'] })
    void qc.invalidateQueries({ queryKey: ['agent-tokens'] })
    window.setTimeout(() => trashToggle.current?.focus(), 0)
  } })

  return (
    <main className="mx-auto max-w-[1200px] p-5 sm:p-8">
      <div className={showTrash ? '' : 'library-with-search'}>
      {!showTrash && <aside className="library-search" aria-label={t('Search your stories')}><h2>{t('Search your stories')}</h2><button type="button" className="search-launcher" aria-haspopup="dialog" onClick={() => setSearchOpen(true)}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><span>{t('Find a name, phrase or idea…')}</span></button></aside>}
      {me.data && <SearchDialog storyId="" accountId={me.data.id} context="all" active={searchOpen && !showTrash} onClose={() => setSearchOpen(false)} onReopen={() => setSearchOpen(true)} onOpen={async hit => {
        await api.searchTarget(hit.story_id, hit)
        document.querySelector<HTMLDialogElement>('dialog.story-search-dialog')?.close()
        const params = new URLSearchParams({ search_entity: hit.entity, search_id: hit.id, search_field: hit.matches.some(match => match.field === 'content') ? 'content' : hit.matches[0]?.field || 'title' })
        navigate(`/stories/${hit.story_id}?${params}`)
      }} />}
      <div className="min-w-0">
      <div className="page-heading"><h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{showTrash ? t('Trash') : t('Your stories')}</h1><button ref={trashToggle} type="button" onClick={() => setShowTrash(!showTrash)} className="shrink-0 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm">{showTrash ? t('Back to library') : t('Trash{0}', trash.data?.length ? ` (${trash.data.length})` : '')}</button></div>
      {message && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {showTrash && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t('Restore a story to keep working, or delete it permanently to remove its contents and version history from the database.')}</p>}
      {!showTrash && <>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t('Build your story from its first idea to its individual scenes. Start with a title and fill in the rest as you go.')}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        {t('Your library includes editable study examples and an original timeline-and-arc tutorial. Each account has its own copies.')}
      </p>
      {lastPlace.data && <div className="ui-card mt-4 flex flex-wrap items-center justify-between gap-3" role="status">
        <div className="min-w-0"><p className="text-sm font-semibold">{t('Pick up where you left off')}</p><p className="truncate text-sm text-slate-500 dark:text-slate-400">{lastPlace.data.title} · {{ write: t('Writing'), read: t('Reading'), design: t('Designing') }[lastPlace.data.position.mode ?? 'design']}</p></div>
        <Link to={`/stories/${lastPlace.data.story_id}`} className="ui-btn ui-btn-primary">{t('Resume')}</Link>
      </div>}
      {stories.data?.find((story) => story.genre === 'Tutorial · timelines and arcs') && <Link to={`/stories/${stories.data.find((story) => story.genre === 'Tutorial · timelines and arcs')!.id}`} className="mt-4 inline-block rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 px-4 py-2 text-sm text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950">{t('Learn timelines and arcs with The Last Lantern →')}</Link>}

      <form
        className="library-create mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) create.mutate()
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
          placeholder={t('Story title')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="submit"
          disabled={!title.trim() || create.isPending}
          className="rounded bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm text-white dark:text-slate-950 disabled:opacity-40"
        >
          {t('Create')}
        </button>
        {/* Other ways to start a story live behind ▾ beside Create. */}
        <Menu label={importBackup.isPending || importOpen ? '…' : '▾'} ariaLabel={t('More ways to start a story')} className="library-create-more" triggerClassName="ui-btn ui-btn-secondary">
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Restore a StoryTool backup file as a new story')} onSelect={() => backupInput.current?.click()}>{t('From backup…')}</MenuItem>
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Import a Word manuscript and choose how it splits')} onSelect={() => { setPromptStory(null); setImportFormat('docx'); setImportOpen(true) }}>{t('From Word (.docx)…')}</MenuItem>
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Import a zipped .scriv project: Draft folders become chapters, documents become scenes')} onSelect={() => { setPromptStory(null); setImportFormat('scrivener'); setImportOpen(true) }}>{t('From Scrivener (.zip)…')}</MenuItem>
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Import a Markdown or plain-text manuscript')} onSelect={() => { setPromptStory(null); setImportFormat('text'); setImportOpen(true) }}>{t('From Markdown or text…')}</MenuItem>
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Import a DRM-free EPUB book')} onSelect={() => { setPromptStory(null); setImportFormat('epub'); setImportOpen(true) }}>{t('From EPUB…')}</MenuItem>
        </Menu>
        <input
          ref={backupInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) importBackup.mutate(file)
          }}
        />
      </form>
      {importBackup.isError && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{errorText(importBackup.error)}</p>}
      </>}

      {stories.isPending && <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">{t('Loading…')}</p>}
      <WordImportDialog open={importOpen} format={importFormat} story={promptStory} defaultTitle={title} onClose={() => setImportOpen(false)} onImported={(result: DocxImport) => {
        setTitle('')
        qc.setQueryData<Story[]>(['stories'], (current) => [
          { ...result.story, word_count: result.word_count }, ...(current ?? []).filter((item) => item.id !== result.story.id),
        ])
        void qc.invalidateQueries({ queryKey: ['stories'] })
      }} />
      {stories.isError && (
        <p className="mt-6 text-sm text-red-600 dark:text-red-300">{(stories.error as Error).message}</p>
      )}

      <ul className="story-library mt-6">
        {(showTrash ? trash.data : libraryStories)?.map((story) => (
          <li key={story.id} className="story-card">
            <div className="min-w-0">
              {showTrash ? <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{story.title}</p> : <Link
                to={`/stories/${story.id}`}
                className="story-card-title"
              >
                {story.title}
              </Link>}
              {exampleTag(story) && <span className="story-card-tag">{exampleTag(story)}</span>}
              {story.prose_imported && <span className="story-card-tag">{t('Imported')}</span>}
              <p className="truncate text-xs text-slate-400">
                {story.premise ?? t('no premise yet')}
              </p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('{0} words · {1}', story.word_count.toLocaleString(getUiLanguage()), editedLabel(story.updated_at))}</p>
              {!showTrash && story.prose_imported && <button type="button" className="mt-2 text-xs text-[var(--accent)] underline" onClick={() => { setPromptStory(story); setImportOpen(true) }}>{t('Import prompts →')}</button>}
            </div>
            {showTrash ? <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={restore.isPending || purge.isPending} onClick={() => restore.mutate(story.id)} className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1 text-sm disabled:opacity-50">{t('Restore')}</button><button type="button" disabled={restore.isPending || purge.isPending} onClick={() => { purge.reset(); setPurgeConfirmation(''); setPendingPurge(story) }} className="text-xs text-red-700 dark:text-red-300">{t('Delete permanently')}</button></div> : <div className="story-card-actions"><StorySharing storyId={story.id} title={story.title} blurb={story.blurb} betaOpen={feedbackCounts.data?.[story.id] ?? 0} />{/* Delete stays one step away so it is not as prominent as Share. */}<Menu label="⋯" ariaLabel={t('More actions for {0}', story.title)} triggerClassName="ui-btn ui-btn-ghost ui-btn-sm"><MenuItem className="is-danger" onSelect={() => { remove.reset(); setPendingDelete(story) }}>{t('Delete')}</MenuItem></Menu></div>}
          </li>
        ))}
      </ul>

      {!showTrash && <section className="shared-library" aria-labelledby="shared-library-title"><h2 id="shared-library-title">{t('Shared with you')}</h2><p className="writer-help">{t('Read stories shared with your sign-in email. Authors decide whether you can import an independent copy.')}</p>{shared.isPending && <p className="writer-help">{t('Loading shared stories…')}</p>}{shared.isError && <p role="alert" className="writer-error">{(shared.error as Error).message}</p>}{shared.data?.length === 0 && <p className="writer-help">{t('No stories have been shared with you yet.')}</p>}<ul className="story-library">{shared.data?.map(item => <li key={item.beta_round_id || item.story_id} className="story-card"><div><Link className="story-card-title" to={item.beta_round_id ? `/beta/rounds/${item.beta_round_id}` : `/shared/${item.story_id}`}>{item.title}</Link>{item.blurb && <p className="shared-reader-blurb">{item.blurb}</p>}<p className="writer-help">{t('By {0} · {1}', item.owner_name, item.beta_round_id ? t('Beta round') : item.allow_import ? t('Read and import') : t('Read only'))}</p></div><Link className="share-story-button" to={item.beta_round_id ? `/beta/rounds/${item.beta_round_id}` : `/shared/${item.story_id}`}>{t('Read story')}</Link></li>)}</ul></section>}

      {showTrash && trash.isPending && <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">{t('Loading Trash…')}</p>}
      {(trash.isError || restore.isError) && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-300">{String(trash.error ?? restore.error)}</p>}
      {(showTrash ? trash.data : stories.data)?.length === 0 && <p className="mt-6 text-sm text-slate-400">{showTrash ? t('Trash is empty.') : t('No stories yet.')}</p>}
      <dialog ref={confirmDialog} role="alertdialog" aria-labelledby="delete-story-title" aria-describedby="delete-story-description" onCancel={(event) => { event.preventDefault(); if (!remove.isPending) setPendingDelete(null) }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <h2 id="delete-story-title" className="text-lg font-semibold">{t('Move story to Trash?')}</h2>
        <p id="delete-story-description" className="mt-3 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">{t('“{0}” will leave your library. All its prose, characters, structure, and version history will be preserved. You can restore it from Trash.', pendingDelete?.title)}</p>
        {remove.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{t('Could not move the story. Please try again.')}</p>}
        <div className="mt-5 flex justify-end gap-3"><button type="button" autoFocus disabled={remove.isPending} onClick={() => setPendingDelete(null)} className="rounded border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm">{t('Cancel')}</button><button type="button" disabled={remove.isPending || !pendingDelete} onClick={() => { if (pendingDelete) remove.mutate(pendingDelete.id) }} className="rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50">{remove.isPending ? t('Moving…') : t('Move to Trash')}</button></div>
      </dialog>
      <dialog ref={purgeDialog} role="alertdialog" aria-labelledby="purge-story-title" aria-describedby="purge-story-description" onCancel={event => { event.preventDefault(); if (!purge.isPending) setPendingPurge(null) }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <h2 id="purge-story-title" className="text-lg font-semibold">{t('Delete story permanently?')}</h2>
        <p id="purge-story-description" className="mt-3 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">{t('“{0}” and its prose, characters, structure, notes, versions, AI history, and story-specific connections will be removed from the database. This cannot be undone in StoryTool.', pendingPurge?.title)}</p>
        <label className="mt-4 block text-sm">{t('Type DELETE to confirm')}<input aria-label={t('Permanent deletion confirmation')} autoComplete="off" value={purgeConfirmation} disabled={purge.isPending} onChange={event => setPurgeConfirmation(event.target.value)} className="mt-2 w-full rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /></label>
        {purge.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{String(purge.error)}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" autoFocus disabled={purge.isPending} onClick={() => setPendingPurge(null)} className="rounded border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm">{t('Cancel')}</button><button type="button" disabled={purge.isPending || purgeConfirmation !== 'DELETE'} onClick={() => { if (pendingPurge) purge.mutate({ id: pendingPurge.id, expected_title: pendingPurge.title, confirmation: 'DELETE' }) }} className="rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50">{purge.isPending ? t('Deleting…') : t('Delete permanently')}</button></div>
      </dialog>
      </div></div>
    </main>
  )
}
