import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type HintReading } from '../api/client'
import { errorText } from '../api/errors'
import { SANDBOX_ID } from '../sandbox/storage'
import { ReadingFeedback } from './ReadingFeedback'

export function LiveWritingHints({ storyId, sceneId, content, onParagraph }: { storyId: string; sceneId: string; content: string; onParagraph: (paragraph: number, find?: string) => void }) {
  const sandbox = storyId === SANDBOX_ID
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId), enabled: sandbox })
  const glossary = useQuery({ queryKey: ['glossary', storyId], queryFn: () => api.listGlossary(storyId), enabled: sandbox })
  const names = JSON.stringify([...new Set([...(characters.data ?? []).flatMap(item => [item.name, ...(item.aliases ?? [])]), ...(glossary.data ?? []).flatMap(item => [item.term, ...(item.aliases ?? [])])])])
  const [reading, setReading] = useState<{ text: string; result?: HintReading; error?: string }>()
  const [retry, setRetry] = useState(0)
  const key = `storytool-hint-dismissals:${storyId}:${sceneId}`
  const [dismissed, setDismissed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '[]') as string[] } catch { return [] } })
  const ready = !sandbox || Boolean(characters.data && glossary.data)
  useEffect(() => {
    if (!ready || !content.trim()) return
    let current = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api.writingHints(storyId, sceneId, content, JSON.parse(names) as string[], controller.signal).then(result => {
        if (current) setReading({ text: content, result })
      }).catch(error => {
        if (current) setReading({ text: content, error: errorText(error) })
      })
    }, 2000)
    return () => { current = false; window.clearTimeout(timer); controller.abort() }
  }, [storyId, sceneId, content, names, ready, retry])
  const result = reading?.text === content ? reading : undefined
  const hints = (result?.result?.hints ?? []).filter(hint => !dismissed.includes(`${result?.result?.content_hash}:${hint.code}`))
  const dismiss = (code: string) => {
    const next = [...dismissed, `${result?.result?.content_hash}:${code}`].slice(-500)
    setDismissed(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Notes can still be dismissed for this visit. */ }
  }
  return <aside className="live-writing-hints" aria-label="Live writing hints">
    <h3>Live hints</h3>
    <p className="writer-help">Only this scene and known names go to the shared reader. Notes never change your prose.</p>
    {result?.result?.unavailable && <p role="status" className="writer-help">{result.result.unavailable} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry unread sections</button></p>}
    {!content.trim() ? <p className="writer-help">Start writing to see hints.</p> : !ready ? <p className="writer-help">Loading known names… {(characters.isError || glossary.isError) && <button type="button" onClick={() => { void characters.refetch(); void glossary.refetch() }}>Retry</button>}</p> : !result ? <p role="status" className="writer-help">Reading after you pause…</p> : result.error ? <p className="writer-help">{result.error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : hints.length === 0 ? result.result?.unavailable ? null : <p className="writer-help">No specific issue found in this reading.</p> : hints.map(hint => <div className="live-writing-hint" key={hint.code}>
      <p>{hint.message}</p>
      {hint.excerpt && <blockquote className="my-2 border-l-2 border-[var(--line)] pl-2 text-[var(--muted)]">{hint.excerpt}</blockquote>}
      {hint.action && <p>{hint.action}</p>}

      {hint.paragraph && <button type="button" onClick={() => onParagraph(hint.paragraph!, hint.excerpt ?? undefined)}>Open paragraph {hint.paragraph}</button>}
      <ReadingFeedback storyId={storyId} checkCode={`hint.${hint.kind ?? (hint.code.startsWith('telling_') ? 'telling' : hint.code)}`} evidenceKeys={hint.evidence_keys ?? []} probability={hint.probability} rubricVersion={result?.result?.rubric_version} onRecorded={() => dismiss(hint.code)} />
    </div>)}
  </aside>
}
