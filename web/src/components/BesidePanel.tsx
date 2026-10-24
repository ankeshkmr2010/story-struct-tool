import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { besideUrl, openBeside, type BesideItem, type BesideKind, type BesideTarget } from './beside'
import { SANDBOX_ID } from '../sandbox/storage'
import { t, tx } from '../i18n'

const KIND_LABELS: Record<BesideKind, string> = { scene: tx('Scene'), character: tx('Character'), location: tx('Place'), glossary_entry: tx('Glossary'), image: tx('Image') }
const IMAGE = /!\[([^\]\n]*)\]\([^\n)]*\)/g

/** Everything the panel can show, loaded with the same query keys the workspace already uses. */
function useBesideSources(storyId: string) {
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId) })
  const locations = useQuery({ queryKey: ['locations', storyId], queryFn: () => api.listLocations(storyId) })
  const glossary = useQuery({ queryKey: ['glossary', storyId], queryFn: () => api.listGlossary(storyId) })
  const images = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId), enabled: storyId !== SANDBOX_ID })
  return { scenes, chapters, characters, locations, glossary, images }
}
type Sources = ReturnType<typeof useBesideSources>

function itemTitle(sources: Sources, item: BesideItem): string {
  if (item.kind === 'scene') return sources.scenes.data?.find(scene => scene.id === item.id)?.title || t('Untitled scene')
  if (item.kind === 'character') return sources.characters.data?.find(character => character.id === item.id)?.name ?? t('Character')
  if (item.kind === 'location') return sources.locations.data?.find(location => location.id === item.id)?.name ?? t('Place')
  if (item.kind === 'glossary_entry') return sources.glossary.data?.find(entry => entry.id === item.id)?.term ?? t('Glossary entry')
  return sources.images.data?.images.find(image => image.id === item.id)?.name ?? t('Image')
}

function ScenePreview({ storyId, sceneId, sources }: { storyId: string; sceneId: string; sources: Sources }) {
  const content = useQuery({ queryKey: ['content', storyId, sceneId], queryFn: () => api.getContent(storyId, sceneId) })
  const scene = sources.scenes.data?.find(item => item.id === sceneId)
  const chapter = sources.chapters.data?.find(item => item.id === scene?.chapter_id)
  if (content.isPending) return <p className="writer-help">{t('Loading the scene…')}</p>
  if (content.error) return <p role="alert">{errorText(content.error)}</p>
  const paragraphs = (content.data.content ?? '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
  return <article className="beside-prose">
    {chapter && <p className="beside-meta">{t('Chapter {0}{1}', chapter.number, chapter.title ? `: ${chapter.title}` : '')}</p>}
    {paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index}>{paragraph.replace(IMAGE, (_, alt: string) => `[Image${alt ? `: ${alt}` : ''}]`)}</p>) : <p className="writer-help">{t('This scene has no prose yet.')}</p>}
  </article>
}

