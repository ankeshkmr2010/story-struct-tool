import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { orderChapters } from '../api/ordering'

type Row = Record<string, unknown>
type Preferences = { layout: 'scroll' | 'pages'; size: number; font: 'serif' | 'sans'; spacing: number; width: 'narrow' | 'normal' | 'wide'; titles: boolean }
type Position = { anchor: string; fragment: number; within: number }
export type ReadingTarget = { chapterId?: string; sceneId?: string; sequence: number }
const preferencesKey = 'storytool-reader-settings-v1'
const defaults: Preferences = { layout: 'scroll', size: 18, font: 'serif', spacing: 1.8, width: 'normal', titles: false }
const text = (row: Row, field: string) => row[field] == null ? '' : String(row[field])
const order = (rows: Row[]) => [...rows].sort((a, b) => Number(a.sort_key ?? 0) - Number(b.sort_key ?? 0) || text(a, 'id').localeCompare(text(b, 'id')))
const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? '{}')
    return {
      layout: saved.layout === 'pages' ? 'pages' : 'scroll',
      size: typeof saved.size === 'number' && Number.isFinite(saved.size) ? bounded(saved.size, 14, 30) : 18,
      font: saved.font === 'sans' ? 'sans' : 'serif', spacing: [1.55, 1.8, 2.1].includes(saved.spacing) ? saved.spacing : 1.8,
      width: ['narrow', 'normal', 'wide'].includes(saved.width) ? saved.width : 'normal', titles: saved.titles === true,
    }
  } catch { return defaults }
}

function loadPlace(key: string): Position | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved && typeof saved.anchor === 'string') return { anchor: saved.anchor, fragment: bounded(Number(saved.fragment) || 0, 0, 10000), within: bounded(Number(saved.within) || 0, 0, 1) }
  } catch { /* Bookmarks are optional. */ }
  return null
}

