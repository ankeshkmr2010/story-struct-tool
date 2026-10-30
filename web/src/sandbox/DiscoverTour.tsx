import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ManuscriptReading } from '../components/ManuscriptReading'
import { ImageFigure } from '../components/StoryImages'
import { ImageInsertionPicker } from '../components/ImageInsertionPicker'
import type { StoryImage } from '../api/client'
import { FIRST_SCENE, type Backup, type Row } from './storage'
import lanternImage from './last-lantern-image.svg?raw'
import { t, tx } from '../i18n'

const names = [tx('Catch up'), tx('Check my story'), tx('Images'), tx('Export'), tx('Sharing')]
const imageId = '00000000-0000-4000-8000-000000000050'
const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(lanternImage)}`
// One public sample URL for the page lifetime, including preview re-entry.
const imagePreviewUrl = URL.createObjectURL(new Blob([lanternImage], { type: 'image/svg+xml' }))
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function DiscoverTour({ open, onClose, onKeep }: { open: boolean; onClose: () => void; onKeep: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const evidence = useRef<HTMLElement>(null)
  const [step, setStep] = useState(0)
  const [visited, setVisited] = useState<number[]>([])
  const [outline, setOutline] = useState(false)
  const [showEvidence, setShowEvidence] = useState(false)
  const [format, setFormat] = useState('Word')
  const [access, setAccess] = useState('private')
  const [reader, setReader] = useState(false)
  const [imageDeleted, setImageDeleted] = useState(false)
  const [imageAnchor, setImageAnchor] = useState<{ x: number; y: number } | null>(null)
  const [sampleInserted, setSampleInserted] = useState(false)
  useEffect(() => { const images = () => setStep(2); window.addEventListener('storytool-try-images', images); return () => window.removeEventListener('storytool-try-images', images) }, [])
  const [caption, setCaption] = useState('The lantern in Maya’s lighthouse.')
  const seed = useQuery({ queryKey: ['try-preview-seed'], enabled: open, queryFn: async () => {
    const response = await fetch('/sandbox/last-lantern-v1.json')
    if (!response.ok) throw new Error(t('The sample could not load. Please retry.'))
    return await response.json() as Backup
  } })
  const complete = (index: number) => setVisited(current => current.includes(index) ? current : [...current, index])
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current?.close()
  }, [open])
  useEffect(() => { if (showEvidence) evidence.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [showEvidence])
  const structure = Object.fromEntries(Object.entries(seed.data?.state ?? {}).filter(([, value]) => Array.isArray(value))) as Record<string, Row[]>
  const scenes = structure.scene ?? []
  const first = scenes.find(scene => scene.id === FIRST_SCENE)
  const sampleImage: StoryImage = { archived: false, focus_x: 0.5, focus_y: 0.5, show_public: false, manuscript_uses: 1, attachments: [], uses: [], size: 0, width: 800, height: 600, id: imageId, name: 'The Last Lantern illustration', url: imagePreviewUrl, alt: 'A glowing brass lantern beside a lighthouse window.', caption }
  const previewScenes = scenes.map(scene => {
    if (scene.id !== FIRST_SCENE || imageDeleted) return scene
    const [opening, ...rest] = String(scene.content ?? '').split(/\n\s*\n/)
    return { ...scene, content: [opening, `![${sampleImage.alt}](storytool-image:${imageId})`, ...rest].join('\n\n') }
  })
  const readingStructure = { ...structure, scene: previewScenes, story_image: imageDeleted ? [] : [sampleImage] }
  const sampleParagraph = (paragraph: string, html: boolean) => {
    if (paragraph.includes(`storytool-image:${imageId}`)) return html
      ? `<figure><img src="${imageUrl}" alt="${escape(sampleImage.alt)}"/><figcaption>${escape(caption)}</figcaption></figure>`
      : `[Image: ${sampleImage.alt}]${caption ? `\n\n${caption}` : ''}`
    return html ? `<p>${escape(paragraph)}</p>` : paragraph
  }
  const download = (html: boolean) => {
    const prose = previewScenes.map(scene => `${String(scene.title)}\n\n${String(scene.content ?? '').split(/\n\s*\n/).map(paragraph => sampleParagraph(paragraph, false)).join('\n\n')}`).join('\n\n⁂\n\n')
    const text = html ? `<!doctype html><html lang="en"><meta charset="utf-8"><title>The Last Lantern — sample</title><style>body{max-width:42em;margin:2em auto;padding:0 1em;font-family:Georgia,serif;line-height:1.7}img{max-width:100%;height:auto}figure{margin:1.5em 0}figcaption{text-align:center}</style><body><h1>The Last Lantern</h1>${previewScenes.map(scene => `<section><h2>${escape(String(scene.title))}</h2>${String(scene.content ?? '').split(/\n\s*\n/).map(paragraph => sampleParagraph(paragraph, true)).join('')}</section>`).join('')}</body></html>` : `The Last Lantern — sample\n\n${prose}`
    const url = URL.createObjectURL(new Blob([text], { type: html ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `last-lantern-sample.${html ? 'html' : 'txt'}`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    complete(3)
  }
  return <dialog ref={dialog} className="try-discover-dialog" aria-labelledby="discover-title" onClose={onClose} onCancel={onClose}>
    <header className="flex items-start justify-between gap-4"><div><p className="eyebrow">{t('DISCOVER MORE · {0} OF {1}', step + 1, names.length)}</p><h2 id="discover-title" className="text-xl font-semibold">{t('What else can your story do?')}</h2><p className="writer-help">{t('Explore examples from The Last Lantern. Your sandbox writing stays as it is.')}</p></div><button type="button" aria-label={t('Close Discover more tour')} onClick={onClose}>✕</button></header>
    <nav className="history-tabs my-4" role="tablist" aria-label={t('Feature previews')} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : (step + (event.key === 'ArrowLeft' ? names.length - 1 : 1)) % names.length
      setStep(next); document.getElementById(`discover-tab-${next}`)?.focus()
    }}>{names.map((name, index) => <button key={name} id={`discover-tab-${index}`} role="tab" type="button" aria-selected={step === index} aria-controls={`discover-panel-${index}`} tabIndex={step === index ? 0 : -1} onClick={() => setStep(index)}>{t(name)}{visited.includes(index) ? ' ✓' : ''}</button>)}</nav>
    {seed.isPending && <p>{t('Loading the sample…')}</p>}
    {seed.error && <p role="alert">{String(seed.error)} <button onClick={() => void seed.refetch()}>{t('Retry')}</button></p>}
    {seed.data && <section id={`discover-panel-${step}`} role="tabpanel" aria-labelledby={`discover-tab-${step}`} className="space-y-4">
      {step === 2 && <><h3 className="level-title">{t('Illustrate your story, keep reference art nearby')}</h3><p>{t('In a saved story, Images in the header manages uploads and captions. Right-click in Write and choose Insert image to place an illustration at that spot; Add reference image keeps artwork beside a character, place, glossary entry or scene.')}</p><div className="try-preview-card"><p className="eyebrow">{t('INTERACTIVE IMAGE SAMPLE')}</p><p tabIndex={0} className="try-insertion-target" onContextMenu={event => { event.preventDefault(); setImageAnchor({ x: event.clientX, y: event.clientY }) }} onKeyDown={event => { if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setImageAnchor({ x: box.left, y: box.bottom }) } }}>{t('Maya lifted the lantern.')}{' '}<strong>{t('Right-click here to insert the sample illustration.')}</strong></p><button className="share-story-button" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setImageAnchor({ x: box.left, y: box.bottom }) }}>{t('Try compact image picker')}</button>{sampleInserted && <p role="status">{t('Sample illustration inserted here. This preview does not change your sandbox draft.')}</p>}{step === 2 && imageAnchor && <ImageInsertionPicker storyId="try-image-insertion-preview" anchor={imageAnchor} sampleImages={[sampleImage]} onClose={() => setImageAnchor(null)} onInsert={async () => { setImageDeleted(false); setSampleInserted(true); complete(2) }} />}{imageDeleted ? <><p role="status">{t('The image has been removed from this preview.')}</p><button className="share-story-button" onClick={() => { setImageDeleted(false); complete(2) }}>{t('Restore sample image')}</button></> : <><div onClick={() => complete(2)}><ImageFigure image={sampleImage} /></div><label className="block">{t('Sample caption (preview only)')}<input className="mt-2 w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2" value={caption} maxLength={1000} onChange={event => { setCaption(event.target.value); complete(2) }} /></label><button className="share-story-button mt-3" onClick={() => { setImageDeleted(true); complete(2) }}>{t('Delete sample image')}</button></>}</div><button className="sharing-primary" onClick={() => { setReader(!reader); complete(2) }}>{reader ? t('Close Read preview') : t('See the image in Read')}</button>{reader && <ManuscriptReading structure={readingStructure} storyId="try-images-preview" accountId="try-preview" contextAvailable={false} onPassage={() => {}} onContext={() => {}} />}<p className="writer-help">{t('Click the illustration for a larger preview. In your saved story, Delete removes current manuscript and reference uses while history keeps the file. This sample is separate from your sandbox draft.')}</p><Link className="underline" to="/how-to-use#images">{t('Image steps and upload limits →')}</Link></>}
      {step === 0 && <><h3 className="level-title">{t('Let the outline catch up with your writing')}</h3><p>{t('Already have prose? Ask your AI to propose summaries, cast, places and links. Review the proposal in Agent changes before accepting it.')}</p><blockquote className="try-preview-prose">{String(first?.content ?? '').split('\n\n').at(-1)}</blockquote><button className="sharing-primary" onClick={() => { setOutline(!outline); complete(0) }}>{outline ? t('Hide example outline') : t('See proposed outline')}</button>{outline && <div className="try-preview-card"><p className="eyebrow">{t('EXAMPLE PROPOSAL')}</p><dl><dt>{t('Scene')}</dt><dd>{t('The lantern goes out')}</dd><dt>{t('Summary')}</dt><dd>{t('Maya opens the door to Eli when she cannot mend the lantern alone.')}</dd><dt>{t('Cast and place')}</dt><dd>{t('Maya, Eli · Lighthouse')}</dd><dt>{t('Plan links')}</dt><dd>{t('Inciting incident · Isolation → Trust')}</dd></dl><p className="writer-help">{t('Your prose stays intact. Keep all, some or none of the proposed outline changes.')}</p></div>}</>}
      {step === 1 && <><h3 className="level-title">{t('Review the craft with scene evidence')}</h3><p>{t('Check my story reads your scenes with StoryTool\'s built-in reader to check rhythm, value shifts, MICE nesting and more, with no AI key needed. Your own AI can add deeper reviews.')}</p><div className="try-preview-card"><p className="eyebrow">{t('SAMPLE VALUE-SHIFT REVIEW')}</p><h4 className="font-semibold">{t('Consider · The lantern goes out')}</h4><p>{t('Maya begins in isolation, then asks Eli for help. The change toward trust appears in her decision to let him into the tower.')}</p><button className="underline mt-3" onClick={() => { setShowEvidence(true); complete(1) }}>{t('Read the supporting scene →')}</button></div>{showEvidence && <article ref={evidence} className="try-preview-prose"><h4 className="font-semibold">{t('The lantern goes out')}</h4>{String(first?.content ?? '').split('\n\n').map((paragraph, index) => <p key={index} className="my-3">{index === 6 ? <mark>{paragraph}</mark> : paragraph}</p>)}</article>}<p className="writer-help">{t('Run checks when you want feedback. Optional AI reviews use your connected Claude or ChatGPT; you decide what to revise.')}</p></>}
      {step === 3 && <><h3 className="level-title">{t('Take your manuscript with you')}</h3><p>{t('Export your story as Word, Markdown, PDF, EPUB, HTML or plain text. Illustrations stay at their manuscript positions. Keep a full JSON backup with image files for restoring the story and its structure.')}</p><label className="block">{t('Preview a format')}{' '}<select className="ml-2 rounded border border-[var(--line)] p-2" value={format} onChange={event => setFormat(event.target.value)}>{['Word', 'Markdown', 'PDF', 'EPUB', 'HTML', 'Plain text'].map(name => <option key={name} value={name}>{name === 'Plain text' ? t('Plain text') : name}</option>)}</select></label><div className="try-preview-card"><p className="eyebrow">{t('{0} · FORMAT PREVIEW', format.toUpperCase())}</p><h4 className="text-lg font-semibold">{t('The Last Lantern')}</h4><p className="font-semibold my-2">{t('Chapter 1 — The dark')}</p><p>{String(first?.content ?? '').split('\n\n')[0]}</p>{!imageDeleted && (format === 'Plain text' ? <p>{t('[Image: {0}]', sampleImage.alt)}{caption && <><br />{caption}</>}</p> : <ImageFigure image={sampleImage} />)}<p className="writer-help">{format === 'PDF' ? t('A submission manuscript with a title page, double-spaced prose, running headers and illustrations in place.') : format === 'EPUB' ? t('An e-book with embedded illustrations for reading apps and devices.') : format === 'Word' ? t('An editable manuscript with illustrations and captions in place.') : format === 'Markdown' ? t('A manuscript and image folder packaged together in a ZIP.') : format === 'HTML' ? t('A standalone web page with embedded illustrations.') : t('Plain text with image descriptions and captions at their manuscript positions.')}</p></div><div className="flex flex-wrap gap-3"><button className="sharing-primary" onClick={() => download(false)}>{t('Download sample text')}</button><button className="underline" onClick={() => download(true)}>{t('Download sample HTML')}</button></div></>}
      {step === 4 && <><h3 className="level-title">{t('Let readers into your story')}</h3><p>{t('Share privately with invited readers or enable a public read-only showcase. Beta reading rounds preserve a frozen draft for reader conversations and polls.')}</p><div className="flex gap-3" role="group" aria-label={t('Sharing examples')}><button className="share-story-button" aria-pressed={access === 'private'} onClick={() => setAccess('private')}>{t('Private sharing')}</button><button className="share-story-button" aria-pressed={access === 'public'} onClick={() => setAccess('public')}>{t('Public showcase')}</button></div><div className="try-preview-card"><h4 className="font-semibold">{access === 'private' ? t('Only invited readers') : t('Anyone with your showcase link')}</h4><p>{access === 'private' ? t('Choose who can read your story, optionally allow importing a copy, and revoke access.') : t('Enable a read-only showcase and disable or rotate its link whenever you need to.')}</p><button className="sharing-primary mt-3" onClick={() => { setReader(!reader); complete(4) }}>{reader ? t('Close reader preview') : t('Open reader preview')}</button></div>{reader && <div className="try-reader-preview"><p className="eyebrow">{t('READ-ONLY READER PREVIEW')}</p><ManuscriptReading structure={readingStructure} storyId="try-sharing-preview" accountId="try-preview" contextAvailable={false} onPassage={() => {}} onContext={() => {}} /></div>}</>}
    </section>}
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4"><div className="flex gap-3"><button disabled={step === 0} onClick={() => setStep(index => index - 1)}>{t('← Previous')}</button><button disabled={step === names.length - 1} onClick={() => setStep(index => index + 1)}>{t('Next →')}</button></div><Link to="/how-to-use#write-with-ai" className="underline">{t('How to write with AI →')}</Link>{visited.length === names.length && <button className="sharing-primary" onClick={onKeep}>{t('Keep this story free →')}</button>}</footer>
  </dialog>
}
