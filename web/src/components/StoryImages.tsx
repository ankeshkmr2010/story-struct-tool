import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, uploadStoryImage, type ImageAttachment, type ImageDescription, type ImageLibrary, type StoryImage } from '../api/client'
import { errorText } from '../api/errors'
import { SANDBOX_ID } from '../sandbox/storage'
import { flushWriter } from './writerDraft'
import { plural, t } from '../i18n'

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

export function ImagePreview({ url, alt, caption, onClose }: { url: string; alt: string; caption: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [failed, setFailed] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="story-image-preview" aria-labelledby={titleId} onClose={event => { event.stopPropagation(); onClose() }} onCancel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) dialog.current?.close() }}>
    <header className="story-images-head"><h2 id={titleId}>{t('Image preview')}</h2><button type="button" className="share-story-button" autoFocus onClick={() => dialog.current?.close()}>{t('Close')}</button></header>
    {failed ? <p role="alert">{t('Image unavailable.')}{' '}<button type="button" onClick={() => setFailed(false)}>{t('Retry')}</button></p> : <img src={url} alt={alt} onError={() => setFailed(true)} />}
    {caption && <p className="story-image-preview-caption">{caption}</p>}
    <a href={url} target="_blank" rel="noreferrer">{t('Open original image')}</a>
  </dialog>
}

export function ImageFigure({ image, fallback = '' }: { image?: { url?: unknown; alt?: unknown; caption?: unknown; name?: unknown }; fallback?: string }) {
  const [failedUrl, setFailedUrl] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  if (!image?.url) return <span className="writer-help">{t('[Image: {0}]', fallback || t('unavailable'))}</span>
  const url = String(image.url)
  return <><figure className="story-image-figure">
    {failedUrl === url ? <p role="alert">{t('Image unavailable.')}{' '}<button type="button" onClick={() => setFailedUrl('')}>{t('Retry')}</button></p> : <button type="button" className="story-image-open-preview" aria-label={t('Preview {0}', String(image.alt || image.name || fallback || 'image'))} onClick={() => setPreviewOpen(true)}><img src={url} alt={String(image.alt || fallback || '')} loading="lazy" onError={() => setFailedUrl(url)} /></button>}
    {image.caption ? <figcaption>{String(image.caption)}</figcaption> : null}
  </figure>{previewOpen && <ImagePreview url={url} alt={String(image.alt || fallback || '')} caption={String(image.caption || '')} onClose={() => setPreviewOpen(false)} />}</>
}

export function StoryImagesButton({ storyId, beforeOpen }: { storyId: string; beforeOpen: () => Promise<boolean> }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <>
    <button type="button" className="share-story-button" disabled={pending} onClick={async () => {
      setPending(true); setError(null)
      try {
        if (!await beforeOpen()) throw new Error(t('Save your writing before managing images.'))
        navigate(`/stories/${storyId}/images`)
      } catch (error) { setError(errorText(error)) } finally { setPending(false) }
    }}>{pending ? t('Saving…') : t('Images')}</button>
    {error && <p role="alert" className="writer-error">{error}</p>}
  </>
}

