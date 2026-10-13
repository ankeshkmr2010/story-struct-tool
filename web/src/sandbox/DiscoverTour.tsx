import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ManuscriptReading } from '../components/ManuscriptReading'
import { FIRST_SCENE, type Backup, type Row } from './storage'

const names = ['Catch up', 'Evaluate', 'Export', 'Sharing']
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
  const seed = useQuery({ queryKey: ['try-preview-seed'], enabled: open, queryFn: async () => {
    const response = await fetch('/sandbox/last-lantern-v1.json')
    if (!response.ok) throw new Error('The sample could not load. Please retry.')
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
  const download = (html: boolean) => {
    const prose = scenes.map(scene => `${String(scene.title)}\n\n${String(scene.content ?? '')}`).join('\n\n⁂\n\n')
    const text = html ? `<!doctype html><html lang="en"><meta charset="utf-8"><title>The Last Lantern — sample</title><body><h1>The Last Lantern</h1>${scenes.map(scene => `<section><h2>${escape(String(scene.title))}</h2>${String(scene.content ?? '').split(/\n\s*\n/).map(paragraph => `<p>${escape(paragraph)}</p>`).join('')}</section>`).join('')}</body></html>` : `The Last Lantern — sample\n\n${prose}`
    const url = URL.createObjectURL(new Blob([text], { type: html ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `last-lantern-sample.${html ? 'html' : 'txt'}`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    complete(2)
  }
  return <dialog ref={dialog} className="try-discover-dialog" aria-labelledby="discover-title" onClose={onClose} onCancel={onClose}>
    <header className="flex items-start justify-between gap-4"><div><p className="eyebrow">DISCOVER MORE · {step + 1} OF 4</p><h2 id="discover-title" className="text-xl font-semibold">What else can your story do?</h2><p className="writer-help">Explore examples from The Last Lantern. Your sandbox writing stays as it is.</p></div><button type="button" aria-label="Close Discover more tour" onClick={onClose}>✕</button></header>
    <nav className="history-tabs my-4" role="tablist" aria-label="Feature previews" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (step + (event.key === 'ArrowLeft' ? 3 : 1)) % 4
      setStep(next); document.getElementById(`discover-tab-${next}`)?.focus()
    }}>{names.map((name, index) => <button key={name} id={`discover-tab-${index}`} role="tab" type="button" aria-selected={step === index} aria-controls={`discover-panel-${index}`} tabIndex={step === index ? 0 : -1} onClick={() => setStep(index)}>{name}{visited.includes(index) ? ' ✓' : ''}</button>)}</nav>
    {seed.isPending && <p>Loading the sample…</p>}
    {seed.error && <p role="alert">{String(seed.error)} <button onClick={() => void seed.refetch()}>Retry</button></p>}
    {seed.data && <section id={`discover-panel-${step}`} role="tabpanel" aria-labelledby={`discover-tab-${step}`} className="space-y-4">
      {step === 0 && <><h3 className="level-title">Let the outline catch up with your writing</h3><p>Already have prose? Ask your AI to propose summaries, cast, places and links. Review the proposal in Agent changes before accepting it.</p><blockquote className="try-preview-prose">{String(first?.content ?? '').split('\n\n').at(-1)}</blockquote><button className="sharing-primary" onClick={() => { setOutline(!outline); complete(0) }}>{outline ? 'Hide example outline' : 'See proposed outline'}</button>{outline && <div className="try-preview-card"><p className="eyebrow">EXAMPLE PROPOSAL</p><dl><dt>Scene</dt><dd>The lantern goes out</dd><dt>Summary</dt><dd>Maya opens the door to Eli when she cannot mend the lantern alone.</dd><dt>Cast and place</dt><dd>Maya, Eli · Lighthouse</dd><dt>Plan links</dt><dd>Inciting incident · Isolation → Trust</dd></dl><p className="writer-help">Your prose stays intact. Keep all, some or none of the proposed outline changes.</p></div>}</>}
      {step === 1 && <><h3 className="level-title">Review the craft with scene evidence</h3><p>Evaluate checks scene rhythm and MICE nesting, and offers AI reviews of thread promises, value shifts and misbeliefs.</p><div className="try-preview-card"><p className="eyebrow">SAMPLE VALUE-SHIFT REVIEW</p><h4 className="font-semibold">Consider · The lantern goes out</h4><p>Maya begins in isolation, then asks Eli for help. The change toward trust appears in her decision to let him into the tower.</p><button className="underline mt-3" onClick={() => { setShowEvidence(true); complete(1) }}>Read the supporting scene →</button></div>{showEvidence && <article ref={evidence} className="try-preview-prose"><h4 className="font-semibold">The lantern goes out</h4>{String(first?.content ?? '').split('\n\n').map((paragraph, index) => <p key={index} className="my-3">{index === 6 ? <mark>{paragraph}</mark> : paragraph}</p>)}</article>}<p className="writer-help">Run checks when you want feedback. AI reviews use your connected client or provider key; you decide what to revise.</p></>}
      {step === 2 && <><h3 className="level-title">Take your manuscript with you</h3><p>Export your story as Word, Markdown, PDF, EPUB, HTML or plain text. Keep a full JSON backup for restoring the story and its structure.</p><label className="block">Preview a format <select className="ml-2 rounded border border-[var(--line)] p-2" value={format} onChange={event => setFormat(event.target.value)}>{['Word', 'Markdown', 'PDF', 'EPUB', 'HTML', 'Plain text'].map(name => <option key={name}>{name}</option>)}</select></label><div className="try-preview-card"><p className="eyebrow">{format.toUpperCase()} · FORMAT PREVIEW</p><h4 className="text-lg font-semibold">The Last Lantern</h4><p className="font-semibold my-2">Chapter 1 — The dark</p><p>{String(first?.content ?? '').split('\n\n')[0]}</p><p className="writer-help">{format === 'PDF' ? 'A submission manuscript with a title page, double-spaced prose and running headers.' : format === 'EPUB' ? 'An e-book for reading apps and devices.' : format === 'Word' ? 'An editable manuscript document.' : format === 'Markdown' ? 'Portable prose with simple text formatting.' : format === 'HTML' ? 'A standalone web page.' : 'Your manuscript as simple text.'}</p></div><div className="flex flex-wrap gap-3"><button className="sharing-primary" onClick={() => download(false)}>Download sample text</button><button className="underline" onClick={() => download(true)}>Download sample HTML</button></div></>}
      {step === 3 && <><h3 className="level-title">Let readers into your story</h3><p>Share privately with invited readers or enable a public read-only showcase. Beta reading rounds preserve a frozen draft for reader conversations and polls.</p><div className="flex gap-3" role="group" aria-label="Sharing examples"><button className="share-story-button" aria-pressed={access === 'private'} onClick={() => setAccess('private')}>Private sharing</button><button className="share-story-button" aria-pressed={access === 'public'} onClick={() => setAccess('public')}>Public showcase</button></div><div className="try-preview-card"><h4 className="font-semibold">{access === 'private' ? 'Only invited readers' : 'Anyone with your showcase link'}</h4><p>{access === 'private' ? 'Choose who can read your story, optionally allow importing a copy, and revoke access.' : 'Enable a read-only showcase and disable or rotate its link whenever you need to.'}</p><button className="sharing-primary mt-3" onClick={() => { setReader(!reader); complete(3) }}>{reader ? 'Close reader preview' : 'Open reader preview'}</button></div>{reader && <div className="try-reader-preview"><p className="eyebrow">READ-ONLY READER PREVIEW</p><ManuscriptReading structure={structure} storyId="try-sharing-preview" accountId="try-preview" contextAvailable={false} onPassage={() => {}} onContext={() => {}} /></div>}</>}
    </section>}
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4"><div className="flex gap-3"><button disabled={step === 0} onClick={() => setStep(index => index - 1)}>← Previous</button><button disabled={step === 3} onClick={() => setStep(index => index + 1)}>Next →</button></div><Link to="/how-to-use#write-with-ai" className="underline">How to write with AI →</Link>{visited.length === 4 && <button className="sharing-primary" onClick={onKeep}>Keep this story free →</button>}</footer>
  </dialog>
}
