import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { foldAccents } from './languages'
import { besideKind, openBeside } from './beside'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api, type SearchContext, type LibrarySearchContext, type SearchHit } from '../api/client'
import { errorText } from '../api/errors'
import { t, tx } from '../i18n'

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
  prose: tx('Prose'), story: tx('Premise and story planning'), scene: tx('Scenes'), character: tx('Characters'),
  location: tx('Places'), glossary_entry: tx('Glossary'), chapter: tx('Chapters'), event: tx('Arc skeleton'),
  act: tx('Acts'), beat: tx('Beats'), thread: tx('Threads'), timeline: tx('Timeline'), all: tx('your stories'),
}
const types = (context: LibrarySearchContext) => context === 'all' ? Object.keys(CONTEXT_FIELDS).filter(kind => !['prose', 'timeline'].includes(kind)) : context === 'timeline' ? ['scene', 'event'] : []
const fieldLabel = (field: string) => field === 'content' ? t('Prose') : field.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())

function Highlight({ text, query }: { text: string; query: string }) {
  // Accents are ignored, as in the search itself: "Jose" marks "José".
  const folded = foldAccents(text), wanted = foldAccents(query)
  const parts: string[] = []
  let from = 0
  for (let at = wanted ? folded.indexOf(wanted) : -1; at >= 0; at = folded.indexOf(wanted, from)) {
    parts.push(text.slice(from, at), text.slice(at, at + wanted.length))
    from = at + wanted.length
  }
  parts.push(text.slice(from))
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
  initialQuery?: string;
  onOpen: (hit: SearchHit) => Promise<void>;
}
export function SearchDialog({ onClose, onReopen, wholeStory, onWholeStory, tools, ...props }: SearchProps & { onClose: () => void; onReopen: () => void; wholeStory?: boolean; onWholeStory?: (whole: boolean) => void; tools?: { label: string; open: () => void }[] }) {
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
    <header className="story-search-dialog-head"><h2 id={titleId}>{t('Search')}</h2><button type="button" aria-label={t('Close search')} onClick={() => dialog.current?.close()}>✕</button></header>
    {onWholeStory && <div className="lib-view search-scope" role="group" aria-label={t('Search scope')}><button type="button" aria-pressed={!wholeStory} onClick={() => onWholeStory(false)}>{t('This section')}</button><button type="button" aria-pressed={Boolean(wholeStory)} onClick={() => onWholeStory(true)}>{t('All of this story')}</button></div>}
    {/* Tools this story keeps out of the rail stay one keystroke away (usability phase 2). */}
    {tools && tools.length > 0 && <div className="search-tools"><span>{t('Go to')}</span>{tools.map(tool => <button key={tool.label} type="button" className="lib-chip" onClick={() => { dialog.current?.close(); tool.open() }}>{tool.label}</button>)}</div>}
    {props.storyId === '00000000-0000-4000-8000-000000000001' && <div id="try-search-coach" />}
    {dialogError && <p role="alert" className="writer-error">{dialogError}</p>}
    <StorySearch {...props} onOpen={async hit => {
      setDialogError(null)
      try { await props.onOpen(hit); dialog.current?.close() }
      catch (error) { if (!dialog.current?.open) { setDialogError(errorText(error)); onReopen() }; throw error }
    }} />
  </dialog>
}
export function StorySearch({ context, ...props }: SearchProps) {
  if (!context) return <p className="writer-help">{t('Select a story section, Timeline, Places or Glossary to search its saved content.')}</p>
  return <SearchResults key={`${props.storyId || props.accountId}:${context}`} {...props} context={context} />
}

