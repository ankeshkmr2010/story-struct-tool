import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { api, type HintReading } from '../api/client'
import { errorText } from '../api/errors'
import { SANDBOX_ID } from '../sandbox/storage'
import { ReadingFeedback } from './ReadingFeedback'
import { t } from '../i18n'

export function LiveWritingHints({ storyId, sceneId, sceneTitle, content, currentParagraph = 1, onParagraph, slot }: { storyId: string; sceneId: string; sceneTitle?: string | null; content: string; slot?: HTMLElement | null; currentParagraph?: number; onParagraph: (paragraph: number, find?: string, wholeScene?: boolean) => void }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ top: number; right: number; maxHeight: number; width: number }>()
  // Docked: the workspace side panel supplies the slot, so nothing floats over the prose.
  const docked = slot !== undefined
  useEffect(() => {
    if (docked) return
    const writer = anchor.current?.closest('.story-writer')
    if (!writer) return
    const align = () => {
      const box = writer.getBoundingClientRect()
      const toolbarBottom = writer.querySelector('.writer-toolbar')?.getBoundingClientRect().bottom ?? box.top
      const headerBottom = writer.classList.contains('writer-focus') ? 0 : document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0
      const top = Math.max(toolbarBottom, headerBottom) + 12
      setPosition({ top, right: Math.max(12, window.innerWidth - box.right + 12), maxHeight: Math.max(0, Math.min(window.innerHeight, box.bottom) - top - 12), width: Math.min(240, box.width - 24) })
    }
    align()
    window.addEventListener('scroll', align, true)
    window.addEventListener('resize', align)
    const observer = new ResizeObserver(align)
    observer.observe(writer)
    return () => { window.removeEventListener('scroll', align, true); window.removeEventListener('resize', align); observer.disconnect() }
  }, [docked])
  const sandbox = storyId === SANDBOX_ID
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId), enabled: sandbox })
  const glossary = useQuery({ queryKey: ['glossary', storyId], queryFn: () => api.listGlossary(storyId), enabled: sandbox })
  const personalChecks = useQuery({ queryKey: ['validators', 0], queryFn: () => api.listValidators(0), enabled: !sandbox })
  const checksRevision = sandbox ? 0 : personalChecks.dataUpdatedAt
  const enabledChecks = Math.min(20, personalChecks.data?.items.filter(item => item.enabled).length ?? 0)
  const names = JSON.stringify([...new Set([...(characters.data ?? []).flatMap(item => [item.name, ...(item.aliases ?? [])]), ...(glossary.data ?? []).flatMap(item => [item.term, ...(item.aliases ?? [])])])])
  const [reading, setReading] = useState<{ text: string; checksRevision: number; result?: HintReading; error?: string }>()
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
        if (current) setReading({ text: content, checksRevision, result })
      }).catch(error => {
        if (current) setReading({ text: content, checksRevision, error: errorText(error) })
      })
    }, 2000)
    return () => { current = false; window.clearTimeout(timer); controller.abort() }
  }, [storyId, sceneId, content, names, ready, retry, checksRevision])
  const result = reading?.text === content && reading?.checksRevision === checksRevision ? reading : undefined
  const hints = (result?.result?.hints ?? []).filter(hint => !dismissed.includes(`${result?.result?.content_hash}:${hint.code}`)).sort((a, b) => {
    const atCursor = (hint: typeof a) => hint.paragraph === currentParagraph || hint.passages?.some(passage => passage.paragraph === currentParagraph)
    return Number(atCursor(b)) - Number(atCursor(a)) || Number(a.kind?.startsWith('custom_uncertain.') ?? false) - Number(b.kind?.startsWith('custom_uncertain.') ?? false) || (a.paragraph ?? Infinity) - (b.paragraph ?? Infinity)
  })
  const dismiss = (code: string) => {
    setDismissed(previous => {
      const next = [...new Set([...previous, `${result?.result?.content_hash}:${code}`])].slice(-500)
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Notes can still be dismissed for this visit. */ }
      return next
    })
  }
  return <><span ref={anchor} hidden />{(docked ? slot : position) && createPortal(<aside className={docked ? 'live-writing-hints is-docked' : 'live-writing-hints'} style={docked || !position ? undefined : { ...position, display: position.maxHeight < 60 ? 'none' : undefined }} aria-label={t('Live writing hints')}>
    <h3>{t('Live hints')}</h3>
    <details className="live-hints-about"><summary>{t('About live hints')}</summary><p>{t('This scene, known names and enabled personal check questions and examples go to the shared reader. Notes never change your prose.')}</p></details>
    {result?.result && <p className="live-hint-advice">{t('Read {0}{1}{2}', sceneTitle || t('this scene'), result.result.sections_total > 1 ? t(' · {0} of {1} sections', result.result.sections_read, result.result.sections_total) : '', sandbox ? '' : t(' · {0} personal check{1}', enabledChecks, enabledChecks === 1 ? '' : t('s')))}</p>}
    {!content.trim() ? <p className="writer-help">{t('Start writing to see hints.')}</p> : !ready ? <p className="writer-help">{t('Loading known names…')}{' '}{(characters.isError || glossary.isError) && <button type="button" onClick={() => { void characters.refetch(); void glossary.refetch() }}>{t('Retry')}</button>}</p> : !result ? <p role="status" className="writer-help">{t('Reading after you pause…')}</p> : result.error ? <p className="writer-help">{result.error} <button type="button" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button></p> : hints.length === 0 ? result.result?.unavailable ? null : <p className="writer-help">{t('No specific issue found in this reading.')}</p> : hints.map(hint => <div className="live-writing-hint" key={hint.code}>
      <p className="live-hint-message">{hint.message}</p>
      <p className="live-hint-advice">{hint.paragraph === currentParagraph || hint.passages?.some(passage => passage.paragraph === currentParagraph) ? t('Current paragraph') : hint.paragraph ? t('Paragraph {0}', hint.paragraph) : t('Scene')}{hint.scope ? t(' · Personal {0} check', hint.scope) : ''}</p>
      {hint.observed?.map((observation, index) => <p key={index} className="live-hint-advice">{observation}</p>)}
      {hint.location_uncertain && <p className="live-hint-advice">{t('Sentence location uncertain; showing the paragraph instead.')}</p>}
      {hint.passages?.map((passage, index) => <div key={index}><blockquote className="live-hint-excerpt">{passage.text.length > 500 ? `${passage.text.slice(0, 500)}…` : passage.text}</blockquote><button type="button" className="live-hint-passage-link" onClick={() => onParagraph(passage.paragraph, passage.text)}>{hint.highlight_scope === 'paragraph' ? t('Highlight paragraph') : hint.passages!.length > 1 ? t('Highlight sentence group {0}', index + 1) : t('Highlight sentences')}</button></div>)}
      {hint.excerpt && <blockquote className="live-hint-excerpt">{hint.excerpt}</blockquote>}
      {hint.action && <p className="live-hint-advice">{hint.action}</p>}

      <div className="live-hint-actions">{hint.paragraph && !hint.passages?.length && <button type="button" className="live-hint-passage-link" title={t('Open paragraph {0}', hint.paragraph)} onClick={() => onParagraph(hint.paragraph!, hint.excerpt ?? undefined, hint.highlight_scope === 'scene')}>{hint.highlight_scope === 'scene' ? t('Highlight scene') : hint.scope === 'scene' ? t('Open scene') : t('Open passage')}</button>}
      {hint.evidence_keys?.length ? <ReadingFeedback compact storyId={storyId} checkCode={`hint.${hint.kind ?? (hint.code.startsWith('telling_') ? 'telling' : hint.code)}`} evidenceKeys={hint.evidence_keys} probability={hint.probability} rubricVersion={hint.rubric_version ?? result?.result?.rubric_version} onDismiss={() => dismiss(hint.code)} onRecorded={outcome => { if (outcome === 'accepted') dismiss(hint.code) }} /> : <button type="button" className="live-hint-dismiss" aria-label={t('Dismiss')} title={t('Dismiss')} onClick={() => dismiss(hint.code)}>×</button>}</div>
    </div>)}
    {result?.result?.unavailable && !dismissed.includes(`${result.result.content_hash}:notice`) && <div role="status" className="live-writing-hint"><p className="live-hint-message">{t('Some checks could not finish')}</p><p className="live-hint-advice">{result.result.unavailable}</p><div className="live-hint-actions"><button type="button" onClick={() => setRetry(value => value + 1)}>{t('Retry unread sections')}</button><button type="button" className="live-hint-dismiss" aria-label={t('Dismiss')} title={t('Dismiss')} onClick={() => dismiss('notice')}>×</button></div></div>}
  </aside>, docked && slot ? slot : document.body)}</>
}
