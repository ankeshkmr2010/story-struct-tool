import { Suspense, lazy, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { Ladder, type AuthoringMode } from '../components/Ladder'
import { HealthPanel } from '../components/HealthPanel'
import { ChapterBriefCard } from '../components/ChapterBriefCard'
import { SuggestionsPanel } from '../components/SuggestionsPanel'
// Lazy: CodeMirror is the largest dependency in the app and is only needed once the
// author reaches level 8, so it should not sit in the initial bundle.
const SceneEditor = lazy(() =>
  import('../components/SceneEditor').then((m) => ({ default: m.SceneEditor })),
)

const MODES: AuthoringMode[] = ['plotter', 'hybrid', 'pantser']

function AddForm({
  placeholder,
  onAdd,
  pending,
}: {
  placeholder: string
  onAdd: (value: string) => void
  pending?: boolean
}) {
  const [value, setValue] = useState('')
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) {
          onAdd(value.trim())
          setValue('')
        }
      }}
    >
      <input
        className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="submit"
        disabled={!value.trim() || pending}
        className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
      >
        Add
      </button>
    </form>
  )
}

function Chip({ complete }: { complete: boolean }) {
  return (
    <span
      className={[
        'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
        complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
      ].join(' ')}
    >
      {complete ? 'complete' : 'placeholder'}
    </span>
  )
}