export function StoryImagePicker({ storyId, target, onSelect, onClose, page = false }: {
  storyId: string; target?: ImageAttachment; onSelect?: (image: StoryImage) => void | Promise<void>; onClose: () => void; page?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const altHelpId = useId()
  const [params, setParams] = useSearchParams()
  const sceneFilter = page ? params.get("scene") : null
  const filter = page ? params.get("filter") || "all" : "all"
  const editor = useRef<HTMLFormElement>(null)
  const showEditor = () => { if (page) requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
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
  useEffect(() => { if (!page) dialog.current?.showModal(); return () => { upload.current?.abort() } }, [page])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const refresh = async () => { await Promise.all(['images', 'content', 'scenes', 'reading-document', 'story-versions', 'revisions', 'authorship', 'progress'].map(key => qc.invalidateQueries({ queryKey: [key, storyId] }))) }
  const chooseFile = (next: File | undefined) => {
    if (!next) return
    setError(null); setNotice('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setError(t('Use a JPEG, PNG or WebP image.')); return }
    uploadId.current = crypto.randomUUID()
    setFile(next); setPreview(URL.createObjectURL(next)); setSelected(null); setDescription({ name: next.name.slice(0, 200), alt: '', caption: '', attachments: [] }); showEditor()
  }
  const save = async (use: boolean) => {
    if (!description.name.trim()) { setError(t('Give this image a name.')); return }
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
      else setNotice(t('Saved “{0}”.', image.name))
    } catch (error) { setError(errorText(error)); await refresh() }
    finally { setBusy(false); upload.current = null }
  }
  const active = library.data?.images.filter(image => !image.archived && (!sceneFilter || image.uses?.some(use => use.entity === 'scene' && use.id === sceneFilter))) ?? []
  const matches = (image: StoryImage, value: string) => value === 'manuscript' ? image.manuscript_uses > 0 : value === 'reference' ? image.attachments.length > 0 : value === 'unused' ? !image.manuscript_uses && !image.attachments.length && !image.role : value === 'cover' ? Boolean(image.role) : true
  const visible = active.filter(image => matches(image, filter))
  const content = <>
    <header className="story-images-head"><h2 id="story-images-title">{t('Story images')}</h2>{!page && <button type="button" aria-label={t('Close images')} onClick={onClose}>×</button>}</header>
    <p className="writer-help">{t('JPEG, PNG or WebP · large photos resized locally to WebP, up to 2,400 px · 5 MB per saved image · 50 images and 100 MB per story.')}</p>
    {library.data && <p className="writer-help">{t('{0} / {1} images · {2} / {3} MB. Images kept for History still count.', library.data.retained_count, library.data.max_images, megabytes(library.data.retained_bytes), megabytes(library.data.max_story_bytes))}</p>}
    {!onSelect && <p className="writer-help">{t('Select an image to edit its description or caption, or delete its current uses.')}</p>}
    {error && <p role="alert" className="writer-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {library.isPending && <p role="status">{t('Loading images…')}</p>}
    {library.isError && <p role="alert">{errorText(library.error)} <button type="button" onClick={() => { void library.refetch() }}>{t('Retry')}</button></p>}
    {sceneFilter && <p className="writer-help">{t('Showing images used in this scene.')}{' '}<Link to={`/stories/${storyId}/images`}>{t('Show every image →')}</Link></p>}
    {page && <nav aria-label={t('Filter images')} className="story-images-actions">{[['all', t('All images')], ['manuscript', t('Manuscript')], ['reference', t('Reference')], ['unused', t('Unused')], ['cover', t('Cover')]].map(([value, label]) => <button type="button" className="share-story-button" key={value} aria-pressed={filter === value} onClick={() => { const next = new URLSearchParams(params); if (value === 'all') next.delete('filter'); else next.set('filter', value); setParams(next) }}>{label} ({active.filter(image => matches(image, value)).length})</button>)}</nav>}
    <div className="story-images-grid">{visible.map(image => <button type="button" key={image.id} disabled={busy} aria-pressed={selected?.id === image.id} onClick={() => { setSelected(image); setFile(null); setPreview(''); setDescription(image); setError(null); setNotice(''); showEditor() }}><img src={image.url} alt={image.alt || image.name} loading="lazy" /><span>{image.name}</span>{page && <><small>{image.caption || t('No caption')}</small><small>{[plural(image.manuscript_uses, '{0} placement', '{0} placements', image.manuscript_uses), plural(image.attachments.length, '{0} reference', '{0} references', image.attachments.length)].join(' · ')}</small><span>{t('Edit details & uses →')}</span></>}</button>)}</div>
    {library.data && !active.length && <p className="writer-help">{sceneFilter ? t('No images used in this scene yet. Insert one in Write or attach a reference in Scene Design.') : t('No images yet. Upload an illustration, map or reference image.')}</p>}
    {page && library.data && active.length > 0 && visible.length === 0 && <p role="status">{t('No images in this filter. Choose All images to see your library.')}</p>}
    <label className="story-image-upload">{t('Upload an image')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !library.data || library.data.retained_count >= library.data.max_images || library.data.retained_bytes >= library.data.max_story_bytes} onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = '' }} /></label>
    {(selected || file) && <form ref={editor} onSubmit={event => { event.preventDefault(); void save(false) }}>
      {page && <h3 className="text-lg font-semibold">{file ? t('Upload image') : selected?.name}</h3>}
      <ImageFigure image={{ url: preview || selected?.url, alt: description.alt, caption: description.caption }} />
      {selected && <p className="writer-help">{t('{0} manuscript placements · {1} reference attachments', selected.manuscript_uses ?? 0, selected.attachments.length)}</p>}
      {page && selected && <section aria-label={t('Where this image is used')}><h3>{t('Where this image is used')}</h3>{selected.uses?.length ? <ul>{selected.uses.map((use, index) => <li key={index}><Link to={`/stories/${storyId}?${new URLSearchParams({ search_entity: use.entity, search_id: use.id, search_field: use.kind === 'manuscript' ? 'content' : 'title', ...(use.kind === 'manuscript' ? { image_ref: selected.id } : {}) })}`}>{use.chapter ? `${use.chapter} → ` : ''}{use.title}</Link> · {use.kind === 'manuscript' ? t('{0} manuscript placement{1}', use.count, use.count === 1 ? '' : t('s')) : t('{0} reference', use.entity === 'glossary_entry' ? t('glossary') : use.entity)}</li>)}</ul> : <p className="writer-help">{t('Unused in the current story. Insert it from Write or attach it in a planning entry.')}</p>}</section>}
      <label>{t('Name')}<input value={description.name} maxLength={200} required disabled={busy} onChange={event => setDescription({ ...description, name: event.target.value })} /></label>
      <label>{t('Image description (alt text)')}<input aria-describedby={!description.alt.trim() ? altHelpId : undefined} placeholder={t('Describe what the image shows')} value={description.alt} maxLength={500} disabled={busy} onChange={event => setDescription({ ...description, alt: event.target.value })} /></label>
      {!description.alt.trim() && <p id={altHelpId} className="writer-help">{t('A short description helps screen-reader users and makes your EPUB more accessible. Optional, but recommended.')}</p>}
      <label>{t('Caption')}<textarea value={description.caption} maxLength={1000} disabled={busy} onChange={event => setDescription({ ...description, caption: event.target.value })} /></label>
      {busy && <p role="status">{file ? progress < 100 ? progress === 0 ? t('Preparing image for upload…') : t('Uploading… {0}%', progress) : t('Validating and saving…') : t('Saving…')} {file && <button type="button" onClick={() => upload.current?.abort()}>{t('Cancel upload')}</button>}</p>}
      <div className="story-images-actions"><button type="submit" className="share-story-button" disabled={busy}>{file ? t('Upload') : t('Save details')}</button>{onSelect && <button type="button" className="share-story-button" disabled={busy} onClick={() => { void save(true) }}>{target ? t('Attach image') : t('Insert image')}</button>}
      {page && selected && selected.role !== 'cover' && <button type="button" className="share-story-button" disabled={busy} onClick={async () => {
        setBusy(true); setError(null)
        try { const updated = await api.setCover(storyId, { role: 'cover', image_id: selected.id, focus_x: 0.5, focus_y: 0.5, show_public: false }); if (updated) setSelected(updated); setNotice(t('Set as the story’s cover.')); void qc.invalidateQueries({ queryKey: ['images', storyId] }); void qc.invalidateQueries({ queryKey: ['library-overview'] }) }
        catch (failure) { setError(errorText(failure)) } finally { setBusy(false) }
      }}>{t('Set as cover')}</button>}
      {selected && <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError(null)
        try {
          const me = await api.currentUser()
          if (!await flushWriter(`storytool-writer:${me.id}:${storyId}:`)) throw new Error(t('Save your writing before deleting this image.'))
          const current = (await api.imageLibrary(storyId)).images.find(image => image.id === selected.id)
          if (!current || current.archived) { setSelected(null); await refresh(); setNotice(t('This image has already been deleted.')); return }
          if (!window.confirm(t('Delete “{0}” from this story? This removes {1} manuscript placements and {2} reference attachments. Saved history and existing beta rounds keep the image.', current.name, current.manuscript_uses ?? 0, current.attachments.length))) return
          await api.removeImage(storyId, current.id)
          setSelected(null); setFile(null); setPreview(''); setNotice(t('Deleted “{0}” from the current story.', current.name)); await refresh()
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }}>{t('Delete image')}</button>}</div>
    </form>}
  </>
  return page ? <section className="story-images-page" aria-labelledby="story-images-title">{content}</section> : <dialog ref={dialog} className="story-images-dialog" aria-labelledby="story-images-title" onCancel={onClose} onClose={onClose}>{content}</dialog>
}

