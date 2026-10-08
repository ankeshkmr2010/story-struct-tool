import { useEffect, useRef, useState } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryVersion } from '../api/client'
import { errorText } from '../api/errors'

function counts(version: StoryVersion) {
  const items = (version.statistics.counts ?? {}) as Record<string, number>
  return `${Number(version.statistics.word_count ?? 0).toLocaleString()} words · ${items.scene ?? 0} scenes · ${items.beat ?? 0} beats · ${items.event ?? 0} events`
}

export function StoryVersions({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const pending = useIsMutating()
  const versions = useQuery({ queryKey: ['story-versions', storyId], queryFn: () => api.listStoryVersions(storyId), enabled: open })
  const selected = versions.data?.find((version) => version.id === selectedId) ?? versions.data?.[0]
  const preview = useQuery({ queryKey: ['version-preview', storyId, selected?.id], queryFn: () => api.previewStoryVersion(storyId, selected!.id), enabled: open && Boolean(selected) })
  const refresh = () => void qc.invalidateQueries({ predicate: (query) => query.queryKey.includes(storyId) })
  const save = useMutation({ mutationFn: () => api.saveStoryVersion(storyId, label.trim()), onSuccess: (version) => { setSelectedId(version.id); setLabel(''); setMessage(`Saved v${version.number}: ${version.label}`); refresh() } })
  const restore = useMutation({ mutationFn: () => api.restoreStoryVersion(storyId, selected!.id, preview.data!.current_fingerprint), onSuccess: (result) => { setMessage(`Restored v${result.restored_number}. Your previous draft is preserved in recovery v${result.recovery_version.number}.`); refresh(); setOpen(false) } })
  useEffect(() => {
    if (!open) return
    dialog.current?.focus()
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !restore.isPending) { setOpen(false); trigger.current?.focus() }
      if (event.key === 'Tab') {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]') ?? [])
        const first = items[0], last = items.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, restore.isPending])
  const close = () => { setOpen(false); trigger.current?.focus() }
  return <>
    <button ref={trigger} type="button" onClick={() => { setOpen(true); restore.reset() }} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">Versions</button>
    {message && !open && <p role="status" className="max-w-sm text-xs text-emerald-700">{message}</p>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 sm:p-6">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="story-versions-title" tabIndex={-1} className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl outline-none sm:p-6">
        <div className="flex items-center justify-between gap-4"><h2 id="story-versions-title" className="text-xl font-semibold">Whole-story versions</h2><button type="button" disabled={restore.isPending} onClick={close} aria-label="Close versions" className="rounded border border-slate-200 px-3 py-1 text-sm">Close</button></div>
        <p className="mt-2 text-sm leading-6 text-slate-600">Save the story as a whole: prose, chapters, beats, characters, relationships, arcs, locations, timeline, notes, and links.</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">Automatic checkpoints are saved at most once per minute during editing, with extra checkpoints around AI changes. The latest 50 automatic checkpoints are kept. Named versions and recovery versions are retained. Account settings, keys, and AI conversations stay separate.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (label.trim() && !pending) save.mutate() }} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
          <label className="min-w-0 flex-1 text-xs text-slate-500">Version name<input aria-label="Version name" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={200} placeholder="Before rewriting Act 2" className="mt-1 block w-full rounded border border-slate-300 bg-white p-2 text-sm" /></label>
          <button type="submit" disabled={!label.trim() || pending > 0} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">{save.isPending ? 'Saving version…' : 'Save named version'}</button>
        </form>
        {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
        {save.isError && <p role="alert" className="mt-3 text-sm text-red-600">{errorText(save.error)}</p>}
        {versions.isPending && <p className="mt-4 text-sm text-slate-500">Loading versions…</p>}
        {versions.isError && <p role="alert" className="mt-4 text-sm text-red-600">{errorText(versions.error)}</p>}
        {versions.data?.length === 0 && <p className="mt-4 text-sm text-slate-500">Save your first named version, or edit the story to start automatic checkpoint history.</p>}
        {(versions.data?.length ?? 0) > 0 && <div className="mt-5 grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="max-h-[28rem] space-y-2 overflow-y-auto" aria-label="Saved story versions">{versions.data?.map((version) => <button key={version.id} type="button" onClick={() => { setSelectedId(version.id); restore.reset() }} aria-pressed={selected?.id === version.id} className={`block w-full rounded-lg border p-3 text-left ${selected?.id === version.id ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <p className="break-words text-sm font-medium">v{version.number} · {version.label}</p><p className="mt-1 text-[11px] capitalize text-slate-500">{version.source} · {new Date(version.created_at).toLocaleString()}</p><p className="mt-1 text-[11px] text-slate-500">{counts(version)}</p>
          </button>)}</div>
          <section className="min-w-0" aria-label="Restore preview">
            {preview.isPending && <p className="text-sm text-slate-500">Comparing this version with the working draft…</p>}
            {preview.isError && <p role="alert" className="text-sm text-red-600">{errorText(preview.error)}</p>}
            {preview.data && <><h3 className="text-base font-semibold">Restore preview · v{preview.data.version.number}</h3><p className="mt-2 text-sm text-slate-600">{preview.data.change_count === 0 ? 'This version matches the current story.' : `${preview.data.change_count} changes would restore this version.`}</p>
              <div className="mt-3 max-h-[22rem] space-y-2 overflow-y-auto">{preview.data.changes.map((change, index) => <details key={index} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer break-words text-sm"><span className="capitalize text-violet-700">{change.action} {change.entity.replaceAll('_', ' ')}</span> · {change.title}</summary><dl className="mt-2 space-y-2">{[...new Set([...Object.keys(change.before), ...Object.keys(change.after)])].map((field) => <div key={field} className="break-words text-xs leading-5"><dt className="font-medium capitalize text-slate-600">{field.replace(/_id$/, '').replaceAll('_', ' ')}</dt><dd className="whitespace-pre-wrap text-slate-500">{change.before[field] ?? 'Not set'} → {change.after[field] ?? 'Not set'}</dd></div>)}</dl></details>)}</div>
              {preview.data.change_count > preview.data.changes.length && <p className="mt-2 text-xs text-slate-500">Showing the first {preview.data.changes.length} changes. Restore applies the complete version.</p>}
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Restoring replaces the working draft's story state. A recovery checkpoint is saved first, so you can return to the draft you have now. Old AI edit plans are superseded; conversation history is kept.</p>
              <div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => void preview.refetch()} disabled={restore.isPending} className="rounded border border-slate-300 px-3 py-2 text-sm">Refresh preview</button><button type="button" onClick={() => restore.mutate()} disabled={pending > 0 || preview.isFetching || preview.data.change_count === 0} className="rounded bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-40">{restore.isPending ? 'Restoring…' : 'Restore this version'}</button></div>
            </>}
            {restore.isError && <p role="alert" className="mt-3 text-sm text-red-600">{errorText(restore.error)}</p>}
          </section>
        </div>}
      </div>
    </div>}
  </>
}
