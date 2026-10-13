import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api, type SearchContext, type LibrarySearchContext, type SearchHit } from '../api/client'
import { errorText } from '../api/errors'

const CONTEXT_FIELDS: Record<SearchContext, string[]> = {
  prose: ['content'],
  story: ['title', 'premise', 'blurb', 'thematic_statement', 'notes', 'motifs', 'world_rules', 'style_rules'],
  scene: ['title', 'summary', 'notes', 'goal', 'conflict', 'outcome'],
  character: ['name', 'aliases', 'description', 'wound', 'misbelief', 'want', 'need', 'voice_notes', 'relation_to_protagonist', 'notes'],
  location: ['name', 'description', 'atmosphere_notes'],
  glossary_entry: ['term', 'aliases', 'definition'],
  chapter: ['title', 'summary', 'epigraph', 'opening_note', 'closing_note'],
  event: ['label', 'description', 'display_label'],
  act: ['title', 'summary'], beat: ['label', 'description'], thread: ['title'],
  timeline: ['title', 'summary', 'label', 'description', 'display_label'],
}
const FIELDS: Record<LibrarySearchContext, string[]> = { ...CONTEXT_FIELDS, all: [...new Set(Object.values(CONTEXT_FIELDS).flat())] }
const SEARCH_LABELS: Record<LibrarySearchContext, string> = {
  prose: 'Prose', story: 'Premise and story planning', scene: 'Scenes', character: 'Characters',
  location: 'Places', glossary_entry: 'Glossary', chapter: 'Chapters', event: 'Arc skeleton',
  act: 'Acts', beat: 'Beats', thread: 'Threads', timeline: 'Timeline', all: 'your stories',
}
const types = (context: LibrarySearchContext) => context === 'all' ? Object.keys(CONTEXT_FIELDS).filter(kind => !['prose', 'timeline'].includes(kind)) : context === 'timeline' ? ['scene', 'event'] : []
const fieldLabel = (field: string) => field === 'content' ? 'Prose' : field.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())

function Highlight({ text, query }: { text: string; query: string }) {
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = query ? text.split(new RegExp(`(${pattern})`, 'gi')) : [text]
  return <>{parts.map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>
}

type Saved = { q: string; field: string; entity: string }
function savedSearch(key: string, context: LibrarySearchContext): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    return { q: typeof saved.q === 'string' ? saved.q.slice(0, 300) : '',
      field: FIELDS[context].includes(saved.field) ? saved.field : '',
      entity: types(context).includes(saved.entity) ? saved.entity : '' }
  } catch { return { q: '', field: '', entity: '' } }
}

type SearchProps = {
  storyId: string; accountId?: string; context: LibrarySearchContext | null; active: boolean;
  onOpen: (hit: SearchHit) => Promise<void>;
}
export function SearchDialog({ onClose, onReopen, ...props }: SearchProps & { onClose: () => void; onReopen: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [dialogError, setDialogError] = useState<string | null>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (props.active && !element.open) { element.showModal(); element.querySelector('input')?.focus() }
    else if (!props.active && element.open) element.close()
  }, [props.active])
  return <dialog ref={dialog} className="story-search-dialog" aria-labelledby={titleId} onClose={() => { setDialogError(null); onClose() }} onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close()
  }}>
    <header className="story-search-dialog-head"><h2 id={titleId}>Search</h2><button type="button" aria-label="Close search" onClick={() => dialog.current?.close()}>✕</button></header>
    {dialogError && <p role="alert" className="writer-error">{dialogError}</p>}
    <StorySearch {...props} onOpen={async hit => {
      setDialogError(null)
      try { await props.onOpen(hit); dialog.current?.close() }
      catch (error) { if (!dialog.current?.open) { setDialogError(errorText(error)); onReopen() }; throw error }
    }} />
  </dialog>
}
export function StorySearch({ context, ...props }: SearchProps) {
  if (!context) return <p className="writer-help">Select a story section, Timeline, Places or Glossary to search its saved content.</p>
  return <SearchResults key={`${props.storyId || props.accountId}:${context}`} {...props} context={context} />
}