export function ReferenceImages({ storyId, entity, entityId, hideGallery = false }: { storyId: string; entity: ImageAttachment['entity']; entityId: string; hideGallery?: boolean }) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const library = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId), enabled: storyId !== SANDBOX_ID })
  if (storyId === SANDBOX_ID) return null
  const images = library.data?.images.filter(image => !image.archived && image.attachments.some(a => a.entity === entity && a.id === entityId)) ?? []
  return <div className="reference-images">
    <div className="reference-images-list">{!hideGallery && images.map(image => <div key={image.id}><ImageFigure image={image} /><button type="button" onClick={async () => {
      try { await api.describeImage(storyId, image.id, { ...image, attachments: image.attachments.filter(a => a.entity !== entity || a.id !== entityId) }); await qc.invalidateQueries({ queryKey: ['images', storyId] }) } catch (error) { window.alert(errorText(error)) }
    }}>{t('Detach image')}</button></div>)}</div>
    {hideGallery && images.map(image => <button key={image.id} type="button" className="writer-extra-add" onClick={async () => { try { await api.describeImage(storyId, image.id, { ...image, attachments: image.attachments.filter(a => a.entity !== entity || a.id !== entityId) }); await qc.invalidateQueries({ queryKey: ['images', storyId] }) } catch (error) { window.alert(errorText(error)) } }}>{t('Detach {0}', image.name)}</button>)}
    <button type="button" className="writer-extra-add" onClick={() => setOpen(true)}>{t('+ Add reference image')}</button>
    {open && <StoryImagePicker storyId={storyId} target={{ entity, id: entityId }} onSelect={() => {}} onClose={() => setOpen(false)} />}
  </div>
}

