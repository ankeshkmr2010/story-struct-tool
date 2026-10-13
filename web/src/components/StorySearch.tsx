import { Fragment, useEffect, useRef, useState } from 'react'
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

type Saved = { q: string; field: string; entity: string; mode: 'text' | 'semantic' }
function savedSearch(key: string, context: LibrarySearchContext): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    return { q: typeof saved.q === 'string' ? saved.q.slice(0, 300) : '',
      field: FIELDS[context].includes(saved.field) ? saved.field : '',
      entity: types(context).includes(saved.entity) ? saved.entity : '',
      mode: saved.mode === 'semantic' ? 'semantic' : 'text' }
  } catch { return { q: '', field: '', entity: '', mode: 'text' } }
}

type SearchProps = {
  storyId: string; accountId?: string; context: LibrarySearchContext | null; active: boolean;
  onOpen: (hit: SearchHit) => Promise<void>; entry?: { q: string; sequence: number };
  externalInput?: boolean; onQueryChange?: (query: string) => void;
}
export function StorySearch({ context, ...props }: SearchProps) {
  if (!context) return <p className="writer-help">Select a story section, Timeline, Places or Glossary to search its saved content.</p>
  return <SearchResults key={`${props.storyId || props.accountId}:${context}`} {...props} context={context} />
}

