import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'

export function StorySharing({ storyId, title, beforeOpen }: { storyId: string; title: string; beforeOpen?: () => Promise<boolean> }) {
  const qc = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [allowImport, setAllowImport] = useState(false)
  const [message, setMessage] = useState('')
  const [openError, setOpenError] = useState('')
  const shares = useQuery({ queryKey: ['story-shares', storyId], queryFn: () => api.listShares(storyId), enabled: open })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['story-shares', storyId] }) }
  const save = useMutation({ mutationFn: ({ email, allow }: { email: string; allow: boolean }) => api.shareStory(storyId, email, allow), onSuccess: () => { setEmail(''); setMessage('Sharing permission saved. Send the reader link to the recipient.'); refresh() } })
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeShare(storyId, id), onSuccess: () => { setMessage('Access revoked. Independent copies already imported are preserved.'); refresh() } })
  const pending = save.isPending || revoke.isPending
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/shared/${storyId}`); setMessage('Reader link copied. Only the accounts you authorize can open it.') }
    catch { setMessage(`Copy this reader link: ${location.origin}/shared/${storyId}`) }
  }
  return <>
    <button type="button" className="share-story-button" aria-label={`Share ${title}`} onClick={async () => { setOpenError(''); if (beforeOpen && !await beforeOpen()) { setOpenError('Save your writing before sharing this story.'); return }; save.reset(); revoke.reset(); setMessage(''); setOpen(true) }}>Share</button>
    {openError && <p role="alert" className="writer-error">{openError}</p>}
    <dialog ref={dialog} className="story-sharing-dialog" aria-labelledby={`share-title-${storyId}`} onClose={() => setOpen(false)}>
      <div className="sharing-heading"><h2 id={`share-title-${storyId}`}>Share story</h2><button type="button" className="share-story-button" onClick={() => setOpen(false)}>Close</button></div>
      <p className="sharing-story-title">{title}</p>
      <p className="writer-help">Share the current saved manuscript and story structure with a StoryTool account. Recipients can read beats, arcs, characters, and timeline context. Private annotations, past versions, and AI conversations stay private.</p>
      <form className="sharing-form" onSubmit={event => { event.preventDefault(); if (email.trim() && !pending) save.mutate({ email, allow: allowImport }) }}>
        <label>Recipient’s sign-in email<input type="email" required maxLength={320} autoFocus value={email} onChange={event => setEmail(event.target.value)} placeholder="writer@gmail.com" /></label>
        <label>Permission<select aria-label="Sharing permission" value={allowImport ? 'import' : 'read'} onChange={event => setAllowImport(event.target.value === 'import')}><option value="read">Read only</option><option value="import">Read and import a copy</option></select></label>
        <button type="submit" className="sharing-primary" disabled={pending || !email.trim()}>{save.isPending ? 'Saving…' : 'Grant access'}</button>
      </form>
      <div className="sharing-link"><button type="button" className="share-story-button" onClick={() => { void copyLink() }}>Copy reader link</button><p className="writer-help">No email is sent automatically. The story appears under Shared with you when the recipient signs in with this email.</p></div>
      {message && <p role="status" className="sharing-message">{message}</p>}
      {(save.isError || revoke.isError || shares.isError) && <p role="alert" className="writer-error">{errorText(save.error ?? revoke.error ?? shares.error)}</p>}
      <h3 className="sharing-subheading">People with access</h3>
      {shares.isPending && open && <p className="writer-help">Loading permissions…</p>}
      {shares.data?.length === 0 && <p className="writer-help">This story is private. Grant access to share it.</p>}
      <ul className="sharing-people">{shares.data?.map(share => <li key={share.id}><span>{share.recipient_email}</span><select aria-label={`Permission for ${share.recipient_email}`} disabled={pending} value={share.allow_import ? 'import' : 'read'} onChange={event => save.mutate({ email: share.recipient_email, allow: event.target.value === 'import' })}><option value="read">Read only</option><option value="import">Read and import a copy</option></select><button type="button" className="share-story-button" disabled={pending} onClick={() => { if (window.confirm(`Revoke access for ${share.recipient_email}? Copies already imported will remain theirs.`)) revoke.mutate(share.id) }}>Revoke</button></li>)}</ul>
      <p className="writer-help">You keep ownership. Imports are independent drafts; later changes and revoked access do not remove copies already imported. Moving this story to Trash hides it from recipients until restored.</p>
    </dialog>
  </>
}
