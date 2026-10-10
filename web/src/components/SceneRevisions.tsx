import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type SceneRevision } from '../api/client'
import { errorText } from '../api/errors'

/**
 * Prose snapshots for one scene. Restoring is itself undoable: the API snapshots the
 * current prose ("before restore") before replacing it.
 */
export function SceneRevisions({
  storyId,
  sceneId,
  flush,
  onRestored,
}: {
  storyId: string
  sceneId: string
  flush: () => Promise<boolean>
  onRestored: (text: string) => void
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const key = ['revisions', storyId, sceneId]
  const revisions = useQuery({ queryKey: key, queryFn: () => api.listRevisions(storyId, sceneId), enabled: open })

  const snapshot = useMutation({
    mutationFn: async () => {
      if (!(await flush())) throw new Error('Save your draft before taking a snapshot.')
      const label = window.prompt('Snapshot label (optional)')
      if (label === null) return null
      return api.snapshot(storyId, sceneId, label.trim() || undefined)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  })

  const restore = useMutation({
    mutationFn: async (revision: SceneRevision) => {
      if (!(await flush())) throw new Error('Save your draft before restoring.')
      if (!window.confirm('Replace this scene’s prose with the snapshot? The current text is kept as a “before restore” snapshot.')) return null
      const result = await api.restoreRevision(storyId, sceneId, revision.id)
      return { scene_id: sceneId, content: revision.content ?? '', word_count: result.word_count }
    },
    onSuccess: (restored) => {
      if (!restored) return
      onRestored(restored.content)
      setPreviewId(null)
      qc.setQueryData(['content', storyId, sceneId], restored)
      void qc.invalidateQueries({ queryKey: key })
      for (const k of ['scenes', 'progress', 'annotations']) void qc.invalidateQueries({ queryKey: [k, storyId] })
    },
  })

  const error = snapshot.error ?? restore.error ?? revisions.error
  return (
    <details className="mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/60 px-3 py-2 text-xs" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
        Revisions{revisions.data ? ` · ${revisions.data.length}` : ''}
      </summary>
      <div className="mt-3 space-y-2 border-t border-slate-200 dark:border-slate-700 pt-3">
        <button
          type="button"
          disabled={snapshot.isPending}
          onClick={() => snapshot.mutate()}
          className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 disabled:opacity-40"
        >
          {snapshot.isPending ? 'Saving snapshot…' : 'Save snapshot now'}
        </button>
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{errorText(error)}</p>}
        {revisions.isPending && open && <p className="text-slate-400">Loading revisions…</p>}
        {revisions.data?.length === 0 && <p className="text-slate-400">No revisions yet. One is kept when you click away after editing.</p>}
        <ul className="space-y-1.5">
          {revisions.data?.map((revision) => (
            <li key={revision.id} className="rounded border-l-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-950 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-slate-700 dark:text-slate-200">{new Date(revision.created_at).toLocaleString()}</span>
                {revision.label && <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 text-slate-600 dark:text-slate-300">{revision.label}</span>}
                <span className="text-slate-400">{revision.word_count} words</span>
                <span className="sm:ml-auto flex gap-3">
                  <button type="button" onClick={() => setPreviewId(previewId === revision.id ? null : revision.id)} className="text-slate-500 dark:text-slate-400 hover:underline">
                    {previewId === revision.id ? 'Hide' : 'Preview'}
                  </button>
                  <button type="button" disabled={restore.isPending} onClick={() => restore.mutate(revision)} className="text-slate-500 dark:text-slate-400 hover:underline disabled:opacity-40">
                    Restore
                  </button>
                </span>
              </div>
              {previewId === revision.id && <pre className="writer-latest mt-2">{revision.content || '(Empty passage)'}</pre>}
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