function SearchResults({ storyId, accountId, context, active, onOpen, entry, externalInput, onQueryChange }: SearchProps & { context: LibrarySearchContext }) {
  const scopeKey = storyId || `library:${accountId}`
  const storageKey = `storytool-search:${scopeKey}:${context}`
  const [saved] = useState(() => savedSearch(storageKey, context))
  const [input, setInput] = useState(saved.q)
  const [query, setQuery] = useState(saved.q)
  const [field, setField] = useState(saved.field)
  const [entity, setEntity] = useState(saved.entity)
  const [mode, setMode] = useState(saved.mode)
  const [opening, setOpening] = useState<string | null>(null)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const handledEntry = useRef(0)
  const capabilities = useQuery({ queryKey: ['search-capabilities', scopeKey],
    queryFn: () => storyId ? api.searchCapabilities(storyId) : api.librarySearchCapabilities(), enabled: active, retry: false })
  const semanticAvailable = capabilities.data?.semantic_available === true
  const effectiveMode = semanticAvailable ? mode : 'text'
  const results = useInfiniteQuery({
    queryKey: ['story-search', scopeKey, context, query, field, entity, effectiveMode],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => storyId && context !== 'all' ? api.searchStory(storyId, context, query, field, entity, effectiveMode, pageParam, signal) : api.searchLibrary(context, query, field, entity, effectiveMode, pageParam, signal),
    getNextPageParam: page => page.next_offset ?? undefined,
    enabled: active && Boolean(query), retry: false,
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ q: query, field, entity, mode: effectiveMode })) } catch { /* Optional browser storage. */ }
  }, [storageKey, query, field, entity, effectiveMode])
  useEffect(() => { if (active) searchInput.current?.focus() }, [active])
  const refetch = results.refetch
  useEffect(() => {
    if (!entry || handledEntry.current === entry.sequence) return
    handledEntry.current = entry.sequence
    setInput(entry.q); setNavigationError(null)
    if (entry.q === query) void refetch(); else setQuery(entry.q)
  }, [entry, query, refetch])
  useEffect(() => { onQueryChange?.(query) }, [query, onQueryChange])
  const hits = [...new Map((results.data?.pages.flatMap(page => page.items) ?? []).map(hit => [`${hit.story_id}:${hit.entity}:${hit.id}`, hit])).values()]
  const open = async (hit: SearchHit) => {
    setNavigationError(null); setOpening(hit.id)
    try { await onOpen(hit) } catch (error) { setNavigationError(errorText(error)) }
    finally { setOpening(null) }
  }
  return <section className="story-search" aria-label={`Search ${SEARCH_LABELS[context]}`}>
    <p className="writer-help">Searching {SEARCH_LABELS[context]} · Searches saved text</p>
    <form onSubmit={event => { event.preventDefault(); setNavigationError(null); if (input.trim() === query) void results.refetch(); else setQuery(input.trim()) }}>
      <div className={`story-search-input${externalInput ? ' story-search-external-input' : ''}`}><input ref={searchInput} type="search" enterKeyHint="search" aria-label="Search text" placeholder="Name or phrase…" maxLength={300} value={input} onChange={event => setInput(event.target.value)} /><button type="submit" className="share-story-button" disabled={!input.trim()}>Search</button></div>
      <div className="story-search-filters">
        <label>Type<select aria-label="Search entity type" value={entity} disabled={types(context).length === 0} onChange={event => { setEntity(event.target.value); setField('') }}>
          {types(context).length ? <><option value="">{context === 'timeline' ? 'All timeline entries' : 'All types'}</option>{types(context).map(kind => <option key={kind} value={kind}>{SEARCH_LABELS[kind as LibrarySearchContext]}</option>)}</> : <option value="">{SEARCH_LABELS[context]}</option>}
        </select></label>
        <label>Field<select aria-label="Search field" value={field} onChange={event => setField(event.target.value)}><option value="">All fields</option>{FIELDS[context].filter(name => !entity || (context === 'timeline' ? (entity === 'scene' ? ['title', 'summary'] : ['label', 'description', 'display_label']) : entity === 'scene' ? [...FIELDS.scene, 'content'] : FIELDS[entity as LibrarySearchContext]).includes(name)).map(name => <option key={name} value={name}>{fieldLabel(name)}</option>)}</select></label>
        <label>Match<select aria-label="Search matching mode" value={effectiveMode} onChange={event => setMode(event.target.value as 'text' | 'semantic')}><option value="text">Text</option><option value="semantic" disabled={!semanticAvailable}>Meaning{semanticAvailable ? '' : ' · not enabled'}</option></select></label>
      </div>
    </form>
    {query && <p className="writer-help mt-3">Results for “{query}”</p>}
    {results.data?.pages.some(page => page.indexing) && <p role="status" className="writer-help">Meaning search is updating for some stories.</p>}
    {!query && <p className="writer-help">Enter a name or phrase to search this context.</p>}
    {query && results.isPending && <p role="status" className="writer-help">Searching…</p>}
    {results.isFetching && !results.isPending && <p role="status" className="writer-help">Updating results…</p>}
    {(results.isError || navigationError) && <div role="alert" className="writer-error"><p>{navigationError || errorText(results.error)}</p><button type="button" className="share-story-button" onClick={() => { setNavigationError(null); void results.refetch() }}>Refresh results</button></div>}
    {query && results.isSuccess && hits.length === 0 && !results.data.pages.some(page => page.indexing) && <p role="status" className="writer-help">No matches in {SEARCH_LABELS[context]}. Try another phrase or field.</p>}
    <ul className="story-search-results">{hits.map(hit => <li key={`${hit.story_id}:${hit.entity}:${hit.id}`}>
      {!storyId && <p className="story-search-story">{hit.story_title}</p>}
      <p className="story-search-kind">{SEARCH_LABELS[hit.entity as SearchContext] ?? hit.entity}{hit.chapter_id ? ` · ${hit.chapter_title || 'Untitled chapter'}` : hit.entity === 'scene' ? ' · Unfiled writing' : ''}</p>
      <h3>{hit.title}</h3>
      {hit.matches.map(match => <p key={match.field} className="story-search-excerpt"><strong>{fieldLabel(match.field)}:</strong> <Highlight text={match.excerpt} query={effectiveMode === 'text' ? query : ''} /></p>)}
      <button type="button" className="share-story-button" disabled={opening !== null} onClick={() => { void open(hit) }}>{opening === hit.id ? 'Opening…' : hit.matches.some(match => match.field === 'content') ? 'Open passage' : 'Open item'}</button>
    </li>)}</ul>
    {results.hasNextPage && <button type="button" className="share-story-button" disabled={results.isFetching} onClick={() => { void results.fetchNextPage() }}>{results.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}
  </section>
}
