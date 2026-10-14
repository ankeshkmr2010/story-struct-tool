import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, uploadStoryImage, type ImageAttachment, type ImageDescription, type ImageLibrary, type StoryImage } from '../api/client'
import { errorText } from '../api/errors'
import { SANDBOX_ID } from '../sandbox/storage'
import { flushWriter } from './writerDraft'

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

function ImagePreview({ url, alt, caption, onClose }: { url: string; alt: string; caption: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [failed, setFailed] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="story-image-preview" aria-labelledby={titleId} onClose={event => { event.stopPropagation(); onClose() }} onCancel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) dialog.current?.close() }}>
    <header className="story-images-head"><h2 id={titleId}>Image preview</h2><button type="button" className="share-story-button" autoFocus onClick={() => dialog.current?.close()}>Close</button></header>
    {failed ? <p role="alert">Image unavailable. <button type="button" onClick={() => setFailed(false)}>Retry</button></p> : <img src={url} alt={alt} onError={() => setFailed(true)} />}
    {caption && <p className="story-image-preview-caption">{caption}</p>}
    <a href={url} target="_blank" rel="noreferrer">Open original image</a>
  </dialog>
}

export function ImageFigure({ image, fallback = '' }: { image?: { url?: unknown; alt?: unknown; caption?: unknown; name?: unknown }; fallback?: string }) {
  const [failedUrl, setFailedUrl] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  if (!image?.url) return <span className="writer-help">[Image: {fallback || 'unavailable'}]</span>
  const url = String(image.url)
  return <><figure className="story-image-figure">
    {failedUrl === url ? <p role="alert">Image unavailable. <button type="button" onClick={() => setFailedUrl('')}>Retry</button></p> : <button type="button" className="story-image-open-preview" aria-label={`Preview ${String(image.alt || image.name || fallback || 'image')}`} onClick={() => setPreviewOpen(true)}><img src={url} alt={String(image.alt || fallback || '')} loading="lazy" onError={() => setFailedUrl(url)} /></button>}
    {image.caption ? <figcaption>{String(image.caption)}</figcaption> : null}
  </figure>{previewOpen && <ImagePreview url={url} alt={String(image.alt || fallback || '')} caption={String(image.caption || '')} onClose={() => setPreviewOpen(false)} />}</>
}

