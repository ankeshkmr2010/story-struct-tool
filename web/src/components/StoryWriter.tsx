import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
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
import { ImagePreview } from './StoryImages'
import { writerImages } from './writerImages'
import { ImageInsertionPicker } from './ImageInsertionPicker'
import { LiveWritingHints } from './LiveWritingHints'
import { readerComments } from './readerComments'
import { writerPlaceholders } from './writerPlaceholders'
import { openBeside, type BesideItem } from './beside'

type Named = { label: string; item: BesideItem }

const imageMarkdown = (image: StoryImage) => `![${image.alt.replace(/[\]\n]/g, ' ')}](storytool-image:${image.id})`
const proseWords = (text: string) => text.replace(/!\[[^\]\n]*\]\(storytool-image:[0-9a-fA-F-]{36}\)/g, '').trim().split(/\s+/).filter(Boolean).length

export function StoryWriter({ storyId, registerFlush, openScene, focus, onFocusChange, contextSlot, hintsSlot, liveHints, initialChapter, onChapterChange }: { storyId: string; registerFlush: (flush: () => Promise<boolean>) => void; openScene?: { id: string; at: number; find?: string; paragraph?: number } | null; focus: boolean; onFocusChange: (focus: boolean) => void; contextSlot?: HTMLElement | null; hintsSlot?: HTMLElement | null; liveHints: boolean; initialChapter?: string | null; onChapterChange?: (id: string) => void }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: [storyId === SANDBOX_ID ? 'sandbox-me' : 'me'], queryFn: api.currentUser })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const prefix = `storytool-writer:${me.data?.id}:${storyId}:`
  const positionKey = `storytool-writing-position:${storyId}`
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (initialChapter) return initialChapter
    try { return localStorage.getItem(positionKey) } catch { return null }
  })
  const [showNavigation, setShowNavigation] = useState(() => window.matchMedia('(min-width: 701px)').matches)
  const exitFocus = useRef(onFocusChange)
  useEffect(() => { exitFocus.current = onFocusChange }, [onFocusChange])
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
  const currentChapterId = unfiled ? 'unfiled' : chapter?.id
  useEffect(() => {
    if (currentChapterId) onChapterChange?.(currentChapterId)
  }, [currentChapterId, onChapterChange])
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
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { exitFocus.current(false); if (window.matchMedia('(max-width: 700px)').matches) setShowNavigation(false) } }
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
        const prose = editor.state.doc.toString()
        const paragraph = openScene.paragraph ? [...prose.matchAll(/(?:^|\n\s*\n)([\s\S]*?)(?=\n\s*\n|$)/g)].filter(part => part[1].trim())[openScene.paragraph - 1] : undefined
        const local = paragraph?.[1].toLocaleLowerCase().indexOf(openScene.find.toLocaleLowerCase()) ?? -1
        const index = paragraph && local >= 0 ? paragraph.index! + paragraph[0].indexOf(paragraph[1]) + local : prose.toLocaleLowerCase().indexOf(openScene.find.toLocaleLowerCase())
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
    {focus && <div className="writer-toolbar"><span className="writer-toolbar-spacer" /><button type="button" onClick={() => onFocusChange(false)}>Exit focus</button></div>}
    {error && <p role="alert" className="writer-error">{error}</p>}
    <div className={`writer-layout ${!showNavigation || focus ? 'writer-no-navigation' : ''}`}>
      {!focus && <nav aria-label="Manuscript chapters" className={`writer-navigation ${showNavigation ? 'writer-navigation-open' : ''}`}>
        <div className="writer-navigation-head"><p className="eyebrow">MANUSCRIPT</p><button type="button" aria-label="Hide chapters" title="Hide chapters" onClick={() => setShowNavigation(false)}>‹</button></div>
        {orderedChapters.map(item => <button key={item.id} type="button" aria-current={chapter?.id === item.id && !unfiled ? 'page' : undefined} onClick={() => { void chooseChapter(item.id) }}><span>Chapter {item.number}</span><strong>{item.title || 'Untitled'}</strong></button>)}
        {(scenes.data ?? []).some(scene => scene.chapter_id === null) && <button type="button" aria-current={unfiled ? 'page' : undefined} onClick={() => { void chooseChapter('unfiled') }}>Unfiled writing</button>}
        <button type="button" disabled={adding} onClick={() => { void addChapter() }}>+ New chapter</button>
      </nav>}
      <article className="writer-manuscript" aria-label="Chapter manuscript">
        {!showNavigation && !focus && <button type="button" className="writer-rail-open" onClick={() => setShowNavigation(true)}>☰ Chapters</button>}
        <header className="writer-chapter-heading">
          <p className="eyebrow">{unfiled ? 'UNFILED WRITING' : `CHAPTER ${chapter?.number ?? 1}`}</p>
          {!unfiled && (chapter ? <InlineText value={chapter.title} placeholder="Chapter title (optional)" className="writer-title-input" onSave={async title => { await api.updateChapter(storyId, chapter.id, { title }); refresh() }} /> : <input aria-label="Chapter title" placeholder="Chapter title (optional)" className="writer-title-input" onChange={event => { titleRef.current = event.target.value }} />)}
          <p className="writer-help">Write freely. Scene names and structure can come later.</p>
        </header>
        {!unfiled && chapter && <div className="writer-chapter-extras" key={`top-${chapter.id}`}><ChapterExtra label="Epigraph" add="Add epigraph" value={chapter.epigraph} placeholder="Opening quote" onSave={async epigraph => { await api.updateChapter(storyId, chapter.id, { epigraph }); refresh() }} /><ChapterExtra label="Opening note" add="Add opening note" value={chapter.opening_note} placeholder="Opening flavour text" onSave={async opening_note => { await api.updateChapter(storyId, chapter.id, { opening_note }); refresh() }} /></div>}
        {chapterScenes.map((scene, index) => <Passage key={scene.id} {...{ storyId, prefix, scene, hintsSlot }} liveHints={liveHints && contextScene?.id === scene.id} separator={index > 0} focus={focusTarget === scene.id} onFocus={() => setActiveScene(scene.id)} refresh={refresh} />)}
        {chapterScenes.length === 0 && <Passage key={`blank:${chapter?.id ?? (unfiled ? 'unfiled' : 'new')}`} {...{ storyId, prefix }} draftKey={`blank:${chapter?.id ?? (unfiled ? 'unfiled' : 'new')}`} focus={focusTarget === 'blank'} createScene={createScene} onCreated={onCreated} onFocus={() => {}} refresh={refresh} />}
        {!unfiled && chapter && <div className="writer-chapter-extras" key={`end-${chapter.id}`}><ChapterExtra label="Closing note" add="Add closing note" value={chapter.closing_note} placeholder="Closing flavour text" onSave={async closing_note => { await api.updateChapter(storyId, chapter.id, { closing_note }); refresh() }} /></div>}
        <div className="writer-continuation">
          {chapterScenes.length > 0 && <button type="button" disabled={adding} onClick={() => { void addScene() }}>+ Scene break at end</button>}
          <button type="button" disabled={adding} onClick={() => { void addChapter() }}>+ Next chapter</button>
          {adding && <span role="status">Preparing…</span>}
        </div>
      </article>
      {contextSlot && !focus && createPortal(<div className="writer-context" aria-label="Writing context">
        {brief.data && <ChapterBriefCard brief={brief.data} />}
        {contextScene ? <SceneDetails key={contextScene.id} storyId={storyId} scene={contextScene} essentials onDeleted={() => { setActiveScene(null); refresh() }} /> : <p>Start writing to add scene details. Beats, characters, and locations are optional.</p>}
        {contextScene && <SceneRevisions key={`rev-${contextScene.id}`} storyId={storyId} sceneId={contextScene.id} flush={() => flushWriter(prefix)} onRestored={text => writerDraft(prefix + contextScene.id, text).useLatest(text)} />}
        <p className="writer-help">Timeline, places, glossary and the assistant are tabs in this panel; Design holds the full outline.</p>
      </div>, contextSlot)}
    </div>
  </div>
}

