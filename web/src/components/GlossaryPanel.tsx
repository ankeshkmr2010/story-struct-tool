import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type GlossaryUpdate } from '../api/client'
import { errorText } from '../api/errors'
import { DeleteButton, InlineSelect, InlineText } from './fields'
import { OpenBesideButton } from './BesidePanel'
import { offerRename } from './rename'

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
    <h2 className="text-lg">{t('Glossary')}</h2>
    <p className="writer-help mt-2 mb-4">{t('Keep your world’s terms and systems here, separate from your premise and prose. Add plain and formal names as aliases, then link the scene that first explains the term.')}</p>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (term.trim()) create.mutate() }}>
      <input aria-label={t('New glossary term')} className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 dark:border-slate-600" placeholder={t('Term, e.g. qi…')} value={term} onChange={event => setTerm(event.target.value)} maxLength={200} />
      <button type="submit" className="share-story-button" disabled={!term.trim() || create.isPending}>{create.isPending ? t('Adding…') : t('Add term')}</button>
    </form>
    {(entries.isError || create.isError || update.isError || remove.isError) && <p role="alert" className="writer-error">{errorText(entries.error ?? create.error ?? update.error ?? remove.error)}</p>}
    {entries.isPending && <p className="writer-help mt-4">{t('Loading glossary…')}</p>}
    {entries.data?.length === 0 && <p className="writer-help mt-4">{t('No terms yet. Define a magic system, a rank, or an unfamiliar word for your readers.')}</p>}
    <div className="mt-5 space-y-4">{entries.data?.map(item => {
      const save = (body: GlossaryUpdate) => update.mutateAsync({ id: item.id, body })
      return <article key={item.id} id={`search-glossary_entry-${item.id}`} className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-3"><label className="min-w-0 flex-1 text-xs text-slate-500 dark:text-slate-400">{t('Term')}<InlineText value={item.term} placeholder={t('Term')} onSave={async term => { if (!term) throw new Error(t('Term is required')); await save({ term }); offerRename({ kind: 'glossary_entry', id: item.id, from: item.term, to: term }) }} className="font-semibold" /></label><OpenBesideButton item={{ kind: 'glossary_entry', id: item.id }} label={item.term} /><DeleteButton what={t('glossary entry “{0}”', item.term)} onConfirm={() => remove.mutateAsync(item.id)} /></div>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-slate-500 dark:text-slate-400">{t('Aliases (one per line)')}<InlineText value={item.aliases?.join('\n') ?? null} placeholder={t('Other names, spellings, or formal titles')} multiline onSave={value => save({ aliases: value?.split('\n').map(alias => alias.trim()).filter(Boolean) ?? [] })} /></label>
          <label className="block text-xs text-slate-500 dark:text-slate-400">{t('Definition')}<InlineText value={item.definition} placeholder={t('What does this term mean in your story?')} multiline onSave={definition => save({ definition })} /></label>
          <ReferenceImages storyId={storyId} entity="glossary" entityId={item.id} />
          <label className="block text-xs text-slate-500 dark:text-slate-400">{t('First explained in')}<InlineSelect value={item.first_explained_scene_id} options={(scenes.data ?? []).map(scene => ({ value: scene.id, label: scene.title || t('Untitled scene') }))} placeholder={t('Not explained yet')} onSave={first_explained_scene_id => save({ first_explained_scene_id })} /></label>
        </div>
      </article>
    })}</div>
  </section>
}
import { ReferenceImages } from './StoryImages'
import { t } from '../i18n'