function SearchResults({ storyId, accountId, context, active, onOpen }: SearchProps & { context: LibrarySearchContext }) {
  const scopeKey = storyId || `library:${accountId}`
  const storageKey = `storytool-search:${scopeKey}:${context}`
  const [saved] = useState(() => savedSearch(storageKey, context))
  const [input, setInput] = useState(saved.q)
  const [query, setQuery] = useState(saved.q)
  const [field, setField] = useState(saved.field)
  const [entity, setEntity] = useState(saved.entity)
  const [opening, setOpening] = useState<string | null>(null)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const capabilities = useQuery({ queryKey: ['search-capabilities', scopeKey],
    queryFn: () => storyId ? api.searchCapabilities(storyId) : api.librarySearchCapabilities(), enabled: active, retry: false })
  const semanticAvailable = capabilities.data?.semantic_available === true
  const search = (mode: 'text' | 'semantic', offset: number, signal?: AbortSignal) => storyId && context !== 'all' ? api.searchStory(storyId, context, query, field, entity, mode, offset, signal) : api.searchLibrary(context, query, field, entity, mode, offset, signal)
  const textResults = useInfiniteQuery({
    queryKey: ['story-search', scopeKey, context, query, field, entity, 'text'],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => search('text', pageParam, signal),
    getNextPageParam: page => page.next_offset ?? undefined,
    enabled: active && Boolean(query), retry: false,
  })
  const semanticResults = useInfiniteQuery({
    queryKey: ['story-search', scopeKey, context, query, field, entity, 'semantic'],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => search('semantic', pageParam, signal),
    getNextPageParam: page => page.next_offset ?? undefined,
    enabled: active && Boolean(query) && semanticAvailable, retry: false,
    refetchInterval: state => state.state.data?.pages.some(page => page.indexing) ? 5_000 : state.state.status === 'error' ? 30_000 : false,
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ q: input, field, entity })) } catch { /* Optional browser storage. */ }
  }, [storageKey, input, field, entity])
  useEffect(() => { if (active) searchInput.current?.focus() }, [active])
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [input])
  const hitsById = new Map<string, { hit: SearchHit; related: boolean }>()
  for (const hit of textResults.data?.pages.flatMap(page => page.items) ?? []) hitsById.set(`${hit.story_id}:${hit.entity}:${hit.id}`, { hit, related: false })
  for (const hit of semanticResults.data?.pages.flatMap(page => page.items) ?? []) {
    const key = `${hit.story_id}:${hit.entity}:${hit.id}`
    if (!hitsById.has(key)) hitsById.set(key, { hit, related: true })
  }
  const fresh = input.trim() === query
  const hits = fresh ? [...hitsById.values()] : []
  const indexing = semanticAvailable && semanticResults.data?.pages.some(page => page.indexing)
  const searching = !fresh || textResults.isFetching || (semanticAvailable && semanticResults.isFetching)
  const failed = textResults.isError && (!semanticAvailable || semanticResults.isError)
  const refresh = () => { void textResults.refetch(); if (semanticAvailable) void semanticResults.refetch() }
  const open = async (hit: SearchHit) => {
    setNavigationError(null); setOpening(hit.id)
    try { await onOpen(hit) } catch (error) { setNavigationError(errorText(error)) }
    finally { setOpening(null) }
  }
  return <section className="story-search" aria-label={`Search ${SEARCH_LABELS[context]}`}>
    <p className="story-search-context">In {SEARCH_LABELS[context]} <span>· Saved text</span></p>
    <form role="search" onSubmit={event => { event.preventDefault(); setNavigationError(null); if (input.trim() === query) refresh(); else setQuery(input.trim()) }}>
      <div className="story-search-input"><input ref={searchInput} autoFocus type="search" enterKeyHint="search" aria-label="Search text" placeholder="Find a name, phrase or idea…" maxLength={300} value={input} onChange={event => { setInput(event.target.value); setNavigationError(null) }} /></div>
      <div className="story-search-filters">
        {types(context).length > 0 && <label>Type<select aria-label="Search entity type" value={entity} onChange={event => { setEntity(event.target.value); setField('') }}>
          <option value="">{context === 'timeline' ? 'All timeline entries' : 'All types'}</option>{types(context).map(kind => <option key={kind} value={kind}>{SEARCH_LABELS[kind as LibrarySearchContext]}</option>)}
        </select></label>}
        {FIELDS[context].length > 1 && <label>Field<select aria-label="Search field" value={field} onChange={event => setField(event.target.value)}><option value="">All fields</option>{FIELDS[context].filter(name => !entity || (context === 'timeline' ? (entity === 'scene' ? ['title', 'summary'] : ['label', 'description', 'display_label']) : entity === 'scene' ? [...FIELDS.scene, 'content'] : FIELDS[entity as LibrarySearchContext]).includes(name)).map(name => <option key={name} value={name}>{fieldLabel(name)}</option>)}</select></label>}
      </div>
    </form>
    {!input.trim() && <p className="writer-help">Start typing to search.</p>}
    {input.trim() && (searching || (indexing && hits.length === 0)) && <p role="status" className="writer-help">Searching…</p>}
    {(failed || navigationError) && <div role="alert" className="writer-error"><p>{navigationError || 'Search could not finish. Please retry.'}</p><button type="button" className="share-story-button" onClick={() => { setNavigationError(null); refresh() }}>Retry</button></div>}
    {query && fresh && textResults.isSuccess && hits.length === 0 && !searching && !indexing && <p role="status" className="writer-help">No matches in {SEARCH_LABELS[context]}. Try another phrase or field.</p>}
    <ul className="story-search-results">{hits.map(({ hit, related }) => <li key={`${hit.story_id}:${hit.entity}:${hit.id}`}>
      {!storyId && <p className="story-search-story">{hit.story_title}</p>}
      <p className="story-search-kind">{SEARCH_LABELS[hit.entity as SearchContext] ?? hit.entity}{hit.chapter_id ? ` · ${hit.chapter_title || 'Untitled chapter'}` : hit.entity === 'scene' ? ' · Unfiled writing' : ''}</p>
      <h3>{hit.title}{related && <span className="story-search-related">Related</span>}</h3>
      {hit.matches.map(match => <p key={match.field} className="story-search-excerpt"><strong>{fieldLabel(match.field)}:</strong> <Highlight text={match.excerpt} query={query} /></p>)}
      <button type="button" className="share-story-button" disabled={opening !== null} onClick={() => { void open(hit) }}>{opening === hit.id ? 'Opening…' : hit.matches.some(match => match.field === 'content') ? 'Open passage' : 'Open item'}</button>
    </li>)}</ul>
    {(textResults.hasNextPage || semanticResults.hasNextPage) && <button type="button" className="share-story-button" disabled={searching} onClick={() => { if (textResults.hasNextPage) void textResults.fetchNextPage(); if (semanticResults.hasNextPage) void semanticResults.fetchNextPage() }}>{searching ? 'Loading…' : 'Load more'}</button>}
  </section>
}
