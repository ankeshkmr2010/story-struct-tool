import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type Story } from '../api/client'

function CompletenessBar({ story }: { story: Story }) {
  const { is_complete, missing, ratio } = story.completeness
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={is_complete ? 'h-full bg-emerald-500' : 'h-full bg-amber-500'}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {is_complete ? 'complete' : `needs: ${missing.join(', ')}`}
      </span>
    </div>
  )
}

export default function StoryList() {
  const qc = useQueryClient()
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

  const stories = useQuery({ queryKey: ['stories'], queryFn: api.listStories })
  const trash = useQuery({ queryKey: ['trashed-stories'], queryFn: api.listTrashedStories })
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

  const remove = useMutation({
    mutationFn: api.deleteStory,
    onSuccess: () => {
      setMessage(`“${pendingDelete?.title}” moved to Trash. Its contents and versions are preserved.`)
      setPendingDelete(null)
      refresh()
      window.setTimeout(() => trashToggle.current?.focus(), 0)
    },
  })
  const restore = useMutation({
    mutationFn: api.restoreStory,
    onSuccess: (story) => {
      setMessage(`“${story.title}” restored to your library.`)
      refresh()
    },
  })
  const purge = useMutation({ mutationFn: api.purgeStory, onSuccess: () => {
    setMessage(`“${pendingPurge?.title}” permanently deleted from the database.`)
    setPendingPurge(null); setPurgeConfirmation(''); refresh()
    void qc.invalidateQueries({ queryKey: ['oauth-grants'] })
    void qc.invalidateQueries({ queryKey: ['agent-tokens'] })
    window.setTimeout(() => trashToggle.current?.focus(), 0)
  } })

  return (
    <main className="mx-auto max-w-3xl p-5 sm:p-8">
      <div className="page-heading"><h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{showTrash ? 'Trash' : 'Your stories'}</h1><button ref={trashToggle} type="button" onClick={() => setShowTrash(!showTrash)} className="shrink-0 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm">{showTrash ? 'Back to library' : `Trash${trash.data?.length ? ` (${trash.data.length})` : ''}`}</button></div>
      {message && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {showTrash && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Restore a story to keep working, or delete it permanently to remove its contents and version history from the database.</p>}
      {!showTrash && <>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Build your story from its first idea to its individual scenes. Start with a title and fill in the rest as you go.
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        Your library includes editable study examples and an original timeline-and-arc tutorial. Each account has its own copies.
      </p>
      {stories.data?.find((story) => story.genre === 'Tutorial · timelines and arcs') && <Link to={`/stories/${stories.data.find((story) => story.genre === 'Tutorial · timelines and arcs')!.id}`} className="mt-4 inline-block rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 px-4 py-2 text-sm text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950">Learn timelines and arcs with The Last Lantern →</Link>}

      <form
        className="library-create mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) create.mutate()
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
          placeholder="Story title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="submit"
          disabled={!title.trim() || create.isPending}
          className="rounded bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm text-white dark:text-slate-950 disabled:opacity-40"
        >
          Create
        </button>
      </form>
      </>}

      {stories.isPending && <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
      {stories.isError && (
        <p className="mt-6 text-sm text-red-600 dark:text-red-300">{(stories.error as Error).message}</p>
      )}

      <ul className="story-library mt-6">
        {(showTrash ? trash.data : stories.data)?.map((story) => (
          <li key={story.id} className="story-card">
            <div className="min-w-0">
              {showTrash ? <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{story.title}</p> : <Link
                to={`/stories/${story.id}`}
                className="story-card-title"
              >
                {story.title}
              </Link>}
              <p className="truncate text-xs text-slate-400">
                {story.premise ?? 'no premise yet'}
              </p>
              <div className="mt-1.5">
                <CompletenessBar story={story} />
              </div>
            </div>
            {showTrash ? <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={restore.isPending || purge.isPending} onClick={() => restore.mutate(story.id)} className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1 text-sm disabled:opacity-50">Restore</button><button type="button" disabled={restore.isPending || purge.isPending} onClick={() => { purge.reset(); setPurgeConfirmation(''); setPendingPurge(story) }} className="text-xs text-red-700 dark:text-red-300">Delete permanently</button></div> : <button
              type="button"
              aria-label={`Delete ${story.title}`}
              onClick={() => { remove.reset(); setPendingDelete(story) }}
              className="story-delete-button ml-3 shrink-0"
            >
              Delete
            </button>}
          </li>
        ))}
      </ul>

      {showTrash && trash.isPending && <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Loading Trash…</p>}
      {(trash.isError || restore.isError) && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-300">{String(trash.error ?? restore.error)}</p>}
      {(showTrash ? trash.data : stories.data)?.length === 0 && <p className="mt-6 text-sm text-slate-400">{showTrash ? 'Trash is empty.' : 'No stories yet.'}</p>}
      <dialog ref={confirmDialog} role="alertdialog" aria-labelledby="delete-story-title" aria-describedby="delete-story-description" onCancel={(event) => { event.preventDefault(); if (!remove.isPending) setPendingDelete(null) }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <h2 id="delete-story-title" className="text-lg font-semibold">Move story to Trash?</h2>
        <p id="delete-story-description" className="mt-3 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">“{pendingDelete?.title}” will leave your library. All its prose, characters, structure, and version history will be preserved. You can restore it from Trash.</p>
        {remove.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">Could not move the story. Please try again.</p>}
        <div className="mt-5 flex justify-end gap-3"><button type="button" autoFocus disabled={remove.isPending} onClick={() => setPendingDelete(null)} className="rounded border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm">Cancel</button><button type="button" disabled={remove.isPending || !pendingDelete} onClick={() => { if (pendingDelete) remove.mutate(pendingDelete.id) }} className="rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50">{remove.isPending ? 'Moving…' : 'Move to Trash'}</button></div>
      </dialog>
      <dialog ref={purgeDialog} role="alertdialog" aria-labelledby="purge-story-title" aria-describedby="purge-story-description" onCancel={event => { event.preventDefault(); if (!purge.isPending) setPendingPurge(null) }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <h2 id="purge-story-title" className="text-lg font-semibold">Delete story permanently?</h2>
        <p id="purge-story-description" className="mt-3 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">“{pendingPurge?.title}” and its prose, characters, structure, notes, versions, AI history, and story-specific connections will be removed from the database. This cannot be undone in StoryTool.</p>
        <label className="mt-4 block text-sm">Type DELETE to confirm<input aria-label="Permanent deletion confirmation" autoComplete="off" value={purgeConfirmation} disabled={purge.isPending} onChange={event => setPurgeConfirmation(event.target.value)} className="mt-2 w-full rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /></label>
        {purge.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{String(purge.error)}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" autoFocus disabled={purge.isPending} onClick={() => setPendingPurge(null)} className="rounded border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm">Cancel</button><button type="button" disabled={purge.isPending || purgeConfirmation !== 'DELETE'} onClick={() => { if (pendingPurge) purge.mutate({ id: pendingPurge.id, expected_title: pendingPurge.title, confirmation: 'DELETE' }) }} className="rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50">{purge.isPending ? 'Deleting…' : 'Delete permanently'}</button></div>
      </dialog>
    </main>
  )
}
