import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type BetaFeedback } from '../api/client'
import { errorText } from '../api/errors'
import { orderChapters, orderScenes } from '../api/ordering'
import { quoteNeedle } from './readerComments'

/** Submitted beta-reader feedback for the author, grouped by chapter and scene. */
export function BetaFeedbackPanel({ storyId, focusId, onShowInWrite }: { storyId: string; focusId?: string | null; onShowInWrite: (sceneId: string, find: string) => void }) {
  const [status, setStatus] = useState<'open' | 'all'>('open')
  const qc = useQueryClient()
  const feedback = useQuery({ queryKey: ['beta-feedback', storyId, status], queryFn: () => api.betaFeedback(storyId, status) })
  const chapters = useQuery({ queryKey: ['chapters', storyId], queryFn: () => api.listChapters(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  const resolve = useMutation({
    mutationFn: (item: BetaFeedback) => api.updateBetaThread(item.id, { resolved: !item.resolved }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['beta-feedback', storyId] }); void qc.invalidateQueries({ queryKey: ['beta-feedback-counts'] }) },
  })
  useEffect(() => {
    if (focusId) document.getElementById(`feedback-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusId, feedback.data])

  const chapterOrder = orderChapters(chapters.data ?? [])
  const sceneOrder = chapterOrder.flatMap(chapter => orderScenes((scenes.data ?? []).filter(scene => scene.chapter_id === chapter.id)))
  const rank = (item: BetaFeedback) => {
    const scene = sceneOrder.findIndex(scene => scene.id === item.scene_id)
    if (scene >= 0) return scene
    const chapter = chapterOrder.findIndex(chapter => chapter.id === item.chapter_id)
    return chapter >= 0 ? sceneOrder.length + chapter : Number.MAX_SAFE_INTEGER
  }
  const place = (item: BetaFeedback) => {
    const scene = scenes.data?.find(scene => scene.id === item.scene_id)
    const chapter = chapters.data?.find(chapter => chapter.id === (scene?.chapter_id ?? item.chapter_id))
    return [chapter ? chapter.title || `Chapter ${chapter.number}` : null, scene ? scene.title || 'Untitled scene' : null].filter(Boolean).join(' · ') || 'Whole story'
  }
  const items = [...(feedback.data ?? [])].sort((a, b) => rank(a) - rank(b))

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className="flex gap-1" role="group" aria-label="Feedback filter">
        {(['open', 'all'] as const).map(value => <button key={value} type="button" className="ui-btn ui-btn-secondary" aria-pressed={status === value} onClick={() => setStatus(value)}>{value === 'open' ? 'Open' : 'All'}</button>)}
      </div>
      <Link className="text-sm underline" to={`/stories/${storyId}/beta`}>Beta readers</Link>
    </div>
    {feedback.isPending && <p className="text-sm text-[var(--muted)]">Loading feedback…</p>}
    {feedback.error && <p role="alert" className="writer-error">{errorText(feedback.error)}</p>}
    {feedback.data?.length === 0 && <p className="text-sm text-[var(--muted)]">{status === 'open' ? 'No open reader feedback.' : 'No reader feedback yet.'}</p>}
    {resolve.error && <p role="alert" className="writer-error">{errorText(resolve.error)}</p>}
    {items.map(item => {
      const [first, ...replies] = item.messages
      return <article key={item.id} id={`feedback-${item.id}`} className={`ui-card space-y-2 ${focusId === item.id ? 'feedback-focused' : ''}`}>
        <p className="text-xs text-[var(--muted)]">{place(item)} · {item.round_title}{item.resolved && ' · Addressed'}</p>
        {item.quote && <blockquote className="line-clamp-3 border-l-2 border-[var(--accent)] pl-2 text-sm italic">{item.quote}</blockquote>}
        {first && <p className="whitespace-pre-wrap text-sm"><strong>{first.name}:</strong> {first.body}</p>}
        {replies.length > 0 && <p className="text-xs text-[var(--muted)]">{replies.length} more {replies.length === 1 ? 'reply' : 'replies'}</p>}
        {(item.draft_replies ?? 0) > 0 && <p className="text-xs font-medium text-[var(--accent)]">{item.draft_replies === 1 ? 'A draft reply is' : `${item.draft_replies} draft replies are`} waiting. Open Conversation to review and send.</p>}
        <div className="flex flex-wrap gap-2">
          {item.scene_id && <button type="button" className="ui-btn ui-btn-secondary" onClick={() => onShowInWrite(item.scene_id!, quoteNeedle(item.quote))}>Show in Write</button>}
          <Link className="ui-btn ui-btn-secondary" to={item.url}>Conversation</Link>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={resolve.isPending} onClick={() => resolve.mutate(item)}>{item.resolved ? 'Reopen' : 'Mark addressed'}</button>
        </div>
      </article>
    })}
  </div>
}
