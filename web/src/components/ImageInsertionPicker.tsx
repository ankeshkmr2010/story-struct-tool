import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, uploadStoryImage, type StoryImage } from '../api/client'
import { errorText } from '../api/errors'

export function ImageInsertionPicker({ storyId, anchor, onInsert, onClose, sampleImages }: {
  storyId: string; anchor: { x: number; y: number }; onInsert: (image: StoryImage) => Promise<void>; onClose: () => void; sampleImages?: StoryImage[]
}) {
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef<AbortController | null>(null)
  const uploadId = useRef('')
  const qc = useQueryClient()
  const library = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId), enabled: !sampleImages })
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [name, setName] = useState('')
  const [alt, setAlt] = useState('')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const close = useRef(onClose)
  const saving = useRef(busy)
  useEffect(() => { close.current = onClose; saving.current = busy }, [onClose, busy])
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const dismiss = (event: PointerEvent) => { if (!saving.current && !panel.current?.contains(event.target as Node)) close.current() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving.current || cancel.current) { cancel.current?.abort(); close.current() } } }
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key, true) }
  }, [])
  useEffect(() => () => cancel.current?.abort(), [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const insert = async (image: StoryImage) => {
    setBusy(true); setError('')
    try { await onInsert(image); onClose() } catch (error) { setError(errorText(error)); setBusy(false) }
  }
  const assets = sampleImages ?? library.data?.images.filter(image => !image.archived) ?? []
  const width = Math.min(340, window.innerWidth - 16)
  return <div ref={panel} className="image-insertion-picker" role="dialog" aria-label="Insert image at this position" style={{ width, left: Math.max(8, Math.min(anchor.x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(anchor.y, window.innerHeight - Math.min(440, window.innerHeight * .7) - 8)) }}>
    <header className="story-images-head"><h3>Insert image here</h3><button type="button" disabled={busy} onClick={onClose}>Close</button></header>
    <p className="writer-help">Your writing position is kept. Choose an image to insert it.</p>
    {error && <p role="alert" className="writer-error">{error}</p>}
    {!uploading ? <>
      {!sampleImages && <button type="button" className="share-story-button" disabled={busy || !library.data || library.data.retained_count >= library.data.max_images || library.data.retained_bytes >= library.data.max_story_bytes} onClick={() => setUploading(true)}>Upload new image</button>}
      {library.isPending && !sampleImages && <p role="status">Loading images…</p>}
      {library.isError && !sampleImages && <p role="alert">{errorText(library.error)} <button type="button" onClick={() => { void library.refetch() }}>Retry</button></p>}
      {(sampleImages || library.data) && !assets.length && <p>No saved images yet. Upload one above.</p>}
      <div className="image-insertion-grid">{assets.map(image => <button type="button" key={image.id} disabled={busy} aria-label={`Insert ${image.name}`} onClick={() => { void insert(image) }}><img src={image.url} alt={image.alt || image.name} /><strong>{image.name}</strong>{image.caption && <small>{image.caption}</small>}<span>Insert →</span></button>)}</div>
      {busy && <p role="status">Inserting…</p>}
    </> : <form onSubmit={event => {
      event.preventDefault(); if (!file) return
      setBusy(true); setError(''); setProgress(0)
      const controller = new AbortController(); cancel.current = controller
      void uploadStoryImage(storyId, uploadId.current, file, { name: name.trim(), alt, caption, attachments: [] }, setProgress, controller.signal).then(async image => {
        await qc.invalidateQueries({ queryKey: ['images', storyId] })
        setUploading(false); setFile(null); setPreview(''); cancel.current = null
        await insert(image)
      }).catch(error => { setError(errorText(error)); setBusy(false) }).finally(() => { cancel.current = null })
    }}>
      <p className="writer-help">Still JPEG, PNG or WebP · up to 5 MB and 20 megapixels.</p>
      <label>Image file<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {
        const next = event.target.files?.[0]; if (!next) return
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 5 * 1024 * 1024) { setError('Choose a JPEG, PNG or WebP up to 5 MB.'); return }
        setError(''); uploadId.current = crypto.randomUUID(); setFile(next); setName(next.name.slice(0, 200)); setPreview(URL.createObjectURL(next))
      }} /></label>
      {preview && <img className="image-upload-preview" src={preview} alt="Upload preview" />}
      <label>Name<input required maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label>Description (alt text)<input maxLength={500} value={alt} disabled={busy} onChange={event => setAlt(event.target.value)} /></label>
      <label>Caption<textarea maxLength={1000} value={caption} disabled={busy} onChange={event => setCaption(event.target.value)} /></label>
      <div className="story-images-actions"><button type="submit" disabled={busy || !file || !name.trim()}>Upload & insert</button><button type="button" disabled={busy} onClick={() => setUploading(false)}>Saved images</button>{busy && <button type="button" onClick={() => cancel.current?.abort()}>Cancel upload</button>}</div>
      {busy && <p role="status">{progress < 100 ? `Uploading… ${progress}%` : 'Validating and saving…'}</p>}
    </form>}
  </div>
}
