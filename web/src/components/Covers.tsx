import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryImage } from '../api/client'
import { errorText } from '../api/errors'
import { StoryImagePicker } from './StoryImages'
import { getUiLanguage, t } from '../i18n'

type Role = 'cover' | 'jacket'

/** The story's front cover and jacket, from its image library. */
export function useCovers(storyId: string, enabled = true) {
  const library = useQuery({ queryKey: ['images', storyId], queryFn: () => api.imageLibrary(storyId), enabled })
  const images = library.data?.images ?? []
  return { cover: images.find(image => image.role === 'cover'), jacket: images.find(image => image.role === 'jacket'), library }
}

export const coverPosition = (x = 0.5, y = 0.5): CSSProperties => ({ objectPosition: `${Math.round(x * 100)}% ${Math.round(y * 100)}%` })

/** A cover image cropped to its box at the author's focus point, or the generated tile. */
export function CoverArt({ url, focusX, focusY, title, tint, className = '', children }: { url?: string | null; focusX?: number; focusY?: number; title: string; tint: string; className?: string; children?: ReactNode }) {
  return <span className={`cover-art ${url ? 'has-image' : tint} ${className}`}>
    {url ? <img src={url} alt="" loading="lazy" decoding="async" style={coverPosition(focusX, focusY)} draggable={false} /> : <span className="cover-art-title">{title}</span>}
    {children}
  </span>
}

function useSetCover(storyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { role: Role; image_id: string | null; focus_x?: number; focus_y?: number; show_public?: boolean }) =>
      api.setCover(storyId, { focus_x: 0.5, focus_y: 0.5, show_public: false, ...body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['images', storyId] })
      void qc.invalidateQueries({ queryKey: ['library-overview'] })
      void qc.invalidateQueries({ queryKey: ['shared-stories'] })
    },
  })
}

