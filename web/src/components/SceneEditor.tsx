import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { api, type ChapterBrief, type Scene } from '../api/client'
import { errorText } from '../api/errors'
import { useTheme } from './theme-context'
import { writerDraft } from './writerDraft'


/**
 * The writing surface.
 *
 * Deliberately a plain Markdown editor — Scrivener and Word already win on editor
 * features, and competing there would be wasted effort. What this view does that they
 * cannot is keep the *structure* present while the prose is written: the beat this scene
 * owes, the arc it moves, the emotional shift it must deliver, all visible without the
 * writer holding it in their head or going hunting.
 */
export function SceneEditor({
  storyId,
  scene,
  brief,
}: {
  storyId: string
  scene: Scene
  brief?: ChapterBrief
}) {
  const qc = useQueryClient()
  const { theme } = useTheme()
  const viewRef = useRef<EditorView | null>(null)

  const content = useQuery({
    queryKey: ['content', storyId, scene.id],
    queryFn: () => api.getContent(storyId, scene.id),
  })

  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser })
  const buffer = writerDraft(`storytool-writer:${me.data?.id}:${storyId}:${scene.id}`, content.data?.content ?? '')
  const state = useSyncExternalStore(buffer.subscribe, buffer.snapshot)
  const draft = state.text
  const setDraft = buffer.change
  const status = state.status
  const lastCheckpoint = useRef(0)
  const [latest, setLatest] = useState<string | null>(null)
  useEffect(() => { if (content.data) buffer.observe(content.data.content ?? '') }, [buffer, content.data])
  useEffect(() => {
    buffer.configure(async (text, base) => {
      const snapshot = Date.now() - lastCheckpoint.current >= 60_000
      await api.saveContent(storyId, scene.id, { content: text, expected_content: base, snapshot })
      if (snapshot) lastCheckpoint.current = Date.now()
      qc.setQueryData(['content', storyId, scene.id], { scene_id: scene.id, content: text, word_count: text.trim().split(/\s+/).filter(Boolean).length })
      for (const key of ['scenes', 'progress', 'annotations']) void qc.invalidateQueries({ queryKey: [key, storyId] })
    })
  }, [buffer, storyId, scene.id, qc])
  useEffect(() => () => { if (buffer.state.status !== 'error') void buffer.flush() }, [buffer])
  const save = { isError: state.status === 'error', isPending: state.status === 'saving', error: new Error(state.error ?? 'Save failed'), mutate: (opts: { text: string; snapshot: boolean }) => { if (opts.text !== buffer.state.text) buffer.change(opts.text); void buffer.flush() } }
  const flushWithSnapshot = useCallback(() => { if (buffer.state.status !== 'error') void buffer.flush() }, [buffer])

  const annotations = useQuery({
    queryKey: ['annotations', storyId, scene.id],
    queryFn: () => api.listAnnotations(storyId, scene.id),
  })

  const addAnnotation = useMutation({
    mutationFn: (payload: { start: number; end: number; text: string; note: string }) =>
      api.createAnnotation(storyId, scene.id, {
        start_offset: payload.start,
        end_offset: payload.end,
        quoted_text: payload.text,
        note: payload.note,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['annotations', storyId, scene.id] }),
  })

  const removeAnnotation = useMutation({
    mutationFn: (id: string) => api.deleteAnnotation(storyId, scene.id, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['annotations', storyId, scene.id] }),
  })

  const annotateSelection = () => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from === to) {
      window.alert('Select some text first.')
      return
    }
    const quoted = view.state.doc.sliceString(from, to)
    const note = window.prompt(`Note on “${quoted.slice(0, 60)}”`)
    if (note !== null) {
      addAnnotation.mutate({ start: from, end: to, text: quoted, note })
    }
  }

  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0
  const dirty = draft !== state.base

  if (content.isPending) return <p className="text-sm">Loading prose…</p>
  if (content.isError) return <p role="alert" className="writer-error">{errorText(content.error)}</p>

  return (
    <div className="min-w-0">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="min-w-0 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">
            {scene.title ?? 'Untitled scene'}
          </h3>
          <span className="text-xs text-slate-400">{words} words</span>
          <span className="sm:ml-auto text-xs text-slate-400">
            {status === 'error' ? 'save failed' : status === 'saving' ? 'saving…' : dirty ? 'unsaved' : status === 'saved' ? 'saved' : ''}
          </span>
          <button
            onClick={annotateSelection}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950"
          >
            Annotate selection
          </button>
        </div>
        {save.isError && <div role="alert" className="mb-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-xs leading-5 text-red-800 dark:text-red-300"><p>{errorText(save.error)}</p><p>Your unsaved text remains in this editor.</p><button type="button" disabled={save.isPending} onClick={() => save.mutate({ text: draft, snapshot: false })} className="mt-2 rounded border border-red-300 dark:border-red-800 px-3 py-1 font-medium">Retry save</button><button type="button" className="ml-2" onClick={async () => { setLatest((await api.getContent(storyId, scene.id)).content ?? '') }}>Review latest text</button>{latest !== null && <div><pre className="writer-latest">{latest || '(Empty passage)'}</pre><button type="button" onClick={() => { if (window.confirm('Replace your local draft with the latest saved prose?')) { buffer.useLatest(latest); setLatest(null) } }}>Use latest text</button><button type="button" className="ml-3" onClick={() => { if (window.confirm('Save your draft over the latest prose? A revision will preserve the previous text.')) { lastCheckpoint.current = 0; buffer.rebase(latest); setLatest(null); void buffer.flush() } }}>Keep my draft</button></div>}</div>}

        {(brief?.beats.length || scene.goal) && (
          <p className="mb-2 truncate text-xs text-slate-500 dark:text-slate-400" title={[brief?.beats.map((beat) => beat.label).join(', '), scene.goal].filter(Boolean).join(' · ')}>
            {brief?.beats.length ? `Beat: ${brief.beats.map((beat) => beat.label).join(', ')}` : ''}
            {brief?.beats.length && scene.goal ? ' · ' : ''}
            {scene.goal ? `Goal: ${scene.goal}` : ''}
          </p>
        )}

        <div className="w-full min-w-0 overflow-hidden rounded-md border border-slate-300 dark:border-slate-600" onBlur={flushWithSnapshot}>
          <CodeMirror
            theme={theme}
            value={draft}
            width="100%"
            height="460px"
            extensions={[markdown(), EditorView.lineWrapping, EditorView.theme({
              '&': { backgroundColor: 'var(--surface)', color: 'var(--ink)' },
              '.cm-scroller': { fontFamily: 'Georgia, serif', fontSize: '16px' },
              '.cm-content': { padding: '18px 22px', lineHeight: '1.9' },
              '.cm-cursor': { borderLeftColor: 'var(--accent)' },
              '.cm-gutters': { backgroundColor: 'var(--surface)', borderColor: 'var(--line)' },
            })]}
            onCreateEditor={(view) => {
              viewRef.current = view
            }}
            onChange={setDraft}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              // A manuscript is prose, not code: bracket matching and autocompletion
              // get in the way of writing dialogue.
              bracketMatching: false,
              closeBrackets: false,
              autocompletion: false,
            }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Markdown. Autosaves while you type; a revision is kept when you click away.
        </p>
      </div>

      <details className="mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/60 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
          Scene context and notes{annotations.data?.length ? ` · ${annotations.data.length} notes` : ''}
        </summary>
        <div className="mt-3 grid min-w-0 gap-4 border-t border-slate-200 dark:border-slate-700 pt-3 md:grid-cols-2 xl:grid-cols-3">
        <section>
          <h4 className="mb-1.5 font-semibold uppercase tracking-wide text-slate-400">
            This scene owes
          </h4>
          <dl className="space-y-1.5">
            <div>
              <dt className="text-slate-400">Goal</dt>
              <dd className="text-slate-700 dark:text-slate-200">{scene.goal ?? <Missing>not set</Missing>}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Conflict</dt>
              <dd className="text-slate-700 dark:text-slate-200">{scene.conflict ?? <Missing>not set</Missing>}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Outcome</dt>
              <dd className="text-slate-700 dark:text-slate-200">{scene.outcome ?? <Missing>not set</Missing>}</dd>
            </div>
          </dl>
        </section>

        {brief && (
          <section>
            <h4 className="mb-1.5 font-semibold uppercase tracking-wide text-slate-400">
              Chapter context
            </h4>
            <dl className="space-y-1.5">
              <div>
                <dt className="text-slate-400">Beat</dt>
                <dd className="text-slate-700 dark:text-slate-200">
                  {brief.beats.length ? (
                    brief.beats.map((b) => b.label).join(', ')
                  ) : (
                    <Missing>none</Missing>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Arc</dt>
                <dd className="text-slate-700 dark:text-slate-200">
                  {brief.arcs_advancing.length ? (
                    brief.arcs_advancing.map((a) => a.summary.replace('->', '→')).join(', ')
                  ) : (
                    <Missing>none</Missing>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Emotional shift</dt>
                <dd className="text-slate-700 dark:text-slate-200">
                  {brief.emotional_shift_from || brief.emotional_shift_to ? (
                    `${brief.emotional_shift_from ?? '?'} → ${brief.emotional_shift_to ?? '?'}`
                  ) : (
                    <Missing>none</Missing>
                  )}
                </dd>
              </div>
            </dl>
          </section>
        )}

        <section>
          <h4 className="mb-1.5 font-semibold uppercase tracking-wide text-slate-400">
            Notes {annotations.data?.length ? `(${annotations.data.length})` : ''}
          </h4>
          {annotations.data?.length === 0 && <p className="text-slate-400">None yet.</p>}
          <ul className="space-y-1.5">
            {annotations.data?.map((annotation) => (
              <li
                key={annotation.id}
                className={[
                  'rounded border-l-2 px-2 py-1.5',
                  annotation.is_orphaned
                    ? 'border-red-400 bg-red-50 dark:bg-red-950'
                    : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-950',
                ].join(' ')}
              >
                {annotation.is_orphaned && (
                  <p className="font-medium text-red-700 dark:text-red-300">
                    text gone — note kept so you can act on it
                  </p>
                )}
                <p className="truncate text-slate-500 dark:text-slate-400 italic">“{annotation.quoted_text}”</p>
                {annotation.note && <p className="text-slate-700 dark:text-slate-200">{annotation.note}</p>}
                <button
                  onClick={() => removeAnnotation.mutate(annotation.id)}
                  className="mt-0.5 text-[10px] text-slate-400 hover:text-red-600 dark:hover:text-red-300"
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        </section>
        </div>
      </details>
    </div>
  )
}

const Missing = ({ children }: { children: React.ReactNode }) => (
  <span className="text-slate-400 italic">{children}</span>
)