export default function StoryWorkspace() {
  const { storyId = '' } = useParams()
  const qc = useQueryClient()
  const [level, setLevel] = useState(1)
  const [mode, setMode] = useState<AuthoringMode>('hybrid')

  const story = useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) })
  const ladder = useQuery({ queryKey: ['ladder', storyId], queryFn: () => api.getLadder(storyId) })
  const health = useQuery({
    queryKey: ['health', storyId, level],
    queryFn: () => api.getHealth(storyId, level),
  })
  const events = useQuery({ queryKey: ['events', storyId], queryFn: () => api.listEvents(storyId) })
  const characters = useQuery({
    queryKey: ['characters', storyId],
    queryFn: () => api.listCharacters(storyId),
  })
  const acts = useQuery({ queryKey: ['acts', storyId], queryFn: () => api.listActs(storyId) })
  const beats = useQuery({ queryKey: ['beats', storyId], queryFn: () => api.listBeats(storyId) })
  const threads = useQuery({
    queryKey: ['threads', storyId],
    queryFn: () => api.listThreads(storyId),
  })
  const chapters = useQuery({
    queryKey: ['chapters', storyId],
    queryFn: () => api.listChapters(storyId),
  })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })

  const [chapterId, setChapterId] = useState<string | null>(null)
  const selectedChapter = chapterId ?? chapters.data?.[0]?.id ?? null

  const brief = useQuery({
    queryKey: ['brief', storyId, selectedChapter],
    queryFn: () => api.getBrief(storyId, selectedChapter!),
    enabled: Boolean(selectedChapter),
  })

  const [sceneId, setSceneId] = useState<string | null>(null)
  const selectedScene = scenes.data?.find((s) => s.id === sceneId) ?? scenes.data?.[0] ?? null

  const progress = useQuery({
    queryKey: ['progress', storyId],
    queryFn: () => api.getProgress(storyId),
  })

  // Any write can change readiness and health, so invalidate both every time.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ladder', storyId] })
    void qc.invalidateQueries({ queryKey: ['health', storyId] })
  }

  const savePremise = useMutation({
    mutationFn: (premise: string) => api.updateStory(storyId, { premise }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['story', storyId] })
      refresh()
    },
  })

  const addEvent = useMutation({
    mutationFn: (label: string) => api.createEvent(storyId, { label, is_turning_point: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['events', storyId] })
      refresh()
    },
  })

  const addCharacter = useMutation({
    mutationFn: (name: string) => api.createCharacter(storyId, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['characters', storyId] })
      refresh()
    },
  })

  const addThread = useMutation({
    mutationFn: (title: string) => api.createThread(storyId, { type: 'a_story', title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['threads', storyId] })
      refresh()
    },
  })

  const addChapter = useMutation({
    mutationFn: (title: string) =>
      api.createChapter(storyId, {
        number: (chapters.data?.length ?? 0) + 1,
        title,
        // Default to the act the story is furthest into, so a new chapter is never
        // orphaned when the author just wants to get moving.
        act_id: acts.data?.[0]?.id,
      }),
    onSuccess: (created) => {
      setChapterId(created.id)
      void qc.invalidateQueries({ queryKey: ['chapters', storyId] })
      refresh()
    },
  })

  const addScene = useMutation({
    mutationFn: (title: string) =>
      api.createScene(storyId, {
        title,
        chapter_id: selectedChapter ?? undefined,
        sort_key: (scenes.data?.length ?? 0) + 1,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', storyId] })
      void qc.invalidateQueries({ queryKey: ['brief', storyId] })
      refresh()
    },
  })

  const linkBeat = useMutation({
    mutationFn: (beatId: string) => api.linkChapterBeat(storyId, selectedChapter!, beatId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['brief', storyId] })
      refresh()
    },
  })

  const scaffold = useMutation({
    mutationFn: () => api.scaffold(storyId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['acts', storyId] })
      void qc.invalidateQueries({ queryKey: ['beats', storyId] })
      refresh()
    },
  })

  if (story.isPending || ladder.isPending) {
    return <p className="p-8 text-sm text-slate-500">Loading…</p>
  }
  if (story.isError) {
    return <p className="p-8 text-sm text-red-600">{(story.error as Error).message}</p>
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Link to="/" className="text-xs text-slate-400 hover:text-slate-700">
        ← all stories
      </Link>

      <header className="mt-2 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{story.data.title}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {story.data.structure_framework.replace('_', ' ')} · {story.data.authoring_mode}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {progress.data && (
            <span className="text-xs text-slate-500">
              {progress.data.word_count.toLocaleString()} words ·{' '}
              {progress.data.drafted_scene_count}/{progress.data.scene_count} scenes drafted
            </span>
          )}
          {/* Export is first-class: this tool augments a writer's process, so the words
              must always be able to leave. */}
          <a
            href={api.manuscriptUrl(storyId)}
            className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Export .md
          </a>
        </div>
        <div className="flex gap-1 rounded-md bg-slate-100 p-1">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={[
                'rounded px-2.5 py-1 text-xs capitalize',
                mode === m ? 'bg-white shadow-sm font-medium' : 'text-slate-500',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>
      </header>

      <div className="mt-6 grid grid-cols-[260px_1fr_280px] gap-6">
        <aside>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Levels
          </h2>
          {ladder.data && (
            <Ladder
              ladder={ladder.data}
              mode={mode}
              activeLevel={level}
              onSelect={setLevel}
            />
          )}
        </aside>

        <section className="min-w-0">
          {level === 1 && (
            <Panel title="Premise" hint="One sentence: what is this story?">
              <textarea
                className="w-full rounded border border-slate-300 p-3 text-sm"
                rows={3}
                defaultValue={story.data.premise ?? ''}
                placeholder="A cartographer discovers her maps are rewriting the territory."
                onBlur={(e) => {
                  if (e.target.value !== (story.data.premise ?? '')) {
                    savePremise.mutate(e.target.value)
                  }
                }}
              />
              <p className="mt-1 text-xs text-slate-400">Saves when you click away.</p>
            </Panel>
          )}

          {level === 2 && (
            <Panel title="Arc skeleton" hint="Three to five major turning points.">
              <AddForm
                placeholder="A turning point…"
                onAdd={(label) => addEvent.mutate(label)}
                pending={addEvent.isPending}
              />
              <ul className="mt-3 divide-y divide-slate-100">
                {events.data?.map((event) => (
                  <li key={event.id} className="py-2 text-sm text-slate-800">
                    {event.label}
                  </li>
                ))}
              </ul>
              {events.data?.length === 0 && <Empty>No turning points yet.</Empty>}
            </Panel>
          )}

          {level === 3 && (
            <Panel title="Characters" hint="Who wants what, and what do they actually need?">
              <AddForm
                placeholder="Character name…"
                onAdd={(name) => addCharacter.mutate(name)}
                pending={addCharacter.isPending}
              />
              <ul className="mt-3 divide-y divide-slate-100">
                {characters.data?.map((character) => (
                  <li key={character.id} className="flex items-center gap-2 py-2">
                    <span className="text-sm text-slate-800">{character.name}</span>
                    <span className="text-xs text-slate-400">{character.role ?? 'no role'}</span>
                    <span className="ml-auto">
                      <Chip complete={character.completeness.is_complete} />
                    </span>
                  </li>
                ))}
              </ul>
              {characters.data?.length === 0 && <Empty>No characters yet.</Empty>}
            </Panel>
          )}

          {(level === 4 || level === 5) && (
            <Panel
              title={level === 4 ? 'Acts' : 'Beats'}
              hint="Seeded from the framework, then yours to edit."
            >
              <button
                onClick={() => scaffold.mutate()}
                disabled={scaffold.isPending}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
              >
                Seed from {story.data.structure_framework.replace('_', ' ')}
              </button>
              {scaffold.data && (
                <p className="mt-2 text-xs text-slate-500">
                  {scaffold.data.changed
                    ? `Created ${scaffold.data.acts_created} acts and ${scaffold.data.beats_created} beats.`
                    : 'Already scaffolded — nothing to add.'}
                </p>
              )}
              <ul className="mt-3 divide-y divide-slate-100">
                {level === 4
                  ? acts.data?.map((act) => (
                      <li key={act.id} className="flex items-center gap-2 py-2">
                        <span className="text-xs tabular-nums text-slate-400">{act.number}</span>
                        <span className="text-sm text-slate-800">{act.title ?? 'untitled'}</span>
                        <span className="ml-auto">
                          <Chip complete={act.completeness.is_complete} />
                        </span>
                      </li>
                    ))
                  : beats.data?.map((beat) => (
                      <li key={beat.id} className="flex items-center gap-2 py-2">
                        <span className="text-sm text-slate-800">{beat.label}</span>
                        {!beat.act_id && (
                          <span className="text-[10px] text-amber-700">no act</span>
                        )}
                        <span className="ml-auto">
                          <Chip complete={beat.completeness.is_complete} />
                        </span>
                      </li>
                    ))}
              </ul>
            </Panel>
          )}

          {level === 6 && (
            <Panel title="Threads" hint="Which storyline carries which beats?">
              <AddForm
                placeholder="Thread title…"
                onAdd={(title) => addThread.mutate(title)}
                pending={addThread.isPending}
              />
              <ul className="mt-3 divide-y divide-slate-100">
                {threads.data?.map((thread) => (
                  <li key={thread.id} className="flex items-center gap-2 py-2">
                    <span className="text-sm text-slate-800">{thread.title ?? 'untitled'}</span>
                    <span className="text-xs text-slate-400">
                      {thread.type.replace('_', '-')}
                    </span>
                  </li>
                ))}
              </ul>
              {threads.data?.length === 0 && <Empty>No threads yet.</Empty>}
            </Panel>
          )}

          {level === 7 && (
            <Panel title="Chapters" hint="Containers that exist to fulfil specific beats.">
              <AddForm
                placeholder="Chapter title…"
                onAdd={(title) => addChapter.mutate(title)}
                pending={addChapter.isPending}
              />

              {(chapters.data?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {chapters.data?.map((chapter) => (
                    <button
                      key={chapter.id}
                      onClick={() => setChapterId(chapter.id)}
                      className={[
                        'rounded px-2 py-1 text-xs',
                        chapter.id === selectedChapter
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                      ].join(' ')}
                    >
                      {chapter.number}. {chapter.title ?? 'untitled'}
                    </button>
                  ))}
                </div>
              )}

              {brief.data && (
                <div className="mt-4">
                  <ChapterBriefCard brief={brief.data} />

                  {/* Declaring what a chapter owes is the one upward reference the
                      author makes by hand; everything else is derived from it. */}
                  <div className="mt-3">
                    <p className="mb-1.5 text-xs text-slate-400">
                      Declare a beat this chapter fulfils:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {beats.data
                        ?.filter(
                          (beat) => !brief.data?.beats.some((b) => b.beat_id === beat.id),
                        )
                        .map((beat) => (
                          <button
                            key={beat.id}
                            onClick={() => linkBeat.mutate(beat.id)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            + {beat.label}
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {chapters.data?.length === 0 && <Empty>No chapters yet.</Empty>}
            </Panel>
          )}

          {level === 8 && (
            <Panel
              title="Scenes"
              hint={
                selectedChapter
                  ? 'New scenes attach to the chapter selected at level 7.'
                  : 'No chapter selected — scenes will be created unattached, which is legal.'
              }
            >
              <AddForm
                placeholder="Scene title…"
                onAdd={(title) => addScene.mutate(title)}
                pending={addScene.isPending}
              />
              {(scenes.data?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {scenes.data?.map((scene) => (
                    <button
                      key={scene.id}
                      onClick={() => setSceneId(scene.id)}
                      className={[
                        'rounded px-2 py-1 text-xs',
                        scene.id === selectedScene?.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                      ].join(' ')}
                    >
                      {scene.title ?? 'untitled'}
                      {scene.word_count > 0 && (
                        <span className="ml-1.5 opacity-60">{scene.word_count}w</span>
                      )}
                      {!scene.chapter_id && <span className="ml-1 text-amber-600">·</span>}
                    </button>
                  ))}
                </div>
              )}

              {selectedScene && (
                <div className="mt-4">
                  <Suspense
                    fallback={<p className="text-sm text-slate-400">Loading editor…</p>}
                  >
                  <SceneEditor
                    storyId={storyId}
                    scene={selectedScene}
                    brief={
                      selectedScene.chapter_id === selectedChapter ? brief.data : undefined
                    }
                  />
                  </Suspense>
                </div>
              )}

              {scenes.data?.length === 0 && <Empty>No scenes yet.</Empty>}
            </Panel>
          )}
        </section>

        <aside>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Health · level ≤ {level}
          </h2>
          {health.data && <HealthPanel health={health.data} />}

          <div className="mt-6">
            <SuggestionsPanel storyId={storyId} />
          </div>
        </aside>
      </div>
    </main>
  )
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <p className="mb-3 text-xs text-slate-400">{hint}</p>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-slate-400">{children}</p>
}