/** Front cover and jacket: choose or upload, frame by clicking the focus point, alt text, visibility. */
export function CoverManager({ storyId, title, blurb, wordCount }: { storyId: string; title: string; blurb?: string | null; wordCount: number }) {
  const qc = useQueryClient()
  const { cover, jacket } = useCovers(storyId)
  const setCover = useSetCover(storyId)
  const [picking, setPicking] = useState<Role | null>(null)
  const [preview, setPreview] = useState(false)
  const [alt, setAlt] = useState<string | null>(null)
  const describe = useMutation({
    mutationFn: (image: StoryImage) => api.describeImage(storyId, image.id, { name: image.name, alt: alt ?? image.alt, caption: image.caption, attachments: image.attachments ?? [] }),
    onSuccess: () => { setAlt(null); void qc.invalidateQueries({ queryKey: ['images', storyId] }) },
  })
  const frame = (image: StoryImage, role: Role) => (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
    setCover.mutate({ role, image_id: image.id, focus_x: x, focus_y: y, show_public: image.show_public })
  }
  return <div className="cover-manager">
    <div className="cover-slot">
      <button type="button" className="cover-frame is-portrait" disabled={!cover || setCover.isPending} onClick={cover ? frame(cover, 'cover') : undefined} title={cover ? t('Click where the cover should stay in view when cropped') : undefined}>
        {cover ? <><img src={cover.url} alt={cover.alt} style={coverPosition(cover.focus_x, cover.focus_y)} /><i className="cover-focus" style={{ left: `${cover.focus_x * 100}%`, top: `${cover.focus_y * 100}%` }} aria-hidden="true" /></> : <span>{t('No cover yet')}</span>}
      </button>
      <div className="cover-controls">
        <h4>{t('Front cover')}</h4>
        <div className="cover-actions">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setPicking('cover')}>{cover ? t('Change cover') : t('Choose or upload')}</button>
          {cover && <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setCover.mutate({ role: 'cover', image_id: null })}>{t('Remove')}</button>}
        </div>
        {cover && <>
          <label className="cover-field">{t('Alt text')}<span className="cover-alt"><input value={alt ?? cover.alt} maxLength={500} placeholder={t('Describe the cover for screen readers and e-books')} onChange={event => setAlt(event.target.value)} />{alt !== null && alt !== cover.alt && <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={describe.isPending} onClick={() => describe.mutate(cover)}>{t('Save')}</button>}</span></label>
          <label className="cover-check"><input type="checkbox" checked={cover.show_public} onChange={event => setCover.mutate({ role: 'cover', image_id: cover.id, focus_x: cover.focus_x, focus_y: cover.focus_y, show_public: event.target.checked })} />{t('Show on the public showcase')}</label>
          <p className="writer-help">{t('Shared and beta readers see the cover. Click the image to choose what stays in view when it is cropped.')}</p>
        </>}
      </div>
    </div>
    <div className="cover-slot">
      <button type="button" className="cover-frame is-wide" disabled={!jacket} onClick={() => setPreview(true)} title={jacket ? t('Preview jacket') : undefined}>
        {jacket ? <img src={jacket.url} alt={jacket.alt} /> : <span>{t('No jacket')}</span>}
      </button>
      <div className="cover-controls">
        <h4>{t('Jacket (optional)')}</h4>
        <p className="writer-help">{t('The full wrap a printer wants: back, spine and front in one image.')}</p>
        <div className="cover-actions">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setPicking('jacket')}>{jacket ? t('Change jacket') : t('Choose or upload')}</button>
          {jacket && <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setCover.mutate({ role: 'jacket', image_id: null })}>{t('Remove')}</button>}
          {(jacket || cover) && <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setPreview(true)}>{t('Preview jacket')}</button>}
        </div>
        {jacket && <label className="cover-check"><input type="checkbox" checked={jacket.show_public} onChange={event => setCover.mutate({ role: 'jacket', image_id: jacket.id, show_public: event.target.checked })} />{t('Show the jacket to readers and on the showcase')}</label>}
      </div>
    </div>
    {setCover.isError && <p role="alert" className="writer-error">{errorText(setCover.error)}</p>}
    {picking && <StoryImagePicker storyId={storyId} onClose={() => setPicking(null)} onSelect={image => { setCover.mutate({ role: picking, image_id: image.id }); setPicking(null) }} />}
    {preview && <JacketPreview title={title} blurb={blurb} wordCount={wordCount} jacket={jacket} cover={cover} onClose={() => setPreview(false)} />}
  </div>
}