export function ReadOnlyReferenceImages({ images, entity, entityId }: { images: Record<string, unknown>[]; entity: ImageAttachment['entity']; entityId: string }) {
  return <div className="reference-images-list">{images.filter(image => (image.attachments as ImageAttachment[] | undefined)?.some(a => a.entity === entity && a.id === entityId)).map(image => <ImageFigure key={String(image.id)} image={image} />)}</div>
}

export function SceneImages({ storyId, sceneId }: { storyId: string; sceneId: string }) {
  const library = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId), enabled: storyId !== SANDBOX_ID })
  if (storyId === SANDBOX_ID) return null
  const images = library.data?.images.filter(image => !image.archived && image.uses.some(use => use.entity === 'scene' && use.id === sceneId)) ?? []
  return <section className="scene-images" aria-label={t('Scene images')}>
    <Link to={`/stories/${storyId}/images?scene=${sceneId}`} className="underline underline-offset-4">{t('Images for this scene{0} →', library.data ? ` (${images.length})` : '')}</Link>
    {library.isError && <p role="alert">{t('Could not load images.')}{' '}<button type="button" onClick={() => { void library.refetch() }}>{t('Retry')}</button></p>}
    <div className="scene-image-thumbnails">{images.map(image => <div key={image.id}><ImageFigure image={image} /><p>{image.name}</p><small>{image.uses.filter(use => use.entity === 'scene' && use.id === sceneId).map(use => use.kind === 'manuscript' ? t('Manuscript') : t('Reference')).join(' · ')}</small></div>)}</div>
  </section>
}
