import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type Story } from '../api/client'
import { AccountMenu } from '../components/AuthGate'

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

  const stories = useQuery({ queryKey: ['stories'], queryFn: api.listStories })

  const create = useMutation({
    mutationFn: () => api.createStory({ title }),
    onSuccess: () => {
      setTitle('')
      void qc.invalidateQueries({ queryKey: ['stories'] })
    },
  })

  const remove = useMutation({
    mutationFn: api.deleteStory,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['stories'] }),
  })

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">StoryTool</h1>
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/how-to-use" className="text-sm text-slate-600 dark:text-slate-300 underline underline-offset-4 hover:text-slate-900 dark:hover:text-slate-100">How to use</Link>
          <AccountMenu />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Build your story from its first idea to its individual scenes. Start with a title and fill in the rest as you go.
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        Your library includes editable study examples and an original timeline-and-arc tutorial. Each account has its own copies.
      </p>
      {stories.data?.find((story) => story.genre === 'Tutorial · timelines and arcs') && <Link to={`/stories/${stories.data.find((story) => story.genre === 'Tutorial · timelines and arcs')!.id}`} className="mt-4 inline-block rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 px-4 py-2 text-sm text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950">Learn timelines and arcs with The Last Lantern →</Link>}

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) create.mutate()
        }}
      >
        <input
          className="flex-1 rounded border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
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

      {stories.isPending && <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
      {stories.isError && (
        <p className="mt-6 text-sm text-red-600 dark:text-red-300">{(stories.error as Error).message}</p>
      )}

      <ul className="mt-6 divide-y divide-slate-200 dark:divide-slate-700">
        {stories.data?.map((story) => (
          <li key={story.id} className="flex items-center justify-between py-3">
            <div className="min-w-0">
              <Link
                to={`/stories/${story.id}`}
                className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:underline"
              >
                {story.title}
              </Link>
              <p className="truncate text-xs text-slate-400">
                {story.premise ?? 'no premise yet'}
              </p>
              <div className="mt-1.5">
                <CompletenessBar story={story} />
              </div>
            </div>
            <button
              onClick={() => remove.mutate(story.id)}
              className="text-xs text-slate-400 hover:text-red-600 dark:hover:text-red-300"
            >
              delete
            </button>
          </li>
        ))}
      </ul>

      {stories.data?.length === 0 && <p className="mt-6 text-sm text-slate-400">No stories yet.</p>}
    </main>
  )
}