export function ManuscriptReading({ structure, storyId, accountId, target, onPassage, onContext }: {
  structure: Record<string, Row[]>; storyId: string; accountId: string; target?: ReadingTarget
  onPassage: (chapterId: string, sceneId: string) => void
  onContext: (chapterId: string, sceneId: string) => void
}) {
  const [preferences, setPreferences] = useState(loadPreferences)
  const [page, setPage] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [progress, setProgress] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const flow = useRef<HTMLDivElement>(null)
  const appearance = useRef<HTMLDetailsElement>(null)
  const positionKey = `storytool-reading-place:${accountId}:${storyId}`
  const initialPlace = useMemo(() => loadPlace(positionKey), [positionKey])
  const place = useRef<Position | null>(initialPlace)
  const lastTarget = useRef<number | undefined>(undefined)
  const previousPassage = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const callbacks = useRef({ onPassage, onContext })
  useEffect(() => { callbacks.current = { onPassage, onContext } }, [onPassage, onContext])
  const sections = useMemo(() => {
    const chapters = orderChapters(structure.chapter ?? [])
    const scenes = order(structure.scene ?? [])
    const result = chapters.map(chapter => ({ id: text(chapter, 'id'), title: `Chapter ${text(chapter, 'number')}${chapter.title ? ` — ${text(chapter, 'title')}` : ''}`, scenes: scenes.filter(scene => scene.chapter_id === chapter.id) }))
    const unfiled = scenes.filter(scene => scene.chapter_id === null)
    if (unfiled.length || !chapters.length) result.push({ id: 'unfiled', title: 'Unfiled writing', scenes: unfiled })
    return result
  }, [structure])
  useEffect(() => { try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)) } catch { /* Preferences are optional. */ } }, [preferences])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && appearance.current) appearance.current.open = false }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  const persist = useCallback(() => {
    if (place.current) try { localStorage.setItem(positionKey, JSON.stringify(place.current)) } catch { /* No manuscript is stored on the device. */ }
  }, [positionKey])
  useEffect(() => {
    return () => { clearTimeout(saveTimer.current); persist() }
  }, [positionKey, persist])

  const anchorElement = useCallback((anchor: string) => Array.from(flow.current?.querySelectorAll<HTMLElement>('[data-reading-anchor]') ?? []).find(element => element.dataset.readingAnchor === anchor), [])
  const updatePlace = useCallback(() => {
    const port = viewport.current
    if (!port) return
    const bounds = port.getBoundingClientRect()
    const x = bounds.left + Math.min(35, bounds.width / 3)
    let anchor: HTMLElement | undefined
    for (const y of [18, 50, 90, 140]) {
      const candidate = document.elementsFromPoint(x, bounds.top + Math.min(y, bounds.height - 8))
        .map(element => element.closest<HTMLElement>('[data-reading-anchor]'))
        .find(element => element && flow.current?.contains(element))
      if (candidate) { anchor = candidate; break }
    }
    if (anchor) {
      const rects = Array.from(anchor.getClientRects())
      const fragment = Math.max(0, rects.findIndex(rect => rect.right > bounds.left && rect.left < bounds.right))
      const rect = rects[fragment]
      place.current = { anchor: anchor.dataset.readingAnchor!, fragment, within: rect ? bounded((bounds.top - rect.top) / Math.max(1, rect.height), 0, 1) : 0 }
      const chapterId = anchor.dataset.chapterId ?? 'unfiled'
      const sceneId = anchor.dataset.sceneId ?? ''
      const signature = `${chapterId}:${sceneId}`
      if (signature !== previousPassage.current) { previousPassage.current = signature; callbacks.current.onPassage(chapterId, sceneId) }
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(persist, 300)
    }
    if (preferences.layout === 'pages') setPage(Math.round(port.scrollLeft / (port.clientWidth + 32)))
    else setProgress(port.scrollHeight <= port.clientHeight ? 100 : Math.round(100 * port.scrollTop / (port.scrollHeight - port.clientHeight)))
  }, [preferences.layout, persist])

  const measure = useCallback(() => {
    const port = viewport.current
    const content = flow.current
    if (!port || !content || port.clientWidth === 0) return
    const pages = preferences.layout === 'pages' ? Math.max(1, Math.ceil((content.scrollWidth + 32) / (port.clientWidth + 32))) : 1
    setPageCount(pages)
    const saved = place.current
    const anchor = saved ? anchorElement(saved.anchor) : undefined
    if (anchor) {
      const bounds = port.getBoundingClientRect()
      const rects = Array.from(anchor.getClientRects())
      const rect = rects[Math.min(saved!.fragment, rects.length - 1)]
      if (rect) {
        if (preferences.layout === 'pages') {
          const destination = bounded(Math.floor((rect.left - bounds.left + port.scrollLeft + 1) / (port.clientWidth + 32)), 0, pages - 1)
          port.scrollLeft = destination * (port.clientWidth + 32); port.scrollTop = 0; setPage(destination)
        } else {
          port.scrollLeft = 0; port.scrollTop += rect.top - bounds.top + saved!.within * rect.height
        }
      }
    } else { port.scrollLeft = 0; port.scrollTop = 0; setPage(0) }
    requestAnimationFrame(updatePlace)
  }, [preferences.layout, anchorElement, updatePlace])
  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    let alive = true
    void document.fonts.ready.then(() => { if (alive) measure() })
    return () => { alive = false; observer.disconnect() }
  }, [measure, preferences.size, preferences.font, preferences.spacing, preferences.width, preferences.titles, structure])

  useEffect(() => {
    if (!target || lastTarget.current === target.sequence) return
    lastTarget.current = target.sequence
    const section = sections.find(item => item.id === target.chapterId)
    const anchor = target.sceneId ? `scene:${target.sceneId}` : `chapter:${section?.id ?? 'unfiled'}`
    place.current = { anchor, fragment: 0, within: 0 }
    measure()
  }, [target, sections, measure])

  const turnPage = (destination: number) => {
    const port = viewport.current
    if (!port) return
    const next = bounded(destination, 0, pageCount - 1)
    port.scrollLeft = next * (port.clientWidth + 32)
    setPage(next)
    requestAnimationFrame(updatePlace)
  }
  const change = (values: Partial<Preferences>) => { updatePlace(); setPreferences(current => ({ ...current, ...values })) }
  const style = { '--reading-size': `${preferences.size}px`, '--reading-font': preferences.font === 'serif' ? 'Georgia, serif' : 'Arial, sans-serif', '--reading-spacing': preferences.spacing, '--reading-width': preferences.width === 'narrow' ? '580px' : preferences.width === 'wide' ? '940px' : '760px' } as CSSProperties
  return <div className={`manuscript-reading reading-${preferences.layout}`} style={style}>
    <div className="reading-controls"><label>Reading layout<select aria-label="Reading layout" value={preferences.layout} onChange={event => change({ layout: event.target.value as Preferences['layout'] })}><option value="scroll">Continuous scroll</option><option value="pages">Pages</option></select></label>
      <details ref={appearance} className="reading-appearance"><summary>Appearance</summary><div className="reading-appearance-panel"><label>Font size · {preferences.size}px<input aria-label="Reading font size" type="range" min={14} max={30} step={1} value={preferences.size} onChange={event => change({ size: Number(event.target.value) })} /></label><label>Font<select aria-label="Reading font" value={preferences.font} onChange={event => change({ font: event.target.value as Preferences['font'] })}><option value="serif">Serif</option><option value="sans">Sans serif</option></select></label><label>Line spacing<select aria-label="Reading line spacing" value={preferences.spacing} onChange={event => change({ spacing: Number(event.target.value) })}><option value={1.55}>Compact</option><option value={1.8}>Comfortable</option><option value={2.1}>Roomy</option></select></label><label>Text width<select aria-label="Reading text width" value={preferences.width} onChange={event => change({ width: event.target.value as Preferences['width'] })}><option value="narrow">Narrow</option><option value="normal">Normal</option><option value="wide">Wide</option></select></label><label className="reading-title-option"><input type="checkbox" checked={preferences.titles} onChange={event => change({ titles: event.target.checked })} />Show scene names</label><button type="button" className="share-story-button" onClick={() => { updatePlace(); setPreferences(defaults) }}>Reset appearance</button></div></details>
      <span className="reading-progress" role="status">{preferences.layout === 'pages' ? `Page ${page + 1} of ${pageCount}` : `${bounded(progress, 0, 100)}% read`}</span>
    </div>
    <div className="reading-paper"><div ref={viewport} className="reading-scrollport" role="region" aria-label="Story reading area" tabIndex={0} onScroll={updatePlace} onClick={event => {
      if (preferences.layout !== 'pages' || event.detail > 1 || event.ctrlKey || event.metaKey || !window.getSelection()?.isCollapsed || (event.target as HTMLElement).closest('button,a,input,select,textarea')) return
      const port = viewport.current
      if (!port) return
      const x = event.clientX - port.getBoundingClientRect().left
      if (x < port.clientWidth * 0.16) turnPage(page - 1)
      else if (x > port.clientWidth * 0.84) turnPage(page + 1)
    }} onKeyDown={event => {
      if (preferences.layout !== 'pages' || (event.target as HTMLElement).closest('button,a,input,select,textarea')) return
      if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); turnPage(event.key === 'Home' ? 0 : event.key === 'End' ? pageCount - 1 : page + (['ArrowRight', 'PageDown'].includes(event.key) ? 1 : -1))
      }
    }}><div ref={flow} className="reading-flow">{sections.map(section => <section key={section.id} className="reading-chapter"><h2 data-reading-anchor={`chapter:${section.id}`} data-chapter-id={section.id}>{section.title}</h2>{section.scenes.length === 0 && <p className="writer-help">This chapter hasn’t been drafted yet.</p>}{section.scenes.map((scene, index) => <section key={text(scene, 'id')} className="reading-scene"><div data-reading-anchor={`scene:${text(scene, 'id')}`} data-chapter-id={section.id} data-scene-id={text(scene, 'id')} className="reading-scene-heading">{index > 0 && <span className="reading-scene-divider">⁂</span>}{preferences.titles && <h3>{text(scene, 'title') || `Scene ${index + 1}`}</h3>}<button type="button" className="reading-scene-context" aria-label={`Context for ${text(scene, 'title') || `scene ${index + 1}`}`} onClick={() => callbacks.current.onContext(section.id, text(scene, 'id'))}>Scene context</button></div>{text(scene, 'content').trim() ? text(scene, 'content').split(/\n\s*\n/).filter(part => part.trim()).map((paragraph, part) => <p key={part} className="reading-paragraph" data-reading-anchor={`paragraph:${text(scene, 'id')}:${part}`} data-chapter-id={section.id} data-scene-id={text(scene, 'id')}>{paragraph}</p>) : <p className="writer-help">This scene hasn’t been drafted yet.</p>}</section>)}</section>)}</div></div></div>
    {preferences.layout === 'pages' && <div className="reading-pagination"><button type="button" className="share-story-button" aria-label="Previous reading page" disabled={page <= 0} onClick={() => turnPage(page - 1)}>← Previous</button><span aria-live="polite">Page {page + 1} of {pageCount}</span><button type="button" className="share-story-button" aria-label="Next reading page" disabled={page >= pageCount - 1} onClick={() => turnPage(page + 1)}>Next →</button><p>Click the page edges, or use ← / → and Page Up / Down while the reading area is focused.</p></div>}
  </div>
}