export function StoryImagesButton({ storyId, beforeOpen }: { storyId: string; beforeOpen: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <>
    <button type="button" className="share-story-button" disabled={pending} onClick={async () => {
      setPending(true); setError(null)
      try {
        if (!await beforeOpen()) throw new Error('Save your writing before managing images.')
        setOpen(true)
      } catch (error) { setError(errorText(error)) } finally { setPending(false) }
    }}>{pending ? 'Saving…' : 'Images'}</button>
    {error && <p role="alert" className="writer-error">{error}</p>}
    {open && <StoryImagePicker storyId={storyId} onClose={() => setOpen(false)} />}
  </>
}

export function StoryImagePicker({ storyId, target, onSelect, onClose }: {
  storyId: string; target?: ImageAttachment; onSelect?: (image: StoryImage) => void | Promise<void>; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const qc = useQueryClient()
  const library = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId) })
  const [selected, setSelected] = useState<StoryImage | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [description, setDescription] = useState<ImageDescription>({ name: '', alt: '', caption: '', attachments: [] })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const upload = useRef<AbortController | null>(null)
  const uploadId = useRef('')
  useEffect(() => { dialog.current?.showModal(); return () => { upload.current?.abort() } }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const refresh = async () => { await Promise.all(['images', 'content', 'scenes', 'reading-document', 'story-versions', 'revisions', 'authorship', 'progress'].map(key => qc.invalidateQueries({ queryKey: [key, storyId] }))) }
  const chooseFile = (next: File | undefined) => {
    if (!next) return
    setError(null); setNotice('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setError('Use a JPEG, PNG or WebP image.'); return }
    if (next.size > (library.data?.max_image_bytes ?? 5 * 1024 * 1024)) { setError('Each image must be 5 MB or smaller.'); return }
    uploadId.current = crypto.randomUUID()
    setFile(next); setPreview(URL.createObjectURL(next)); setSelected(null); setDescription({ name: next.name.slice(0, 200), alt: '', caption: '', attachments: [] })
  }
  const save = async (use: boolean) => {
    if (!description.name.trim()) { setError('Give this image a name.'); return }
    setBusy(true); setError(null); setNotice(''); setProgress(0)
    try {
      let attachments = description.attachments
      if (use && target && !attachments.some(a => a.entity === target.entity && a.id === target.id)) attachments = [...attachments, target]
      const details = { ...description, name: description.name.trim(), attachments }
      let image: StoryImage
      if (file) {
        upload.current = new AbortController()
        image = await uploadStoryImage(storyId, uploadId.current, file, details, setProgress, upload.current.signal)
      } else if (selected) image = await api.describeImage(storyId, selected.id, details)
      else return
      setSelected(image); setFile(null); setPreview(''); setDescription(image); await refresh()
      const saved = qc.getQueryData<ImageLibrary>(['images', storyId])?.images.find(saved => saved.id === image.id)
      if (saved) setSelected(saved)
      if (use && onSelect) { await onSelect(image); onClose() }
      else setNotice(`Saved “${image.name}”.`)
    } catch (error) { setError(errorText(error)); await refresh() }
    finally { setBusy(false); upload.current = null }
  }
  return <dialog ref={dialog} className="story-images-dialog" aria-labelledby="story-images-title" onCancel={onClose} onClose={onClose}>
    <header className="story-images-head"><h2 id="story-images-title">Story images</h2><button type="button" aria-label="Close images" onClick={onClose}>×</button></header>
    <p className="writer-help">JPEG, PNG or WebP · 5 MB per image · 50 images and 100 MB per story.</p>
    {library.data && <p className="writer-help">{library.data.retained_count} / {library.data.max_images} images · {megabytes(library.data.retained_bytes)} / {megabytes(library.data.max_story_bytes)} MB. Images kept for History still count.</p>}
    {!onSelect && <p className="writer-help">Select an image to edit its description or caption, or delete its current uses.</p>}
    {error && <p role="alert" className="writer-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {library.isPending && <p role="status">Loading images…</p>}
    {library.isError && <p role="alert">{errorText(library.error)} <button type="button" onClick={() => { void library.refetch() }}>Retry</button></p>}
    <div className="story-images-grid">{library.data?.images.filter(image => !image.archived).map(image => <button type="button" key={image.id} disabled={busy} aria-pressed={selected?.id === image.id} onClick={() => { setSelected(image); setFile(null); setPreview(''); setDescription(image); setError(null); setNotice('') }}><img src={image.url} alt={image.alt || image.name} loading="lazy" /><span>{image.name}</span></button>)}</div>
    {library.data && !library.data.images.some(image => !image.archived) && <p className="writer-help">No images yet. Upload an illustration, map or reference image.</p>}
    <label className="story-image-upload">Upload an image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !library.data || library.data.retained_count >= library.data.max_images || library.data.retained_bytes >= library.data.max_story_bytes} onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = '' }} /></label>
    {(selected || file) && <form onSubmit={event => { event.preventDefault(); void save(false) }}>
      <ImageFigure image={{ url: preview || selected?.url, alt: description.alt, caption: description.caption }} />
      {selected && <p className="writer-help">{selected.manuscript_uses ?? 0} manuscript placements · {selected.attachments.length} reference attachments</p>}
      <label>Name<input value={description.name} maxLength={200} required disabled={busy} onChange={event => setDescription({ ...description, name: event.target.value })} /></label>
      <label>Image description (alt text)<input value={description.alt} maxLength={500} disabled={busy} onChange={event => setDescription({ ...description, alt: event.target.value })} /></label>
      <label>Caption<textarea value={description.caption} maxLength={1000} disabled={busy} onChange={event => setDescription({ ...description, caption: event.target.value })} /></label>
      {busy && <p role="status">{file ? progress < 100 ? `Uploading… ${progress}%` : 'Validating and saving…' : 'Saving…'} {file && <button type="button" onClick={() => upload.current?.abort()}>Cancel upload</button>}</p>}
      <div className="story-images-actions"><button type="submit" className="share-story-button" disabled={busy}>{file ? 'Upload' : 'Save details'}</button>{onSelect && <button type="button" className="share-story-button" disabled={busy} onClick={() => { void save(true) }}>{target ? 'Attach image' : 'Insert image'}</button>}
      {selected && <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError(null)
        try {
          const me = await api.currentUser()
          if (!await flushWriter(`storytool-writer:${me.id}:${storyId}:`)) throw new Error('Save your writing before deleting this image.')
          const current = (await api.imageLibrary(storyId)).images.find(image => image.id === selected.id)
          if (!current || current.archived) { setSelected(null); await refresh(); setNotice('This image has already been deleted.'); return }
          if (!window.confirm(`Delete “${current.name}” from this story? This removes ${current.manuscript_uses ?? 0} manuscript placements and ${current.attachments.length} reference attachments. Saved history and existing beta rounds keep the image.`)) return
          await api.removeImage(storyId, current.id)
          setSelected(null); setFile(null); setPreview(''); setNotice(`Deleted “${current.name}” from the current story.`); await refresh()
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }}>Delete image</button>}</div>
    </form>}
  </dialog>
}

export function ReferenceImages({ storyId, entity, entityId }: { storyId: string; entity: ImageAttachment['entity']; entityId: string }) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const library = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId), enabled: storyId !== SANDBOX_ID })
  if (storyId === SANDBOX_ID) return null
  const images = library.data?.images.filter(image => !image.archived && image.attachments.some(a => a.entity === entity && a.id === entityId)) ?? []
  return <div className="reference-images">
    <div className="reference-images-list">{images.map(image => <div key={image.id}><ImageFigure image={image} /><button type="button" onClick={async () => {
      try { await api.describeImage(storyId, image.id, { ...image, attachments: image.attachments.filter(a => a.entity !== entity || a.id !== entityId) }); await qc.invalidateQueries({ queryKey: ['images', storyId] }) } catch (error) { window.alert(errorText(error)) }
    }}>Detach image</button></div>)}</div>
    <button type="button" className="writer-extra-add" onClick={() => setOpen(true)}>+ Add reference image</button>
    {open && <StoryImagePicker storyId={storyId} target={{ entity, id: entityId }} onSelect={() => {}} onClose={() => setOpen(false)} />}
  </div>
}

export function ReadOnlyReferenceImages({ images, entity, entityId }: { images: Record<string, unknown>[]; entity: ImageAttachment['entity']; entityId: string }) {
  return <div className="reference-images-list">{images.filter(image => (image.attachments as ImageAttachment[] | undefined)?.some(a => a.entity === entity && a.id === entityId)).map(image => <ImageFigure key={String(image.id)} image={image} />)}</div>
}
