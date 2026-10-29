import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Story, type DocxImport, type ImportFormat, type LibraryCardState, type LibraryCardUpdate, type LibraryOverview } from '../api/client'
import { errorText } from '../api/errors'
import { StorySharing } from '../components/StorySharing'
import { WordImportDialog } from '../components/WordImportDialog'
import { SearchDialog } from '../components/StorySearch'
import { Menu, MenuItem } from '../ui/Menu'
import { getUiLanguage, t } from '../i18n'
import { ContinueCard, OpenItemsPanel, StatusChip, WeekPanel, coverTint } from '../components/LibraryParts'

type SortMode = 'mine' | 'edited' | 'title'
const SORT_KEY = 'storytool-library-sort'

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
  const overview = useQuery({ queryKey: ['library-overview'], queryFn: api.libraryOverview, refetchOnWindowFocus: true })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['stories'] })
    void qc.invalidateQueries({ queryKey: ['trashed-stories'] })
    void qc.invalidateQueries({ queryKey: ['library-overview'] })
  }
  const [sort, setSortState] = useState<SortMode>(() => {
    try { const saved = localStorage.getItem(SORT_KEY); return saved === 'edited' || saved === 'title' ? saved : 'mine' } catch { return 'mine' }
  })
  const setSort = (value: SortMode) => { setSortState(value); try { localStorage.setItem(SORT_KEY, value) } catch { /* Optional browser storage. */ } }
  const cardOf = (id: string): LibraryCardState | undefined => overview.data?.cards.find(card => card.story_id === id)
  // Arranging is optimistic: the grid moves at once and the server catches up.
  const arrange = useMutation({
    mutationFn: (changes: [string, LibraryCardUpdate][]) => Promise.all(changes.map(([id, body]) => api.updateLibraryCard(id, body))),
    onMutate: (changes) => {
      qc.setQueryData<LibraryOverview>(['library-overview'], current => current && { ...current, cards: current.cards.map(card => {
        const change = changes.find(([id]) => id === card.story_id)?.[1]
        return change ? { ...card, ...change } : card
      }) })
    },
    onError: (error) => setMessage(errorText(error)),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['library-overview'] }) },
  })
  const [dragged, setDragged] = useState<string | null>(null)
  const newTitle = useRef<HTMLInputElement>(null)

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
  const defaultOrder = stories.data ? [...stories.data].sort((a, b) =>
    Number(b.prose_imported) - Number(a.prose_imported)
    || (a.prose_imported && b.prose_imported ? Date.parse(b.updated_at) - Date.parse(a.updated_at) : 0)
  ) : undefined
  // Pinned stories first; then your own order (unplaced cards keep the default order), last edited or title.
  const rank = (story: Story) => cardOf(story.id)?.position ?? 1e9 + (defaultOrder?.indexOf(story) ?? 0)
  const ordered = defaultOrder && [...defaultOrder].sort((a, b) =>
    Number(cardOf(b.id)?.pinned ?? false) - Number(cardOf(a.id)?.pinned ?? false)
    || (sort === 'edited' ? Date.parse(b.updated_at) - Date.parse(a.updated_at) : sort === 'title' ? a.title.localeCompare(b.title, getUiLanguage()) : rank(a) - rank(b)))
  const libraryStories = ordered?.filter(story => !cardOf(story.id)?.archived)
  const archivedStories = ordered?.filter(story => cardOf(story.id)?.archived)
  // Moving a card renumbers the visible cards in steps of 100 and saves only those that changed.
  const moveCard = (id: string, target: number) => {
    if (!libraryStories) return
    const ids = libraryStories.map(story => story.id).filter(item => item !== id)
    ids.splice(Math.max(0, Math.min(target, ids.length)), 0, id)
    arrange.mutate(ids.map((item, index): [string, LibraryCardUpdate] => [item, { position: (index + 1) * 100 }]).filter(([item, body]) => cardOf(item)?.position !== body.position))
  }
  const lastStory = lastPlace.data && stories.data?.find(story => story.id === lastPlace.data!.story_id)
  const totals = (overview.data?.cards ?? []).reduce((sum, card) => ({ tks: sum.tks + card.tk_count, agent: sum.agent + card.pending_agent_changes }), { tks: 0, agent: 0 })
  const comments = Object.values(feedbackCounts.data ?? {}).reduce((sum, count) => sum + count, 0)
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

  // One library card. Arranging (drag, move) works in My order; archived cards only pin, unarchive or trash.
  const renderCard = (story: Story, index: number, count: number) => {
    const card = cardOf(story.id)
    const movable = sort === 'mine' && !card?.archived && count > 1
    return <li key={story.id} className={`story-card lib-card${dragged === story.id ? ' is-dragging' : ''}`}
      draggable={movable}
      onDragStart={event => { setDragged(story.id); event.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => setDragged(null)}
      onDragOver={event => { if (movable && dragged && dragged !== story.id) event.preventDefault() }}
      onDrop={event => { event.preventDefault(); if (dragged && dragged !== story.id) moveCard(dragged, index); setDragged(null) }}>
      <Link to={`/stories/${story.id}`} className={`lib-cover ${coverTint(story.id)}`} tabIndex={-1} aria-hidden="true" draggable={false}>{story.title}</Link>
      <div className="min-w-0 lib-card-body">
        <div className="lib-card-tags">
          {card && <StatusChip status={card.status} />}
          {card?.pinned && <span className="lib-chip">{t('Pinned')}</span>}
          {exampleTag(story) && <span className="story-card-tag">{exampleTag(story)}</span>}
          {story.prose_imported && <span className="story-card-tag">{t('Imported')}</span>}
        </div>
        <Link to={`/stories/${story.id}`} className="story-card-title" draggable={false}>{story.title}</Link>
        <p className="truncate text-xs text-slate-400">{story.premise ?? t('no premise yet')}</p>
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('{0} words · {1}', story.word_count.toLocaleString(getUiLanguage()), editedLabel(story.updated_at))}</p>
        {story.prose_imported && <button type="button" className="mt-2 text-xs text-[var(--accent)] underline" onClick={() => { setPromptStory(story); setImportOpen(true) }}>{t('Import prompts →')}</button>}
      </div>
      <div className="story-card-actions"><StorySharing storyId={story.id} title={story.title} blurb={story.blurb} betaOpen={feedbackCounts.data?.[story.id] ?? 0} />{/* Delete stays one step away so it is not as prominent as Share. */}<Menu label="⋯" ariaLabel={t('More actions for {0}', story.title)} triggerClassName="ui-btn ui-btn-ghost ui-btn-sm">
        <MenuItem onSelect={() => arrange.mutate([[story.id, { pinned: !card?.pinned }]])}>{card?.pinned ? t('Unpin') : t('Pin to top')}</MenuItem>
        {movable && index > 0 && <MenuItem onSelect={() => moveCard(story.id, index - 1)}>{t('Move earlier')}</MenuItem>}
        {movable && index < count - 1 && <MenuItem onSelect={() => moveCard(story.id, index + 1)}>{t('Move later')}</MenuItem>}
        <MenuItem onSelect={() => { arrange.mutate([[story.id, { archived: !card?.archived }]]); setMessage(card?.archived ? t('“{0}” is back in your stories.', story.title) : t('“{0}” archived. Find it under Archived at the end of your stories.', story.title)) }}>{card?.archived ? t('Unarchive') : t('Archive')}</MenuItem>
        <MenuItem className="is-danger" onSelect={() => { remove.reset(); setPendingDelete(story) }}>{t('Delete')}</MenuItem>
      </Menu></div>
    </li>
  }

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
      <div className="page-heading lib-heading"><h1>{showTrash ? t('Trash') : t('Your stories')}</h1><div className="lib-heading-actions">{!showTrash && <>
        <Menu label={importBackup.isPending || importOpen ? t('Importing…') : t('Import')} ariaLabel={t('More ways to start a story')} triggerClassName="ui-btn ui-btn-secondary">
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Restore a StoryTool backup file as a new story')} onSelect={() => backupInput.current?.click()}>{t('From backup…')}</MenuItem>
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Import a Word manuscript and choose how it splits')} onSelect={() => { setPromptStory(null); setImportFormat('docx'); setImportOpen(true) }}>{t('From Word (.docx)…')}</MenuItem>
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Import a zipped .scriv project: Draft folders become chapters, documents become scenes')} onSelect={() => { setPromptStory(null); setImportFormat('scrivener'); setImportOpen(true) }}>{t('From Scrivener (.zip)…')}</MenuItem>
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Import a Markdown or plain-text manuscript')} onSelect={() => { setPromptStory(null); setImportFormat('text'); setImportOpen(true) }}>{t('From Markdown or text…')}</MenuItem>
          <MenuItem disabled={importBackup.isPending || importOpen} title={t('Import a DRM-free EPUB book')} onSelect={() => { setPromptStory(null); setImportFormat('epub'); setImportOpen(true) }}>{t('From EPUB…')}</MenuItem>
        </Menu>
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => { newTitle.current?.focus(); newTitle.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}>{t('+ New story')}</button>
      </>}<button ref={trashToggle} type="button" onClick={() => setShowTrash(!showTrash)} className="shrink-0 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm">{showTrash ? t('Back to library') : t('Trash{0}', trash.data?.length ? ` (${trash.data.length})` : '')}</button></div></div>
      {message && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {showTrash && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t('Restore a story to keep working, or delete it permanently to remove its contents and version history from the database.')}</p>}
      {!showTrash && <>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t('Build your story from its first idea to its individual scenes. Start with a title and fill in the rest as you go.')}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        {t('Your library includes editable study examples and an original timeline-and-arc tutorial. Each account has its own copies.')}
      </p>
      {lastPlace.data && <ContinueCard storyId={lastPlace.data.story_id} title={lastPlace.data.title} mode={{ write: t('Writing'), read: t('Reading'), design: t('Designing') }[lastPlace.data.position.mode ?? 'design']} edited={editedLabel(lastStory?.updated_at ?? lastPlace.data.updated_at)} card={cardOf(lastPlace.data.story_id)} feedback={feedbackCounts.data?.[lastPlace.data.story_id] ?? 0} />}
      {stories.data?.find((story) => story.genre === 'Tutorial · timelines and arcs') && <Link to={`/stories/${stories.data.find((story) => story.genre === 'Tutorial · timelines and arcs')!.id}`} className="mt-4 inline-block rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 px-4 py-2 text-sm text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950">{t('Learn timelines and arcs with The Last Lantern →')}</Link>}

      <form
        className="library-create mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) create.mutate()
        }}
      >
        <input
          ref={newTitle}
          aria-label={t('New story title')}
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

      {showTrash ? <ul className="story-library mt-6">
        {trash.data?.map((story) => (
          <li key={story.id} className="story-card">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{story.title}</p>
              {exampleTag(story) && <span className="story-card-tag">{exampleTag(story)}</span>}
              {story.prose_imported && <span className="story-card-tag">{t('Imported')}</span>}
              <p className="truncate text-xs text-slate-400">{story.premise ?? t('no premise yet')}</p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('{0} words · {1}', story.word_count.toLocaleString(getUiLanguage()), editedLabel(story.updated_at))}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={restore.isPending || purge.isPending} onClick={() => restore.mutate(story.id)} className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1 text-sm disabled:opacity-50">{t('Restore')}</button><button type="button" disabled={restore.isPending || purge.isPending} onClick={() => { purge.reset(); setPurgeConfirmation(''); setPendingPurge(story) }} className="text-xs text-red-700 dark:text-red-300">{t('Delete permanently')}</button></div>
          </li>
        ))}
      </ul> : <div className="lib-layout">
        <div className="min-w-0">
          {libraryStories && <div className="lib-list-head">
            <p className="eyebrow">{t('All stories · {0}', libraryStories.length)}</p>
            <label className="lib-sort">{t('Sort')}<select value={sort} onChange={event => setSort(event.target.value as SortMode)}>
              <option value="mine">{t('My order')}</option><option value="edited">{t('Last edited')}</option><option value="title">{t('Title')}</option>
            </select></label>
          </div>}
          {sort === 'mine' && (libraryStories?.length ?? 0) > 1 && <p className="lib-note">{t('Drag cards to arrange them, or use ⋯ to move, pin or archive a story.')}</p>}
          <ul className="story-library lib-cards">
            {libraryStories?.map((story, index) => renderCard(story, index, libraryStories.length))}
            <li className="lib-newcard"><button type="button" onClick={() => { newTitle.current?.focus(); newTitle.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}><span aria-hidden="true">+</span>{t('New story')}</button></li>
          </ul>
          {(archivedStories?.length ?? 0) > 0 && <details className="lib-archived"><summary>{t('Archived · {0}', archivedStories!.length)}</summary><ul className="story-library lib-cards">{archivedStories!.map((story, index) => renderCard(story, index, 0))}</ul></details>}
        </div>
        {overview.data && <aside className="lib-side" aria-label={t('Writing summary')}>
          <WeekPanel week={overview.data.week} />
          <OpenItemsPanel tks={totals.tks} comments={comments} agentChanges={totals.agent} />
        </aside>}
      </div>}

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