function Passage({ storyId, prefix, scene, draftKey, separator = false, focus = false, liveHints = false, hintsSlot, createScene, onCreated, onFocus, refresh }: {
  storyId: string; prefix: string; scene?: Scene; draftKey?: string; separator?: boolean; focus?: boolean; liveHints?: boolean; hintsSlot?: HTMLElement | null
  createScene?: () => Promise<Scene>; onCreated?: (scene: Scene, content: string) => void; onFocus: () => void; refresh: () => void
}) {
  const content = useQuery({ queryKey: ['content', storyId, scene?.id], queryFn: () => api.getContent(storyId, scene!.id), enabled: Boolean(scene) })
  if (scene && content.isPending) return <p className="writer-help">Loading passage…</p>
  if (content.isError) return <p role="alert" className="writer-error">{errorText(content.error)} <button type="button" onClick={() => { void content.refetch() }}>Retry</button></p>
  return <PassageEditor {...{ storyId, prefix, scene, draftKey, separator, focus, liveHints, hintsSlot, createScene, onCreated, onFocus, refresh }} initial={content.data?.content ?? ''} />
}

function PassageEditor({ storyId, prefix, scene, draftKey, initial, separator, focus, liveHints, hintsSlot, createScene, onCreated, onFocus, refresh }: Parameters<typeof Passage>[0] & { initial: string }) {
  const qc = useQueryClient()
  const { theme } = useTheme()
  const view = useRef<EditorView | null>(null)
  const realScene = useRef<Scene | undefined>(scene)
  const createdAnnounced = useRef(Boolean(scene))
  const lastCheckpoint = useRef(0)
  const draft = writerDraft(prefix + (scene?.id ?? draftKey!), initial)
  const feedback = useQuery({ queryKey: ['beta-feedback', storyId, 'open'], queryFn: () => api.betaFeedback(storyId), enabled: storyId !== SANDBOX_ID && !!scene, staleTime: 60_000 })
  const comments = (feedback.data ?? []).filter(item => item.scene_id === scene?.id && item.quote).map(item => ({ id: item.id, quote: item.quote! }))
  const state = useSyncExternalStore(draft.subscribe, draft.snapshot)
  const [previewImage, setPreviewImage] = useState<StoryImage | null>(null)
  const [hintParagraph, setHintParagraph] = useState(1)
  const [imageAnchor, setImageAnchor] = useState<{ x: number; y: number; at: number } | null>(null)
  const [context, setContext] = useState<{ x: number; y: number; at: number; hasSelection: boolean; named: Named | null } | null>(null)
  const [clipboardError, setClipboardError] = useState('')
  // A small button beside a selection opens the same actions as right-click, so they are discoverable.
  const [selectionChip, setSelectionChip] = useState<{ x: number; y: number } | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const images = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId), enabled: storyId !== SANDBOX_ID })
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId), enabled: storyId !== SANDBOX_ID })
  const locations = useQuery({ queryKey: ['locations', storyId], queryFn: () => api.listLocations(storyId), enabled: storyId !== SANDBOX_ID })
  const glossary = useQuery({ queryKey: ['glossary', storyId], queryFn: () => api.listGlossary(storyId), enabled: storyId !== SANDBOX_ID })
  // Right-clicking a defined name offers to open it beside the manuscript.
  const nameAt = (editor: EditorView, at: number | null): Named | null => {
    if (at === null) return null
    const names: (Named & { text: string })[] = [
      ...(characters.data ?? []).flatMap(c => [c.name, ...(c.aliases ?? [])].map(text => ({ text, label: c.name, item: { kind: 'character' as const, id: c.id } }))),
      ...(locations.data ?? []).map(l => ({ text: l.name, label: l.name, item: { kind: 'location' as const, id: l.id } })),
      ...(glossary.data ?? []).flatMap(g => [g.term, ...(g.aliases ?? [])].map(text => ({ text, label: g.term, item: { kind: 'glossary_entry' as const, id: g.id } }))),
    ].filter(name => name.text.trim().length > 1).sort((a, b) => b.text.length - a.text.length)
    const line = editor.state.doc.lineAt(at)
    const offset = at - line.from
    const letter = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char)
    for (const name of names) {
      for (let index = line.text.indexOf(name.text); index >= 0; index = line.text.indexOf(name.text, index + 1)) {
        const end = index + name.text.length
        if (offset >= index && offset <= end && !letter(line.text[index - 1]) && !letter(line.text[end])) return { label: name.label, item: name.item }
      }
    }
    return null
  }
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
    void qc.invalidateQueries({ queryKey: ['placeholders', storyId] })
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
  const openContext = (editor: EditorView, x: number, y: number, pointer: boolean) => {
    const position = pointer ? editor.posAtCoords({ x, y }) : editor.state.selection.main.head
    const selected = editor.state.selection.main
    if (position !== null && (selected.empty || position < selected.from || position > selected.to)) editor.dispatch({ selection: { anchor: position } })
    setClipboardError(''); setContext({ x, y, at: position ?? editor.state.selection.main.head, hasSelection: !editor.state.selection.main.empty, named: nameAt(editor, position) }); setImageAnchor(null)
  }
  useEffect(() => {
    if (!context) return
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setContext(null) }
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setContext(null); view.current?.focus() } }
    const scroll = () => setContext(null)
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', dismiss); window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', dismiss); window.removeEventListener('scroll', scroll, true) }
  }, [context])
  useEffect(() => {
    if (!selectionChip) return
    const hide = () => setSelectionChip(null)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [selectionChip])
  // A selection becomes the TK's note; the cursor lands inside the marker, ready to type.
  const addPlaceholder = () => {
    const editor = view.current; if (!editor) return
    const { from, to } = editor.state.selection.main
    const selected = editor.state.sliceDoc(from, to)
    const marker = `[TK: ${selected}]`
    editor.dispatch({ changes: { from, to, insert: marker }, selection: { anchor: from + marker.length - 1 }, scrollIntoView: true, userEvent: 'input' })
    setContext(null); editor.focus()
  }
  const editClipboard = async (action: 'cut' | 'copy' | 'paste' | 'select') => {
    const editor = view.current; if (!editor) return
    const selection = editor.state.selection.main
    try {
      if (action === 'select') editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } })
      else if (action === 'paste') {
        const text = await navigator.clipboard.readText()
        editor.dispatch({ changes: { from: selection.from, to: selection.to, insert: text }, selection: { anchor: selection.from + text.length }, scrollIntoView: true })
      } else {
        await navigator.clipboard.writeText(editor.state.sliceDoc(selection.from, selection.to))
        if (action === 'cut') editor.dispatch({ changes: { from: selection.from, to: selection.to }, selection: { anchor: selection.from } })
      }
      setContext(null); editor.focus()
    } catch { setClipboardError(`Clipboard access unavailable. Close this menu and use ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+${action === 'paste' ? 'V' : action === 'cut' ? 'X' : 'C'}.`) }
  }
  const words = proseWords(state.text)
  return <section className="writer-passage" data-writing-scene={scene?.id} aria-label={scene?.title ?? 'Writing passage'}>
    {separator && <div className="writer-scene-break" aria-label="Scene break">⁂</div>}
    <div className="writer-passage-heading">
      {scene ? <InlineText value={scene.title} placeholder="Scene name (optional)" onSave={async title => { await api.updateScene(storyId, scene.id, { title }); refresh() }} /> : <span className="writer-help">Start writing…</span>}
      <span className="writer-passage-status" role="status">{words} words · {state.status === 'error' ? 'Not saved' : state.status === 'saving' ? 'Saving…' : state.status === 'unsaved' ? 'Unsaved' : storyId === SANDBOX_ID ? 'Saved in this browser' : 'Saved'}</span>
      {scene && <SceneDelete storyId={storyId} scene={scene} onDeleted={refresh} />}

    </div>
    {state.status === 'error' && <div role="alert" className="writer-error"><p>{state.error}</p><p>Your draft is preserved in this browser tab.</p><button type="button" onClick={() => { void draft.flush() }}>Retry save</button> <button type="button" onClick={() => { void review() }}>Review latest text</button>{reviewError && <p>{reviewError}</p>}{latest !== null && <div><h3>Latest saved text</h3><pre className="writer-latest">{latest || '(Empty passage)'}</pre><button type="button" onClick={() => { if (window.confirm('Replace your local draft with the latest saved text?')) { draft.useLatest(latest); setLatest(null) } }}>Use latest text</button> <button type="button" onClick={() => { if (window.confirm('Save your draft over the latest text? A prose revision will preserve the previous text.')) { lastCheckpoint.current = 0; draft.rebase(latest); setLatest(null); void draft.flush() } }}>Keep my draft</button></div>}</div>}
    <div className={liveHints && scene ? "writer-hint-layout" : undefined}>
    <CodeMirror onUpdate={update => {
      if (update.selectionSet || update.docChanged || update.focusChanged) {
        const selected = update.state.selection.main
        const coords = !selected.empty && update.view.hasFocus ? update.view.coordsAtPos(selected.to) : null
        setSelectionChip(coords ? { x: coords.right, y: coords.bottom } : null)
      }
      if (!liveHints || (!update.selectionSet && !update.docChanged && !update.focusChanged)) return
      const cursor = update.state.selection.main.head
      const parts = [...update.state.doc.toString().matchAll(/(?:^|\n\s*\n)([\s\S]*?)(?=\n\s*\n|$)/g)].filter(part => part[1].replace(/!\[[^\]\n]*\]\([^\n)]*\)/g, '').trim())
      const index = parts.findIndex(part => cursor <= part.index! + part[0].length)
      setHintParagraph(index >= 0 ? index + 1 : Math.max(1, parts.length))
    }} value={state.text} theme={theme} width="100%" minHeight={state.text ? undefined : '180px'} placeholder="Start writing your story…" onChange={(text, update) => { draft.change(text); if (storyId === SANDBOX_ID && update.transactions.some(transaction => transaction.isUserEvent('input'))) tourEvent('write') }} onCreateEditor={editor => { view.current = editor; if (focus) { if (storyId === SANDBOX_ID) editor.dispatch({ selection: { anchor: editor.state.doc.length } }); editor.focus(); editor.dom.scrollIntoView({ block: 'center' }) } }} onFocus={onFocus} onBlur={() => { if (draft.state.status !== 'error') void draft.flush() }} extensions={[
      markdown(), EditorView.lineWrapping,
      writerImages(images.data?.images ?? [], setPreviewImage),
      readerComments(comments),
      writerPlaceholders,
      EditorView.domEventHandlers({
        contextmenu: (event, editor) => { event.preventDefault(); openContext(editor, event.clientX, event.clientY, true); return true },
        // A click below the last line starts a new paragraph instead of extending the last one.
        mousedown: (event, editor) => {
          if (event.button !== 0 || event.shiftKey) return false
          const end = editor.state.doc.length
          const bottom = editor.coordsAtPos(end)?.bottom
          if (!end || bottom === undefined || event.clientY <= bottom + 4) return false
          event.preventDefault()
          const text = editor.state.doc.toString()
          const gap = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
          editor.dispatch({ changes: gap ? { from: end, insert: gap } : undefined, selection: { anchor: end + gap.length }, scrollIntoView: true, userEvent: 'input' })
          editor.focus()
          return true
        },
      }),
      keymap.of([{ key: 'Shift-F10', run: editor => { const coords = editor.coordsAtPos(editor.state.selection.main.head); openContext(editor, coords?.left ?? 20, coords?.bottom ?? 100, false); return true } }]),
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
    {liveHints && scene && <LiveWritingHints key={scene.id} slot={hintsSlot} storyId={storyId} sceneId={scene.id} sceneTitle={scene.title} content={state.text} currentParagraph={hintParagraph} onParagraph={(paragraph, find, wholeScene) => {
      const editor = view.current
      if (!editor) return
      if (wholeScene) { editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length }, effects: EditorView.scrollIntoView(0, { y: 'start' }) }); editor.focus(); return }
      const parts = [...editor.state.doc.toString().matchAll(/(?:^|\n\s*\n)([\s\S]*?)(?=\n\s*\n|$)/g)].filter(part => part[1].replace(/!\[[^\]\n]*\]\([^\n)]*\)/g, '').trim())
      const part = parts[paragraph - 1]
      if (!part) return
      const at = part.index! + part[0].indexOf(part[1])
      const match = find ? part[1].indexOf(find) : -1
      if (match >= 0) {
        editor.dispatch({ selection: { anchor: at + match, head: at + match + find!.length }, effects: EditorView.scrollIntoView(at + match, { y: 'center' }) }); editor.focus(); return
      }
      editor.dispatch({ selection: { anchor: at, head: find ? at + part[1].length : at }, scrollIntoView: true }); editor.focus()
    }} />}
    </div>
    {previewImage && <ImagePreview url={previewImage.url} alt={previewImage.alt} caption={previewImage.caption} onClose={() => { setPreviewImage(null); view.current?.focus() }} />}
    {selectionChip && !context && <button type="button" className="writer-selection-chip" aria-label="Writing actions for selection" title="Writing actions (or right-click)" style={{ left: Math.max(8, Math.min(selectionChip.x + 4, window.innerWidth - 48)), top: Math.max(8, Math.min(selectionChip.y + 6, window.innerHeight - 40)) }} onMouseDown={event => event.preventDefault()} onClick={() => { const editor = view.current; if (editor) openContext(editor, selectionChip.x, selectionChip.y + 6, false); setSelectionChip(null) }}>⋯</button>}
    {context && <div ref={menu} className="writer-context-menu" role="menu" aria-label="Writing actions" style={{ left: Math.max(8, Math.min(context.x, window.innerWidth - 208)), top: Math.max(8, Math.min(context.y, window.innerHeight - 284)) }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); const buttons = Array.from(menu.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a') ?? []); const index = buttons.indexOf(document.activeElement as HTMLElement)
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }}>
      {storyId !== SANDBOX_ID && <button type="button" role="menuitem" onClick={addPlaceholder}>Add TK here</button>}
      {storyId !== SANDBOX_ID && context.named && <button type="button" role="menuitem" onClick={() => { openBeside(context.named!.item); setContext(null) }}>Open {context.named.label} beside</button>}
      {storyId !== SANDBOX_ID && <button type="button" role="menuitem" onClick={() => { openBeside({ kind: 'pick' }); setContext(null) }}>Open scene beside…</button>}
      <button type="button" role="menuitem" onClick={() => { const anchor = context; setContext(null); if (storyId === SANDBOX_ID) window.dispatchEvent(new Event('storytool-try-images')); else setImageAnchor(anchor) }}>Insert image…</button>
      {(['cut', 'copy', 'paste', 'select'] as const).map(action => <button type="button" role="menuitem" key={action} disabled={(action === 'cut' || action === 'copy') && !context.hasSelection} onClick={() => { void editClipboard(action) }}>{({ cut: 'Cut', copy: 'Copy', paste: 'Paste', select: 'Select all' })[action]}</button>)}
      <a role="menuitem" href="https://emojidb.org/" target="_blank" rel="noopener noreferrer" onClick={() => setContext(null)}>Find emojis ↗</a>
      {clipboardError && <p role="alert">{clipboardError}</p>}
    </div>}
    {imageAnchor && <ImageInsertionPicker storyId={storyId} anchor={imageAnchor} onClose={() => { setImageAnchor(null); view.current?.focus() }} onInsert={async image => {
      if (!await draft.flush()) throw new Error('Save your writing before inserting an image.')
      const editor = view.current
      if (!editor) throw new Error('The writing passage is no longer open.')
      const at = Math.min(imageAnchor.at, editor.state.doc.length)
      const insert = `\n\n${imageMarkdown(image)}\n\n`
      editor.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
      // A failed save remains visible in the passage; closing avoids inserting twice on retry.
      if (await draft.flush()) await qc.invalidateQueries({ queryKey: ['images', storyId] })
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
