import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView, keymap } from '@codemirror/view'
import { api, type Chapter, type Scene, type StoryImage } from '../api/client'
import { errorText } from '../api/errors'
import { orderChapters, orderScenes } from '../api/ordering'
import { ChapterBriefCard } from './ChapterBriefCard'
import { SceneDetails } from './SceneDetails'
import { SceneDelete } from './SceneDelete'
import { SceneRevisions } from './SceneRevisions'
import { InlineText } from './fields'
import { useTheme } from './theme-context'
import { SANDBOX_ID, tourEvent } from '../sandbox/storage'
import { flushWriter, writerDraft, writerHasUnsaved } from './writerDraft'
import { StoryImagePicker, ImageFigure } from './StoryImages'

const imageMarkdown = (image: StoryImage) => `![${image.alt.replace(/[\]\n]/g, ' ')}](storytool-image:${image.id})`
const proseWords = (text: string) => text.replace(/!\[[^\]\n]*\]\(storytool-image:[0-9a-fA-F-]{36}\)/g, '').trim().split(/\s+/).filter(Boolean).length

export function StoryWriter({ storyId, registerFlush, openScene, panelOpen, onContextOpen }: { storyId: string; registerFlush: (flush: () => Promise<boolean>) => void; openScene?: { id: string; at: number; find?: string } | null; panelOpen?: boolean; onContextOpen?: () => void }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: [storyId === SANDBOX_ID ? 'sandbox-me' : 'me'], queryFn: api.currentUser })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const prefix = `storytool-writer:${me.data?.id}:${storyId}:`
  const positionKey = `storytool-writing-position:${storyId}`
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return localStorage.getItem(positionKey) } catch { return null }
  })
  const [showNavigation, setShowNavigation] = useState(() => window.matchMedia('(min-width: 701px)').matches)
  const [showContext, setShowContext] = useState(false)
  // One right-hand panel at a time: a workspace reference panel closes Writing context, and vice versa.
  useEffect(() => { if (panelOpen) setShowContext(false) }, [panelOpen])
  const [focus, setFocus] = useState(false)
  const [activeScene, setActiveScene] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const titleRef = useRef('')
  const creatingChapter = useRef<Promise<Chapter> | null>(null)
  const orderedChapters = orderChapters(chapters.data ?? [])
  const chapter = orderedChapters.find(item => item.id === selectedId) ?? (selectedId === 'unfiled' ? undefined : orderedChapters[0])
  const unfiled = selectedId === 'unfiled'
  const chapterScenes = orderScenes((scenes.data ?? []).filter(scene => scene.chapter_id === (unfiled ? null : chapter?.id)))
  const contextScene = chapterScenes.find(scene => scene.id === activeScene) ?? chapterScenes[0]
  const brief = useQuery({ queryKey: ['brief', storyId, chapter?.id], queryFn: () => api.getBrief(storyId, chapter!.id), enabled: Boolean(chapter) })

  useEffect(() => {
    registerFlush(() => flushWriter(prefix))
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (writerHasUnsaved(prefix)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('beforeunload', beforeUnload); void flushWriter(prefix) }
  }, [prefix, registerFlush])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setFocus(false); setShowContext(false); setShowNavigation(false) } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])

  const refresh = () => {
    for (const key of ['chapters', 'scenes', 'progress', 'brief', 'ladder', 'health']) void qc.invalidateQueries({ queryKey: [key, storyId] })
  }
  const remember = (id: string) => {
    setSelectedId(id); setActiveScene(null)
    try { localStorage.setItem(positionKey, id) } catch { /* Device preferences are optional. */ }
  }
  // A scene picked in the Timeline panel: open its chapter and put the cursor in it.
  // Waits for scenes to load, since Write may mount with the request (Design → Open in Write).
  const handledScene = useRef(0)
  useEffect(() => {
    const scene = openScene && openScene.at !== handledScene.current && scenes.data?.find(item => item.id === openScene.id)
    if (!scene) return
    handledScene.current = openScene.at
    void chooseChapter(scene.chapter_id ?? 'unfiled').then(async ok => {
      if (!ok) return
      setActiveScene(scene.id); setFocusTarget(scene.id)
      if (openScene?.find) for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const element = document.querySelector<HTMLElement>(`[data-writing-scene="${scene.id}"] .cm-editor`)
        const editor = element && EditorView.findFromDOM(element)
        if (!editor) continue
        const index = editor.state.doc.toString().toLocaleLowerCase().indexOf(openScene.find.toLocaleLowerCase())
        if (index >= 0) editor.dispatch({ selection: { anchor: index, head: index + openScene.find.length }, effects: EditorView.scrollIntoView(index, { y: 'center' }) })
        editor.focus()
        break
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openScene, scenes.data])
  const chooseChapter = async (id: string) => {
    if (!await flushWriter(prefix)) { setError('Your draft is still here. Resolve the save error before switching chapters.'); return false }
    setError(null); remember(id)
    return true
  }
  const ensureChapter = async () => {
    if (chapter) return chapter
    if (!creatingChapter.current) creatingChapter.current = api.createChapter(storyId, {
      number: Math.max(0, ...orderedChapters.map(item => item.number)) + 1,
      title: titleRef.current.trim() || undefined,
      sort_key: Math.max(0, ...orderedChapters.map(item => item.sort_key)) + 100,
    }).catch(error => { creatingChapter.current = null; throw error })
    return creatingChapter.current
  }
  const createScene = async () => {
    const parent = unfiled ? null : await ensureChapter()
    return api.createScene(storyId, {
      chapter_id: parent?.id,
      sort_key: Math.max(0, ...chapterScenes.map(item => item.sort_key)) + 100,
    })
  }
  const onCreated = (scene: Scene, content: string) => {
    qc.setQueryData(['content', storyId, scene.id], { scene_id: scene.id, content, word_count: proseWords(content) })
    qc.setQueryData<Scene[]>(['scenes', storyId], previous => [...(previous ?? []).filter(item => item.id !== scene.id), scene])
    if (creatingChapter.current) void creatingChapter.current.then(parent => {
      qc.setQueryData<Chapter[]>(['chapters', storyId], previous => [...(previous ?? []).filter(item => item.id !== parent.id), parent])
      if (!chapter && !unfiled) remember(parent.id)
    })
    setFocusTarget(scene.id); setActiveScene(scene.id); refresh()
  }
  const addScene = async () => {
    setAdding(true); setError(null)
    try {
      if (!await flushWriter(prefix)) throw new Error('Save the current draft before adding a scene break.')
      const scene = await createScene()
      onCreated(scene, '')
    } catch (error) { setError(errorText(error)) }
    finally { setAdding(false) }
  }
  const addChapter = async () => {
    setAdding(true); setError(null)
    try {
      if (!await flushWriter(prefix)) throw new Error('Save the current draft before adding a chapter.')
      const created = await api.createChapter(storyId, {
        number: Math.max(0, ...orderedChapters.map(item => item.number)) + 1,
        sort_key: Math.max(0, ...orderedChapters.map(item => item.sort_key)) + 100,
      })
      qc.setQueryData<Chapter[]>(['chapters', storyId], previous => [...(previous ?? []), created])
      creatingChapter.current = null; titleRef.current = ''; remember(created.id); setFocusTarget('blank'); refresh()
    } catch (error) { setError(errorText(error)) }
    finally { setAdding(false) }
  }

  if (chapters.isPending || scenes.isPending || me.isPending) return <p className="p-6">Loading manuscript…</p>
  if (chapters.isError || scenes.isError || me.isError) return <p role="alert">{errorText(chapters.error ?? scenes.error ?? me.error)}</p>

  return <div className={`story-writer ${focus ? 'writer-focus' : ''}`}>
    <div className="writer-toolbar">
      <button type="button" aria-expanded={showNavigation} onClick={() => { setShowNavigation(!showNavigation); setShowContext(false) }}>Chapters</button>
      <span className="writer-current-chapter">{unfiled ? 'Unfiled writing' : `Chapter ${chapter?.number ?? 1}`}</span>
      <span className="writer-toolbar-spacer" />
      <button type="button" aria-pressed={focus} onClick={() => setFocus(!focus)}>{focus ? 'Exit focus' : 'Focus'}</button>
      <button type="button" className="writer-context-toggle" aria-expanded={showContext} onClick={() => { if (!showContext) onContextOpen?.(); setShowContext(!showContext); setShowNavigation(false) }}>Context</button>
    </div>
    {error && <p role="alert" className="writer-error">{error}</p>}
    <div className={`writer-layout ${showContext && !focus ? 'writer-with-context' : ''} ${!showNavigation || focus ? 'writer-no-navigation' : ''}`}>
      {!focus && <nav aria-label="Manuscript chapters" className={`writer-navigation ${showNavigation ? 'writer-navigation-open' : ''}`}>
        <p className="eyebrow">MANUSCRIPT</p>
        {orderedChapters.map(item => <button key={item.id} type="button" aria-current={chapter?.id === item.id && !unfiled ? 'page' : undefined} onClick={() => { void chooseChapter(item.id) }}><span>Chapter {item.number}</span><strong>{item.title || 'Untitled'}</strong></button>)}
        {(scenes.data ?? []).some(scene => scene.chapter_id === null) && <button type="button" aria-current={unfiled ? 'page' : undefined} onClick={() => { void chooseChapter('unfiled') }}>Unfiled writing</button>}
        <button type="button" disabled={adding} onClick={() => { void addChapter() }}>+ New chapter</button>
      </nav>}
      <article className="writer-manuscript" aria-label="Chapter manuscript">
        <header className="writer-chapter-heading">
          <p className="eyebrow">{unfiled ? 'UNFILED WRITING' : `CHAPTER ${chapter?.number ?? 1}`}</p>
          {!unfiled && (chapter ? <InlineText value={chapter.title} placeholder="Chapter title (optional)" className="writer-title-input" onSave={async title => { await api.updateChapter(storyId, chapter.id, { title }); refresh() }} /> : <input aria-label="Chapter title" placeholder="Chapter title (optional)" className="writer-title-input" onChange={event => { titleRef.current = event.target.value }} />)}
          <p className="writer-help">Write freely. Scene names and structure can come later.</p>
        </header>
        {!unfiled && chapter && <div className="writer-chapter-extras" key={`top-${chapter.id}`}><ChapterExtra label="Epigraph" add="Add epigraph" value={chapter.epigraph} placeholder="Opening quote" onSave={async epigraph => { await api.updateChapter(storyId, chapter.id, { epigraph }); refresh() }} /><ChapterExtra label="Opening note" add="Add opening note" value={chapter.opening_note} placeholder="Opening flavour text" onSave={async opening_note => { await api.updateChapter(storyId, chapter.id, { opening_note }); refresh() }} /></div>}
        {chapterScenes.map((scene, index) => <Passage key={scene.id} {...{ storyId, prefix, scene }} separator={index > 0} focus={focusTarget === scene.id} onFocus={() => setActiveScene(scene.id)} refresh={refresh} />)}
        {chapterScenes.length === 0 && <Passage key={`blank:${chapter?.id ?? (unfiled ? 'unfiled' : 'new')}`} {...{ storyId, prefix }} draftKey={`blank:${chapter?.id ?? (unfiled ? 'unfiled' : 'new')}`} focus={focusTarget === 'blank'} createScene={createScene} onCreated={onCreated} onFocus={() => {}} refresh={refresh} />}
        {!unfiled && chapter && <div className="writer-chapter-extras" key={`end-${chapter.id}`}><ChapterExtra label="Closing note" add="Add closing note" value={chapter.closing_note} placeholder="Closing flavour text" onSave={async closing_note => { await api.updateChapter(storyId, chapter.id, { closing_note }); refresh() }} /></div>}
        <div className="writer-continuation">
          {chapterScenes.length > 0 && <button type="button" disabled={adding} onClick={() => { void addScene() }}>+ Scene break at end</button>}
          <button type="button" disabled={adding} onClick={() => { void addChapter() }}>+ Next chapter</button>
          {adding && <span role="status">Preparing…</span>}
        </div>
      </article>
      {showContext && !focus && <aside className="writer-context" aria-label="Writing context">
        <div className="writer-context-heading"><h2>Writing context</h2><button type="button" onClick={() => setShowContext(false)} aria-label="Close writing context">×</button></div>
        {brief.data && <ChapterBriefCard brief={brief.data} />}
        {contextScene ? <SceneDetails key={contextScene.id} storyId={storyId} scene={contextScene} onDeleted={() => { setActiveScene(null); refresh() }} /> : <p>Start writing to add scene details. Beats, characters, and locations are optional.</p>}
        {contextScene && <SceneRevisions key={`rev-${contextScene.id}`} storyId={storyId} sceneId={contextScene.id} flush={() => flushWriter(prefix)} onRestored={text => writerDraft(prefix + contextScene.id, text).useLatest(text)} />}
        <p className="writer-help">Timeline, places, glossary and the assistant open from the buttons above; Design holds the full outline.</p>
      </aside>}
    </div>
  </div>
}

function Passage({ storyId, prefix, scene, draftKey, separator = false, focus = false, createScene, onCreated, onFocus, refresh }: {
  storyId: string; prefix: string; scene?: Scene; draftKey?: string; separator?: boolean; focus?: boolean
  createScene?: () => Promise<Scene>; onCreated?: (scene: Scene, content: string) => void; onFocus: () => void; refresh: () => void
}) {
  const content = useQuery({ queryKey: ['content', storyId, scene?.id], queryFn: () => api.getContent(storyId, scene!.id), enabled: Boolean(scene) })
  if (scene && content.isPending) return <p className="writer-help">Loading passage…</p>
  if (content.isError) return <p role="alert" className="writer-error">{errorText(content.error)} <button type="button" onClick={() => { void content.refetch() }}>Retry</button></p>
  return <PassageEditor {...{ storyId, prefix, scene, draftKey, separator, focus, createScene, onCreated, onFocus, refresh }} initial={content.data?.content ?? ''} />
}

function PassageEditor({ storyId, prefix, scene, draftKey, initial, separator, focus, createScene, onCreated, onFocus, refresh }: Parameters<typeof Passage>[0] & { initial: string }) {
  const qc = useQueryClient()
  const { theme } = useTheme()
  const view = useRef<EditorView | null>(null)
  const realScene = useRef<Scene | undefined>(scene)
  const createdAnnounced = useRef(Boolean(scene))
  const lastCheckpoint = useRef(0)
  const draft = writerDraft(prefix + (scene?.id ?? draftKey!), initial)
  const state = useSyncExternalStore(draft.subscribe, draft.snapshot)
  const [imagesOpen, setImagesOpen] = useState(false)
  const insertion = useRef(0)
  const images = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId), enabled: storyId !== SANDBOX_ID })
  const [latest, setLatest] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  useEffect(() => { draft.configure(async (text, base) => {
    if (!realScene.current) realScene.current = await createScene!()
    const current = realScene.current
    draft.adopt(prefix + current.id)
    const snapshot = Date.now() - lastCheckpoint.current >= 60_000
    await api.saveContent(storyId, current.id, { content: text, expected_content: base, snapshot, snapshot_label: 'Writing checkpoint' })
    if (snapshot) lastCheckpoint.current = Date.now()
    qc.setQueryData(['content', storyId, current.id], { scene_id: current.id, content: text, word_count: proseWords(text) })
    if (!createdAnnounced.current) { createdAnnounced.current = true; onCreated?.(current, text) }
    refresh()
  }) }, [draft, storyId, prefix, createScene, qc, onCreated, refresh])
  useEffect(() => { draft.observe(initial) }, [draft, initial])
  useEffect(() => () => { if (draft.state.status !== 'error') void draft.flush() }, [draft])
  // Focus alone keeps the page where it is; bring the scene into view too (Open in Write, Timeline jumps).
  useEffect(() => { if (focus) { if (storyId === SANDBOX_ID && view.current) view.current.dispatch({ selection: { anchor: view.current.state.doc.length } }); view.current?.focus(); view.current?.dom.scrollIntoView({ behavior: 'smooth', block: 'center' }) } }, [focus, storyId])
  const review = async () => {
    try { setReviewError(null); setLatest(realScene.current ? (await api.getContent(storyId, realScene.current.id)).content ?? '' : '') }
    catch (error) { setReviewError(errorText(error)) }
  }
  const words = proseWords(state.text)
  return <section className="writer-passage" data-writing-scene={scene?.id} aria-label={scene?.title ?? 'Writing passage'}>
    {separator && <div className="writer-scene-break" aria-label="Scene break">⁂</div>}
    <div className="writer-passage-heading">
      {scene ? <InlineText value={scene.title} placeholder="Scene name (optional)" onSave={async title => { await api.updateScene(storyId, scene.id, { title }); refresh() }} /> : <span className="writer-help">Start writing…</span>}
      <span className="writer-passage-status" role="status">{words} words · {state.status === 'error' ? 'Not saved' : state.status === 'saving' ? 'Saving…' : state.status === 'unsaved' ? 'Unsaved' : storyId === SANDBOX_ID ? 'Saved in this browser' : 'Saved'}</span>
      {scene && <SceneDelete storyId={storyId} scene={scene} onDeleted={refresh} />}
      {storyId !== SANDBOX_ID && <button type="button" onClick={() => { insertion.current = view.current?.state.selection.main.head ?? state.text.length; setImagesOpen(true) }}>Insert image</button>}
    </div>
    {state.status === 'error' && <div role="alert" className="writer-error"><p>{state.error}</p><p>Your draft is preserved in this browser tab.</p><button type="button" onClick={() => { void draft.flush() }}>Retry save</button> <button type="button" onClick={() => { void review() }}>Review latest text</button>{reviewError && <p>{reviewError}</p>}{latest !== null && <div><h3>Latest saved text</h3><pre className="writer-latest">{latest || '(Empty passage)'}</pre><button type="button" onClick={() => { if (window.confirm('Replace your local draft with the latest saved text?')) { draft.useLatest(latest); setLatest(null) } }}>Use latest text</button> <button type="button" onClick={() => { if (window.confirm('Save your draft over the latest text? A prose revision will preserve the previous text.')) { lastCheckpoint.current = 0; draft.rebase(latest); setLatest(null); void draft.flush() } }}>Keep my draft</button></div>}</div>}
    <CodeMirror value={state.text} theme={theme} width="100%" minHeight={state.text ? undefined : '180px'} placeholder="Start writing your story…" onChange={(text, update) => { draft.change(text); if (storyId === SANDBOX_ID && update.transactions.some(transaction => transaction.isUserEvent('input'))) tourEvent('write') }} onCreateEditor={editor => { view.current = editor; if (focus) { if (storyId === SANDBOX_ID) editor.dispatch({ selection: { anchor: editor.state.doc.length } }); editor.focus(); editor.dom.scrollIntoView({ block: 'center' }) } }} onFocus={onFocus} onBlur={() => { if (draft.state.status !== 'error') void draft.flush() }} extensions={[
      markdown(), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': scene?.title ? `Prose: ${scene.title}` : 'Story prose', spellcheck: 'true', autocapitalize: 'sentences' }),
      keymap.of([{ key: 'Mod-s', run: () => { void draft.flush(); return true } }]),
      keymap.of(['ArrowDown', 'ArrowUp'].map(key => ({ key, run: (editor: EditorView) => {
        const selection = editor.state.selection.main
        const forward = key === 'ArrowDown'
        if (!selection.empty || selection.head !== (forward ? editor.state.doc.length : 0)) return false
        const passage = editor.dom.closest('.writer-passage')
        const neighbour = forward ? passage?.nextElementSibling : passage?.previousElementSibling
        const element = neighbour?.querySelector('.cm-editor')
        const next = element ? EditorView.findFromDOM(element as HTMLElement) : null
        if (!next) return false
        next.dispatch({ selection: { anchor: forward ? 0 : next.state.doc.length }, scrollIntoView: true })
        next.focus()
        return true
      } }))),
      EditorView.theme({ '&': { backgroundColor: 'var(--surface)', color: 'var(--ink)' }, '.cm-scroller': { fontFamily: 'Georgia, serif', fontSize: '18px', overflow: 'visible' }, '.cm-content': { padding: '12px 0 24px', lineHeight: '1.9' }, '.cm-focused': { outline: 'none' }, '.cm-cursor': { borderLeftColor: 'var(--accent)' } }),
    ]} basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, bracketMatching: false, closeBrackets: false, autocompletion: false }} />
    {Array.from(state.text.matchAll(/!\[([^\]\n]*)\]\(storytool-image:([0-9a-fA-F-]{36})\)/g)).map((match, index) => <ImageFigure key={`${match[2]}:${index}`} image={images.data?.images.find(image => image.id === match[2])} fallback={match[1]} />)}
    {imagesOpen && <StoryImagePicker storyId={storyId} onClose={() => setImagesOpen(false)} onSelect={async image => {
      const editor = view.current
      if (!editor) throw new Error('The writing passage is no longer open.')
      const at = Math.min(insertion.current, editor.state.doc.length)
      const insert = `\n\n${imageMarkdown(image)}\n\n`
      editor.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length } })
      if (!await draft.flush()) throw new Error('The image is inserted in your draft. Retry saving the passage.')
      editor.focus()
    }} />}
  </section>
}

/** An optional chapter field (epigraph, notes): a quiet "+ Add …" until it has text or the author opens it. */
function ChapterExtra({ label, add, value, placeholder, onSave }: { label: string; add: string; value: string | null; placeholder: string; onSave: (value: string | null) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  if (!value && !open) return <button type="button" className="writer-extra-add" onClick={() => setOpen(true)}>+ {add}</button>
  return <label className="writer-help">{label}<InlineText value={value} placeholder={placeholder} multiline onSave={onSave} /></label>
}