function Facts({ rows }: { rows: [string, string | null | undefined][] }) {
  const shown = rows.filter((row): row is [string, string] => Boolean(row[1]?.trim()))
  return shown.length ? <dl className="beside-facts">{shown.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl> : <p className="writer-help">{t('Nothing filled in yet.')}</p>
}

function ItemView({ storyId, item, sources }: { storyId: string; item: BesideItem; sources: Sources }) {
  const loading = <p className="writer-help">{t('Loading…')}</p>
  if (item.kind === 'scene') return <ScenePreview storyId={storyId} sceneId={item.id} sources={sources} />
  if (item.kind === 'character') {
    const character = sources.characters.data?.find(entry => entry.id === item.id)
    return character ? <Facts rows={[[tx('Also called'), character.aliases?.join(', ')], [tx('Role'), character.role], [tx('Description'), character.description]]} /> : loading
  }
  if (item.kind === 'location') {
    const location = sources.locations.data?.find(entry => entry.id === item.id)
    return location ? <Facts rows={[[tx('Description'), location.description], [tx('Atmosphere'), location.atmosphere_notes]]} /> : loading
  }
  if (item.kind === 'glossary_entry') {
    const entry = sources.glossary.data?.find(term => term.id === item.id)
    return entry ? <Facts rows={[[tx('Also written'), entry.aliases?.join(', ')], [tx('Definition'), entry.definition]]} /> : loading
  }
  const image = sources.images.data?.images.find(entry => entry.id === item.id)
  return image ? <figure className="beside-image"><img src={image.url} alt={image.alt} />{image.caption && <figcaption>{image.caption}</figcaption>}</figure> : loading
}

function Picker({ sources, onPick }: { sources: Sources; onPick: (item: BesideItem) => void }) {
  const [query, setQuery] = useState('')
  const options: (BesideItem & { label: string })[] = [
    ...(sources.scenes.data ?? []).map(scene => ({ kind: 'scene' as const, id: scene.id, label: scene.title || t('Untitled scene') })),
    ...(sources.characters.data ?? []).map(character => ({ kind: 'character' as const, id: character.id, label: character.name })),
    ...(sources.locations.data ?? []).map(location => ({ kind: 'location' as const, id: location.id, label: location.name })),
    ...(sources.glossary.data ?? []).map(entry => ({ kind: 'glossary_entry' as const, id: entry.id, label: entry.term })),
    ...(sources.images.data?.images ?? []).filter(image => !image.archived).map(image => ({ kind: 'image' as const, id: image.id, label: image.name })),
  ]
  const needle = query.trim().toLocaleLowerCase()
  const matches = options.filter(option => !needle || option.label.toLocaleLowerCase().includes(needle)).slice(0, 40)
  return <div className="beside-picker">
    <input autoFocus type="search" aria-label={t('Find something to open beside the manuscript')} placeholder={t('Find a scene, character, place, term or image')} value={query} onChange={event => setQuery(event.target.value)} />
    <ul>{matches.map(option => <li key={`${option.kind}:${option.id}`}><button type="button" onClick={() => onPick(option)}><span>{t(KIND_LABELS[option.kind])}</span>{option.label}</button></li>)}</ul>
    {!matches.length && <p className="writer-help">{t('Nothing matches.')}</p>}
  </div>
}

/** A small "Beside" button for cards and lists: shows the item read-only next to the manuscript. */
export function OpenBesideButton({ item, label }: { item: BesideItem; label: string }) {
  return <button type="button" className="open-beside-button" title={t('Show {0} read-only beside the manuscript', label)} aria-label={t('Open {0} beside the manuscript', label)} onClick={() => openBeside(item)}>{t('Beside')}</button>
}

/**
 * A read-only view of one scene, character, place, glossary entry or image beside the
 * manuscript, for checking a detail while writing. Nothing here edits the story.
 */
export function BesidePanel({ storyId, target, onChange, onClose }: {
  storyId: string
  target: BesideTarget
  onChange: (target: BesideTarget) => void
  onClose?: () => void
}) {
  const sources = useBesideSources(storyId)
  const item = target.kind === 'pick' ? null : target
  return <section className="beside-panel" aria-label={t('Beside the manuscript')}>
    <header className="beside-head">
      <div className="min-w-0"><p className="beside-meta">{t('{0} · read only', item ? t(KIND_LABELS[item.kind]) : t('Open beside'))}</p><h2>{item ? itemTitle(sources, item) : t('Choose what to show')}</h2></div>
      <div className="beside-actions">
        {item && <button type="button" onClick={() => onChange({ kind: 'pick' })}>{t('Change')}</button>}
        {item && storyId !== SANDBOX_ID && <a href={besideUrl(storyId, item)} target="_blank" rel="noopener noreferrer" title={t('Open in a new window, e.g. on a second screen')}>{t('New window ↗')}</a>}
        {onClose && <button type="button" aria-label={t('Close the beside panel')} onClick={onClose}>✕</button>}
      </div>
    </header>
    {item ? <ItemView storyId={storyId} item={item} sources={sources} /> : <Picker sources={sources} onPick={onChange} />}
  </section>
}
