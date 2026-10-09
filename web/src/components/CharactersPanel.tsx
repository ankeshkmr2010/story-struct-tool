import { useState } from 'react'
import { OriginSummary } from './AuthorshipPanel'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { AddForm, Chip, DeleteButton, InlineSelect, InlineText } from './fields'

const ROLES = ['protagonist', 'antagonist', 'mentor', 'foil', 'supporting', 'minor'] as const
const ARC_TYPES = ['positive', 'negative', 'flat'] as const

/**
 * Level 3, fully editable.
 *
 * `want` and `need` get as much room as the name because they are the load-bearing pair — a
 * character without the gap between them has no arc to advance, and several of the tool's
 * observations depend on both being filled.
 *
 * `arc_type: flat` is worth setting deliberately: it tells the suggestion engine that this
 * character is *meant* not to change, so it stops asking for an arc.
 */
export function CharactersPanel({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')

  const characters = useQuery({
    queryKey: ['characters', storyId],
    queryFn: () => api.listCharacters(storyId),
  })
  const arcs = useQuery({ queryKey: ['arcs', storyId], queryFn: () => api.listArcs(storyId) })

  // Any change here can move readiness, health, and the suggestion engine.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['characters', storyId] })
    void qc.invalidateQueries({ queryKey: ['ladder', storyId] })
    void qc.invalidateQueries({ queryKey: ['health', storyId] })
    void qc.invalidateQueries({ queryKey: ['suggestions', storyId] })
    void qc.invalidateQueries({ queryKey: ['continuity', storyId] })
    void qc.invalidateQueries({ queryKey: ['arcs', storyId] })
    void qc.invalidateQueries({ queryKey: ['relationships', storyId] })
  }

  const create = useMutation({
    mutationFn: () => api.createCharacter(storyId, { name: name.trim() }),
    onSuccess: () => {
      setName('')
      refresh()
    },
  })

  const update = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      api.updateCharacter(storyId, vars.id, vars.body),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCharacter(storyId, id),
    onSuccess: refresh,
  })

  const patch = (id: string) => (field: string) => (value: string | string[] | null) =>
    update.mutateAsync({ id, body: { [field]: value } })

  const createArc = useMutation({
    mutationFn: (characterId: string) => api.createArc(storyId, { character_id: characterId }),
    onSuccess: refresh,
  })

  const protagonists = characters.data?.filter((c) => c.role === 'protagonist').length ?? 0

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Characters</h2>
      <p className="mb-3 text-xs text-slate-400">
        Who wants what, and what do they actually need? A name is enough to start.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <input
          className="flex-1 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm"
          placeholder="Character name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded bg-slate-900 dark:bg-slate-200 px-3 py-1.5 text-sm text-white dark:text-slate-950 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {characters.data && characters.data.length > 0 && protagonists === 0 && (
        <p className="mt-2 rounded bg-amber-50 dark:bg-amber-950 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
          No one is marked protagonist yet — set a role below to unlock Acts.
        </p>
      )}
      {protagonists > 1 && (
        <p className="mt-2 rounded bg-amber-50 dark:bg-amber-950 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
          {protagonists} characters are marked protagonist.
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {characters.data?.map((character) => {
          const set = patch(character.id)
          return (
            <li key={character.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <InlineText
                    value={character.name}
                    placeholder="name"
                    onSave={set('name')}
                    className="font-medium"
                  />
                </div>
                <InlineSelect
                  value={character.role}
                  options={ROLES}
                  onSave={set('role')}
                  placeholder="— role —"
                  highlight={character.role === 'protagonist'}
                />
                <InlineSelect
                  value={character.arc_type}
                  options={ARC_TYPES}
                  onSave={set('arc_type')}
                  placeholder="— arc —"
                />
                <Chip complete={character.completeness.is_complete} missing={character.completeness.missing} />
                <DeleteButton onConfirm={() => remove.mutate(character.id)} what="character" />
              </div>

              <OriginSummary storyId={storyId} entityId={character.id} entityType="character" />
              <div className="mt-3 space-y-2">
                <label className="block text-xs">Description<InlineText value={character.description} placeholder="Who are they?" onSave={set('description')} multiline /></label>
                <label className="block text-xs">Aliases (one per line)<InlineText value={character.aliases?.join('\n') ?? null} placeholder="Other names or titles" onSave={value => set('aliases')(value ? value.split('\n').map(item => item.trim()).filter(Boolean) : [])} multiline /></label>
                <label className="block text-xs">Relation to the protagonist<InlineText value={character.relation_to_protagonist} placeholder="How are they connected?" onSave={set('relation_to_protagonist')} multiline /></label>
                <label className="block text-xs">Private notes<InlineText value={character.notes} placeholder="Working notes" onSave={set('notes')} multiline /></label>
                <p className="writer-help">Want and need are required for a protagonist, antagonist, or positive/negative arc. Supporting and minor characters can stay simple. Wounds and misbeliefs are optional.</p>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    Want (external)
                  </span>
                  <InlineText
                    value={character.want}
                    placeholder="what they are chasing"
                    onSave={set('want')}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    Need (actual)
                  </span>
                  <InlineText
                    value={character.need}
                    placeholder="what would actually help"
                    onSave={set('need')}
                  />
                </label>
              </div>

              <details className="mt-1.5">
                <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-400">
                  Backstory
                </summary>
                <div className="mt-1 space-y-1.5">
                  <InlineText
                    value={character.wound}
                    placeholder="wound — the formative injury"
                    onSave={set('wound')}
                    multiline
                  />
                  <InlineText
                    value={character.misbelief}
                    placeholder="misbelief — the lie they believe"
                    onSave={set('misbelief')}
                    multiline
                  />
                  <InlineText
                    value={character.voice_notes}
                    placeholder="voice notes"
                    onSave={set('voice_notes')}
                    multiline
                  />
                </div>
              </details>

              {!character.completeness.is_complete && (
                <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                  needs: {character.completeness.missing.join(', ')}
                </p>
              )}
              {arcs.data?.filter((arc) => arc.character_id === character.id).map((arc) => (
                <CharacterArc key={arc.id} storyId={storyId} arcId={arc.id} resolution={arc.resolution} onChange={refresh} />
              ))}
              {!arcs.data?.some((arc) => arc.character_id === character.id) && (
                <button
                  onClick={() => createArc.mutate(character.id)}
                  disabled={createArc.isPending}
                  className="mt-2 text-xs text-sky-700 dark:text-sky-300 hover:underline disabled:opacity-40"
                >
                  + Define an arc
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {characters.data?.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">No characters yet.</p>
      )}
      <RelationshipsSection storyId={storyId} characters={characters.data ?? []} />
    </div>
  )
}

function RelationshipsSection({ storyId, characters }: { storyId: string; characters: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const [first, setFirst] = useState<string | null>(null)
  const [second, setSecond] = useState<string | null>(null)
  const relationships = useQuery({ queryKey: ['relationships', storyId], queryFn: () => api.listRelationships(storyId) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['relationships', storyId] })
    void qc.invalidateQueries({ queryKey: ['health', storyId] })
  }
  const create = useMutation({
    mutationFn: () => api.createRelationship(storyId, { character_a_id: first!, character_b_id: second! }),
    onSuccess: () => { setFirst(null); setSecond(null); refresh() },
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateRelationship(storyId, id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteRelationship(storyId, id), onSuccess: refresh })
  const options = characters.map((character) => ({ value: character.id, label: character.name }))
  const nameOf = (id: string) => characters.find((character) => character.id === id)?.name ?? 'Unknown character'

  return (
    <section className="mt-6 border-t border-slate-200 dark:border-slate-700 pt-4">
      <h2 className="text-sm font-semibold">Relationships</h2>
      <p className="mt-1 text-xs text-slate-400">Define how two characters relate, and how that changes.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <InlineSelect value={first} options={options} onSave={setFirst} placeholder="First character" />
        <InlineSelect value={second} options={options} onSave={setSecond} placeholder="Second character" />
        <button
          onClick={() => create.mutate()}
          disabled={!first || !second || first === second || create.isPending}
          className="rounded bg-slate-900 dark:bg-slate-200 px-2 py-1 text-xs text-white dark:text-slate-950 disabled:opacity-40"
        >Add relationship</button>
      </div>
      {create.isError && <p className="mt-1 text-xs text-red-600 dark:text-red-300">Could not add this relationship.</p>}
      <ul className="mt-3 space-y-2">
        {relationships.data?.map((relationship) => (
          <li key={relationship.id} className="rounded border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{nameOf(relationship.character_a_id)} ↔ {nameOf(relationship.character_b_id)}</span>
              <DeleteButton onConfirm={() => remove.mutate(relationship.id)} what="relationship" />
            </div>
            <div className="mt-2 space-y-2">
              <label className="block text-[10px] uppercase text-slate-400">History<InlineText value={relationship.history} placeholder="What happened before?" onSave={(history) => update.mutateAsync({ id: relationship.id, body: { history } })} multiline /></label>
              <label className="block text-[10px] uppercase text-slate-400">Current dynamic<InlineText value={relationship.current_dynamic} placeholder="How do they relate now?" onSave={(current_dynamic) => update.mutateAsync({ id: relationship.id, body: { current_dynamic } })} multiline /></label>
              <label className="block text-[10px] uppercase text-slate-400">Tension<InlineText value={relationship.tension_notes} placeholder="What is unresolved?" onSave={(tension_notes) => update.mutateAsync({ id: relationship.id, body: { tension_notes } })} multiline /></label>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CharacterArc({
  storyId,
  arcId,
  resolution,
  onChange,
}: {
  storyId: string
  arcId: string
  resolution: string | null
  onChange: () => void
}) {
  const qc = useQueryClient()
  const stages = useQuery({ queryKey: ['arc-stages', arcId], queryFn: () => api.listArcStages(arcId) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['arc-stages', arcId] })
    void qc.invalidateQueries({ queryKey: ['brief', storyId] })
    void qc.invalidateQueries({ queryKey: ['health', storyId] })
    onChange()
  }
  const update = useMutation({ mutationFn: (value: string | null) => api.updateArc(storyId, arcId, { resolution: value }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: () => api.deleteArc(storyId, arcId), onSuccess: refresh })
  const addStage = useMutation({
    mutationFn: (label: string) => api.createArcStage(arcId, { label, sort_key: Math.max(0, ...(stages.data ?? []).map(stage => stage.sort_key)) + 100 }),
    onSuccess: refresh,
  })
  const updateStage = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateArcStage(arcId, id, body),
    onSuccess: refresh,
  })
  const removeStage = useMutation({ mutationFn: (id: string) => api.deleteArcStage(arcId, id), onSuccess: refresh })

  return (
    <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Character arc</h3>
        <DeleteButton onConfirm={() => remove.mutate()} what="arc" />
      </div>
      <label className="mt-1 block text-[10px] uppercase text-slate-400">Resolution
        <InlineText value={resolution} placeholder="How does this arc resolve?" onSave={(value) => update.mutateAsync(value)} multiline />
      </label>
      <ul className="mt-2 space-y-1">
        {stages.data?.map((stage) => (
          <li key={stage.id} className="rounded bg-slate-50 dark:bg-slate-950 p-1">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1"><InlineText value={stage.label} placeholder="Stage" onSave={(label) => updateStage.mutateAsync({ id: stage.id, body: { label } })} /></div>
              <DeleteButton onConfirm={() => removeStage.mutate(stage.id)} what="stage" />
            </div>
            <InlineText value={stage.description} placeholder="What changes in this stage?" onSave={(description) => updateStage.mutateAsync({ id: stage.id, body: { description } })} />
          </li>
        ))}
      </ul>
      <div className="mt-2"><AddForm placeholder="Next arc stage…" onAdd={(label) => addStage.mutateAsync(label)} pending={addStage.isPending} /></div>
    </div>
  )
}
