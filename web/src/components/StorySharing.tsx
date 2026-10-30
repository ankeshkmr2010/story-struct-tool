import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Menu, MenuItem } from '../ui/Menu'
import { t } from '../i18n'

export function StorySharing({ storyId, title, blurb, beforeOpen, menu = false, extraItems, betaOpen = 0, betaButton = true }: { storyId: string; title: string; blurb?: string | null; beforeOpen?: () => Promise<boolean>; menu?: boolean; extraItems?: ReactNode; betaOpen?: number ; betaButton?: boolean }) {
  const betaLabel = <>{t('Beta readers')}{betaOpen > 0 && <span className="workspace-nav-badge ml-1" title={t('{0} open reader comments', betaOpen)}>{betaOpen}</span>}</>
  const qc = useQueryClient()
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [allowImport, setAllowImport] = useState(false)
  const [message, setMessage] = useState('')
  const [openError, setOpenError] = useState('')
  const shares = useQuery({ queryKey: ['story-shares', storyId], queryFn: () => api.listShares(storyId), enabled: open })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['story-shares', storyId] }) }
  const save = useMutation({ mutationFn: ({ email, allow }: { email: string; allow: boolean }) => api.shareStory(storyId, email, allow), onSuccess: () => { setEmail(''); setMessage(t('Sharing permission saved. Send the reader link to the recipient.')); refresh() } })
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeShare(storyId, id), onSuccess: () => { setMessage(t('Access revoked. Independent copies already imported are preserved.')); refresh() } })
  const pending = save.isPending || revoke.isPending
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/shared/${storyId}`); setMessage(t('Reader link copied. Only the accounts you authorize can open it.')) }
    catch { setMessage(t('Copy this reader link: {0}/shared/{1}', location.origin, storyId)) }
  }
  const openShare = async () => { setOpenError(''); if (beforeOpen && !await beforeOpen()) { setOpenError(t('Save your writing before sharing this story.')); return }; save.reset(); revoke.reset(); setMessage(''); setOpen(true) }
  const openBeta = async () => { setOpenError(''); if (beforeOpen && !await beforeOpen()) { setOpenError(t('Save your writing before opening beta readers.')); return }; navigate(`/stories/${storyId}/beta`) }
  return <>
    {menu ? <><Menu label={t('Share ▾')} ariaLabel={t('Share options for {0}', title)} triggerClassName="ui-btn ui-btn-primary">
      <MenuItem onSelect={() => { void openShare() }}>{t('Share with readers…')}</MenuItem>
      {!betaButton && <MenuItem onSelect={() => { void openBeta() }}>{t('Beta readers…')}</MenuItem>}
      {extraItems}
    </Menu>
    {/* Until a chapter is fully drafted, Beta readers waits in the Share menu (usability phase 2). */}
    {betaButton && <button type="button" className="ui-btn ui-btn-secondary" aria-label={t('Beta readers for {0}{1}', title, betaOpen ? t(', {0} open comments', betaOpen) : '')} onClick={() => { void openBeta() }}>{betaLabel}</button>}
    </> : <>
    <button type="button" className="share-story-button" aria-label={t('Share {0}', title)} onClick={() => { void openShare() }}>{t('Share')}</button>
    <button type="button" className="share-story-button" aria-label={t('Beta readers for {0}{1}', title, betaOpen ? t(', {0} open comments', betaOpen) : '')} onClick={() => { void openBeta() }}>{betaLabel}</button>
    </>}
    {openError && <p role="alert" className="writer-error">{openError}</p>}
    <dialog ref={dialog} className="story-sharing-dialog" aria-labelledby={`share-title-${storyId}`} onClose={() => setOpen(false)}>
      <div className="sharing-heading"><h2 id={`share-title-${storyId}`}>{t('Share story')}</h2><button type="button" className="share-story-button" onClick={() => setOpen(false)}>{t('Close')}</button></div>
      <p className="sharing-story-title">{title}</p>
      {blurb && <p className="shared-reader-blurb">{blurb}</p>}
      <p className="writer-help">{t('Share the current saved manuscript and story structure with a StoryTool account. Recipients can read beats, arcs, characters, and timeline context. Past versions and AI conversations stay private.')}</p>
      <form className="sharing-form" onSubmit={event => { event.preventDefault(); if (email.trim() && !pending) save.mutate({ email, allow: allowImport }) }}>
        <label>{t('Recipient’s sign-in email')}<input type="email" required maxLength={320} autoFocus value={email} onChange={event => setEmail(event.target.value)} placeholder={t('writer@gmail.com')} /></label>
        <label>{t('Permission')}<select aria-label={t('Sharing permission')} value={allowImport ? 'import' : 'read'} onChange={event => setAllowImport(event.target.value === 'import')}><option value="read">{t('Read only')}</option><option value="import">{t('Read and import a copy')}</option></select></label>
        <button type="submit" className="sharing-primary" disabled={pending || !email.trim()}>{save.isPending ? t('Saving…') : t('Grant access')}</button>
      </form>
      <div className="sharing-link"><button type="button" className="share-story-button" onClick={() => { void copyLink() }}>{t('Copy reader link')}</button><p className="writer-help">{t('No email is sent automatically. The story appears under Shared with you when the recipient signs in with this email.')}</p></div>
      {message && <p role="status" className="sharing-message">{message}</p>}
      {(save.isError || revoke.isError || shares.isError) && <p role="alert" className="writer-error">{errorText(save.error ?? revoke.error ?? shares.error)}</p>}
      <h3 className="sharing-subheading">{t('People with access')}</h3>
      {shares.isPending && open && <p className="writer-help">{t('Loading permissions…')}</p>}
      {shares.data?.length === 0 && <p className="writer-help">{t('This story is private. Grant access to share it.')}</p>}
      <ul className="sharing-people">{shares.data?.map(share => <li key={share.id}><span>{share.recipient_email}</span><select aria-label={t('Permission for {0}', share.recipient_email)} disabled={pending} value={share.allow_import ? 'import' : 'read'} onChange={event => save.mutate({ email: share.recipient_email, allow: event.target.value === 'import' })}><option value="read">{t('Read only')}</option><option value="import">{t('Read and import a copy')}</option></select><button type="button" className="share-story-button" disabled={pending} onClick={() => { if (window.confirm(t('Revoke access for {0}? Copies already imported will remain theirs.', share.recipient_email))) revoke.mutate(share.id) }}>{t('Revoke')}</button></li>)}</ul>
      <p className="writer-help">{t('You keep ownership. Imports are independent drafts; later changes and revoked access do not remove copies already imported. Moving this story to Trash hides it from recipients until restored.')}</p>
      {open && <ShowcaseControls storyId={storyId} />}
    </dialog>
  </>
}

function ShowcaseControls({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const [message, setMessage] = useState('')
  const key = ['story-showcase', storyId]
  const showcase = useQuery({ queryKey: key, queryFn: () => api.getShowcase(storyId) })
  const done = (text: string) => (data: Awaited<ReturnType<typeof api.getShowcase>>) => { qc.setQueryData(key, data); setMessage(text) }
  const toggle = useMutation({ mutationFn: (enabled: boolean) => api.setShowcase(storyId, enabled), onSuccess: (data, enabled) => done(enabled ? t('Public showcase is on. Anyone with the link can view it.') : t('Public showcase is off. The link no longer works.'))(data) })
  const rotate = useMutation({ mutationFn: () => api.rotateShowcase(storyId), onSuccess: done(t('New link created. The old link no longer works.')) })
  const link = showcase.data?.token ? `${location.origin}/showcase/${showcase.data.token}` : ''
  const busy = toggle.isPending || rotate.isPending
  const copy = async () => { try { await navigator.clipboard.writeText(link); setMessage(t('Showcase link copied.')) } catch { setMessage(t('Copy this link: {0}', link)) } }
  return <section aria-labelledby={`showcase-${storyId}`}>
    <h3 id={`showcase-${storyId}`} className="sharing-subheading">{t('Public showcase')}</h3>
    <p className="writer-help">{t('A read-only page anyone can open without signing in: manuscript, story context, timeline, design, and version history. Private notes, annotations, and AI conversations stay private. Search engines are asked not to index it.')}</p>
    <label className="showcase-toggle"><input type="checkbox" disabled={busy || showcase.isPending} checked={showcase.data?.enabled ?? false} onChange={event => toggle.mutate(event.target.checked)} />{' '}{t('Anyone with the link can view')}</label>
    {link && <div className="showcase-link"><input readOnly aria-label={t('Showcase link')} value={link} onFocus={event => event.target.select()} /><button type="button" className="share-story-button" onClick={() => { void copy() }}>{t('Copy link')}</button><a className="share-story-button" href={link} target="_blank" rel="noreferrer">{t('Open')}</a><button type="button" className="share-story-button" disabled={busy} onClick={() => { if (window.confirm(t('Replace the showcase link? Anyone using the old link will lose access.'))) rotate.mutate() }}>{t('New link')}</button></div>}
    {message && <p role="status" className="sharing-message">{message}</p>}
    {(showcase.isError || toggle.isError || rotate.isError) && <p role="alert" className="writer-error">{errorText(showcase.error ?? toggle.error ?? rotate.error)}</p>}
  </section>
}