function SearchResults({ storyId, accountId, context, active, onOpen, initialQuery }: SearchProps & { context: LibrarySearchContext }) {
  const scopeKey = storyId || `library:${accountId}`
  const storageKey = `storytool-search:${scopeKey}:${context}`
  const [saved] = useState(() => savedSearch(storageKey, context))
  const [input, setInput] = useState(saved.q)
  const [query, setQuery] = useState(saved.q)
  useEffect(() => { if (initialQuery) { setInput(initialQuery); setQuery(initialQuery) } }, [initialQuery])
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
  const scopeLabel = context === 'all' && storyId ? t('this story') : t(SEARCH_LABELS[context])
  return <section className="story-search" aria-label={t('Search {0}', scopeLabel)}>
    <p className="story-search-context">{t('In {0}', scopeLabel)}{' '}<span>{t('· Saved text')}</span></p>
    <form role="search" onSubmit={event => { event.preventDefault(); setNavigationError(null); if (input.trim() === query) refresh(); else setQuery(input.trim()) }}>
      <div className="story-search-input"><input ref={searchInput} autoFocus type="search" enterKeyHint="search" aria-label={t('Search text')} placeholder={t('Find a name, phrase or idea…')} maxLength={300} value={input} onChange={event => { setInput(event.target.value); setNavigationError(null) }} /></div>
      <div className="story-search-filters">
        {types(context).length > 0 && <label>{t('Type')}<select aria-label={t('Search entity type')} value={entity} onChange={event => { setEntity(event.target.value); setField('') }}>
          <option value="">{context === 'timeline' ? t('All timeline entries') : t('All types')}</option>{types(context).map(kind => <option key={kind} value={kind}>{t(SEARCH_LABELS[kind as LibrarySearchContext])}</option>)}
        </select></label>}
        {FIELDS[context].length > 1 && <label>{t('Field')}<select aria-label={t('Search field')} value={field} onChange={event => setField(event.target.value)}><option value="">{t('All fields')}</option>{FIELDS[context].filter(name => !entity || (context === 'timeline' ? (entity === 'scene' ? ['title', 'summary'] : ['label', 'description', 'display_label']) : entity === 'scene' ? [...FIELDS.scene, 'content'] : FIELDS[entity as LibrarySearchContext]).includes(name)).map(name => <option key={name} value={name}>{fieldLabel(name)}</option>)}</select></label>}
      </div>
    </form>
    {!input.trim() && <p className="writer-help">{t('Start typing to search.')}</p>}
    {input.trim() && (searching || (indexing && hits.length === 0)) && <p role="status" className="writer-help">{t('Searching…')}</p>}
    {(failed || navigationError) && <div role="alert" className="writer-error"><p>{navigationError || t('Search could not finish. Please retry.')}</p><button type="button" className="share-story-button" onClick={() => { setNavigationError(null); refresh() }}>{t('Retry')}</button></div>}
    {query && fresh && textResults.isSuccess && hits.length === 0 && !searching && !indexing && <p role="status" className="writer-help">{t('No matches in {0}. Try another phrase or field.', scopeLabel)}</p>}
    <ul className="story-search-results">{hits.map(({ hit, related }) => <li key={`${hit.story_id}:${hit.entity}:${hit.id}`}>
      {!storyId && <p className="story-search-story">{hit.story_title}</p>}
      <p className="story-search-kind">{t(SEARCH_LABELS[hit.entity as SearchContext]) ?? hit.entity}{hit.chapter_id ? ` · ${hit.chapter_title || t('Untitled chapter')}` : hit.entity === 'scene' ? t(' · Unfiled writing') : ''}</p>
      <h3>{hit.title}<span className="story-search-related" title={related ? t('Matches a related idea') : t('Matches your search text')}>{related ? t('Related') : t('Exact')}</span></h3>
      {hit.matches.map(match => <p key={match.field} className="story-search-excerpt"><strong>{fieldLabel(match.field)}:</strong> <Highlight text={match.excerpt} query={query} /></p>)}
      {storyId && hit.story_id === storyId && besideKind(hit.entity) && <button type="button" className="share-story-button" title={t('Show it read-only beside the manuscript')} onClick={event => { openBeside({ kind: besideKind(hit.entity)!, id: hit.id }); event.currentTarget.closest('dialog')?.close() }}>{t('Open beside')}</button>}
      <button type="button" className="share-story-button" disabled={opening !== null} onClick={() => { void open(hit) }}>{opening === hit.id ? t('Opening…') : hit.matches.some(match => match.field === 'content') ? t('Open passage') : t('Open item')}</button>
    </li>)}</ul>
    {(textResults.hasNextPage || semanticResults.hasNextPage) && <button type="button" className="share-story-button" disabled={searching} onClick={() => { if (textResults.hasNextPage) void textResults.fetchNextPage(); if (semanticResults.hasNextPage) void semanticResults.fetchNextPage() }}>{searching ? t('Loading…') : t('Load more')}</button>}
  </section>
}
