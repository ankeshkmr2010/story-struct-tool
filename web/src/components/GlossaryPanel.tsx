import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type GlossaryUpdate } from '../api/client'
import { errorText } from '../api/errors'
import { DeleteButton, InlineSelect, InlineText } from './fields'

export function GlossaryPanel({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const entries = useQuery({ queryKey: ['glossary', storyId], queryFn: () => api.listGlossary(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const refresh = () => {
    for (const key of ['glossary', 'versions', 'authorship', 'ai-context', 'reading-document', 'shared-document']) void qc.invalidateQueries({ queryKey: [key, storyId] })
  }
  const create = useMutation({ mutationFn: () => api.createGlossaryEntry(storyId, { term: term.trim() }), onSuccess: () => { setTerm(''); refresh() } })
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: GlossaryUpdate }) => api.updateGlossaryEntry(storyId, id, body), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteGlossaryEntry(storyId, id), onSuccess: refresh })
  return <section>
    <h2 className="text-lg">Glossary</h2>
    <p className="writer-help mt-2 mb-4">Keep your world’s terms and systems here, separate from your premise and prose. Add plain and formal names as aliases, then link the scene that first explains the term.</p>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (term.trim()) create.mutate() }}>
      <input aria-label="New glossary term" className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 dark:border-slate-600" placeholder="Term, e.g. qi…" value={term} onChange={event => setTerm(event.target.value)} maxLength={200} />
      <button type="submit" className="share-story-button" disabled={!term.trim() || create.isPending}>{create.isPending ? 'Adding…' : 'Add term'}</button>
    </form>
    {(entries.isError || create.isError || update.isError || remove.isError) && <p role="alert" className="writer-error">{errorText(entries.error ?? create.error ?? update.error ?? remove.error)}</p>}
    {entries.isPending && <p className="writer-help mt-4">Loading glossary…</p>}
    {entries.data?.length === 0 && <p className="writer-help mt-4">No terms yet. Define a magic system, a rank, or an unfamiliar word for your readers.</p>}
    <div className="mt-5 space-y-4">{entries.data?.map(item => {
      const save = (body: GlossaryUpdate) => update.mutateAsync({ id: item.id, body })
      return <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-3"><label className="min-w-0 flex-1 text-xs text-slate-500 dark:text-slate-400">Term<InlineText value={item.term} placeholder="Term" onSave={term => term ? save({ term }) : Promise.reject(new Error('Term is required'))} className="font-semibold" /></label><DeleteButton what={`glossary entry “${item.term}”`} onConfirm={() => remove.mutateAsync(item.id)} /></div>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-slate-500 dark:text-slate-400">Aliases (one per line)<InlineText value={item.aliases?.join('\n') ?? null} placeholder="Other names, spellings, or formal titles" multiline onSave={value => save({ aliases: value?.split('\n').map(alias => alias.trim()).filter(Boolean) ?? [] })} /></label>
          <label className="block text-xs text-slate-500 dark:text-slate-400">Definition<InlineText value={item.definition} placeholder="What does this term mean in your story?" multiline onSave={definition => save({ definition })} /></label>
          <label className="block text-xs text-slate-500 dark:text-slate-400">First explained in<InlineSelect value={item.first_explained_scene_id} options={(scenes.data ?? []).map(scene => ({ value: scene.id, label: scene.title || 'Untitled scene' }))} placeholder="Not explained yet" onSave={first_explained_scene_id => save({ first_explained_scene_id })} /></label>
        </div>
      </article>
    })}</div>
  </section>
}
