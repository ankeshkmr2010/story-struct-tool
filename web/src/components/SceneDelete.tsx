import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Scene } from '../api/client'
import { errorText } from '../api/errors'
import { forgetWriterDraft, writerDraft, writerHasUnsaved } from './writerDraft'
import { t } from '../i18n'

export function SceneDelete({ storyId, scene, onDeleted }: { storyId: string; scene: Scene; onDeleted?: () => void }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser })
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const remove = useMutation({
    mutationFn: async () => {
      if (!me.data) throw new Error(t('Sign-in information is not ready. Please retry.'))
      const key = `storytool-writer:${me.data?.id}:${storyId}:${scene.id}`
      if (writerHasUnsaved(key) && !await writerDraft(key, '').flush()) throw new Error(t('Save or resolve the unsaved prose conflict before deleting this scene. Your draft is preserved.'))
      await api.deleteScene(storyId, scene.id)
    },
    onSuccess: () => {
      forgetWriterDraft(`storytool-writer:${me.data?.id}:${storyId}:${scene.id}`)
      setOpen(false)
      qc.removeQueries({ queryKey: ['content', storyId, scene.id] })
      void qc.invalidateQueries({ predicate: query => query.queryKey.includes(storyId) || query.queryKey[0] === 'arc-stages' })
      onDeleted?.()
    },
  })
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  return <>
    <button type="button" className="scene-delete-button" aria-label={t('Delete scene {0}', scene.title || t('Untitled scene'))} onClick={() => { remove.reset(); setOpen(true) }}>{t('Delete scene')}</button>
    <dialog ref={dialog} className="story-sharing-dialog" aria-labelledby={headingId} onClose={() => setOpen(false)} onCancel={event => { if (remove.isPending) event.preventDefault() }}>
      <h2 id={headingId}>{t('Delete this scene?')}</h2>
      <p className="writer-help">{t('“{0}” and its prose, notes, and structural links will be removed. A whole-story recovery version is saved before deletion, and a new version records the result. Existing timeline events are kept.', scene.title || t('Untitled scene'))}</p>
      <p className="writer-help">{t('Recover it through Versions in the story header. Restoring a version restores the whole story.')}</p>
      {remove.isError && <p role="alert" className="writer-error">{errorText(remove.error)}</p>}
      <div className="shared-reader-actions"><button type="button" className="share-story-button" disabled={remove.isPending} onClick={() => setOpen(false)}>{t('Cancel')}</button><button type="button" className="scene-delete-button" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? t('Saving version and deleting…') : t('Delete scene')}</button></div>
    </dialog>
  </>
}