export function CoverDialog({ storyId, title, blurb, wordCount, onClose }: { storyId: string; title: string; blurb?: string | null; wordCount: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="goal-dialog cover-dialog" aria-labelledby="cover-dialog-title" onClose={onClose} onCancel={onClose}>
    <div className="goal-dialog-head"><h2 id="cover-dialog-title">{t('Cover · {0}', title)}</h2><button type="button" aria-label={t('Close')} onClick={() => dialog.current?.close()}>×</button></div>
    <CoverManager storyId={storyId} title={title} blurb={blurb} wordCount={wordCount} />
  </dialog>
}

// Trim sizes in inches with typical words per page; paper thickness in inches per page.
const TRIMS: Record<string, [number, number, number]> = { '5 × 8': [5, 8, 250], '5.5 × 8.5': [5.5, 8.5, 280], '6 × 9': [6, 9, 330] }
const PAPERS: Record<string, number> = { cream: 0.0025, white: 0.002252 }
const BLEED = 0.125
const SAFE = 0.25

/** A check-only jacket view: spine width from the word count, bleed and safe-area guides, blurb overlay. */
export function JacketPreview({ title, blurb, wordCount, jacket, cover, onClose }: { title: string; blurb?: string | null; wordCount: number; jacket?: StoryImage; cover?: StoryImage; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const [trim, setTrim] = useState('6 × 9')
  const [paper, setPaper] = useState<keyof typeof PAPERS>('cream')
  const [guides, setGuides] = useState(true)
  const [overlay, setOverlay] = useState(false)
  const [width, height, perPage] = TRIMS[trim]
  const pages = Math.max(24, Math.ceil(wordCount / perPage))
  const spine = pages * PAPERS[paper]
  const total = BLEED * 2 + width * 2 + spine
  const tall = BLEED * 2 + height
  const pct = (inches: number) => `${(inches / total) * 100}%`
  const n = (value: number, digits = 2) => value.toLocaleString(getUiLanguage(), { maximumFractionDigits: digits, minimumFractionDigits: digits })
  return <dialog ref={dialog} className="goal-dialog jacket-dialog" aria-labelledby="jacket-title" onClose={onClose} onCancel={onClose}>
    <div className="goal-dialog-head"><h2 id="jacket-title">{t('Jacket preview')}</h2><button type="button" aria-label={t('Close')} onClick={() => dialog.current?.close()}>×</button></div>
    <div className="jacket-stage" style={{ aspectRatio: `${total} / ${tall}` }}>
      {jacket ? <img src={jacket.url} alt={jacket.alt} className="jacket-image" /> : <>
        <span className="jacket-panel is-back" style={{ left: 0, width: pct(BLEED + width) }} />
        <span className="jacket-panel is-spine" style={{ left: pct(BLEED + width), width: pct(spine) }}><span>{title}</span></span>
        {cover ? <img src={cover.url} alt={cover.alt} className="jacket-front" style={{ left: pct(BLEED + width + spine), width: pct(width + BLEED), ...coverPosition(cover.focus_x, cover.focus_y) }} /> : <span className="jacket-panel is-front" style={{ left: pct(BLEED + width + spine), width: pct(width + BLEED) }}><span>{title}</span></span>}
      </>}
      {overlay && blurb && <p className="jacket-blurb" style={{ left: pct(BLEED + SAFE), width: pct(width - SAFE * 2), top: `${((BLEED + SAFE * 2) / tall) * 100}%` }}>{blurb}</p>}
      {guides && <span aria-hidden="true">
        <i className="jacket-guide is-bleed" style={{ left: pct(BLEED), right: pct(BLEED), top: `${(BLEED / tall) * 100}%`, bottom: `${(BLEED / tall) * 100}%` }} />
        <i className="jacket-guide is-spine" style={{ left: pct(BLEED + width) }} />
        <i className="jacket-guide is-spine" style={{ left: pct(BLEED + width + spine) }} />
        <i className="jacket-guide is-safe" style={{ left: pct(BLEED + SAFE), width: pct(width - SAFE * 2), top: `${((BLEED + SAFE) / tall) * 100}%`, bottom: `${((BLEED + SAFE) / tall) * 100}%` }} />
        <i className="jacket-guide is-safe" style={{ left: pct(BLEED + width + spine + SAFE), width: pct(width - SAFE * 2), top: `${((BLEED + SAFE) / tall) * 100}%`, bottom: `${((BLEED + SAFE) / tall) * 100}%` }} />
      </span>}
    </div>
    <div className="jacket-labels" aria-hidden="true"><span>{t('Back')}</span><span>{t('Spine')}</span><span>{t('Front')}</span></div>
    <div className="jacket-settings">
      <label>{t('Trim size')}<select value={trim} onChange={event => setTrim(event.target.value)}>{Object.keys(TRIMS).map(key => <option key={key} value={key}>{key} in</option>)}</select></label>
      <label>{t('Paper')}<select value={paper} onChange={event => setPaper(event.target.value as keyof typeof PAPERS)}><option value="cream">{t('Cream')}</option><option value="white">{t('White')}</option></select></label>
      <label className="cover-check"><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} />{t('Show guides')}</label>
      <label className="cover-check"><input type="checkbox" checked={overlay} disabled={!blurb} onChange={event => setOverlay(event.target.checked)} />{t('Lay the blurb over the back')}</label>
    </div>
    <p className="writer-help">{t('About {0} pages · spine {1} in · full wrap {2} × {3} in with {4} in bleed. An estimate from your word count: check your printer’s cover calculator before ordering.', pages.toLocaleString(getUiLanguage()), n(spine, 3), n(total), n(tall), n(BLEED, 3))}</p>
  </dialog>
}
