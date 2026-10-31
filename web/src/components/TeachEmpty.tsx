import type { ReactNode } from 'react'
import { t } from '../i18n'
import { SANDBOX_ID } from '../sandbox/storage'

/**
 * Usability phase 3, item 10: a blank panel says what it is for, offers one way to start, and links to
 * the same panel in The Last Lantern (the /try sandbox) as a worked example.
 * `field` is the placeholder of the panel's add box, which the start button focuses.
 */
export function TeachEmpty({ storyId, purpose, start, field, onStart, example }: {
  storyId?: string
  purpose: ReactNode
  start: string
  field?: string
  onStart?: () => void
  example?: number
}) {
  const begin = onStart ?? (() => {
    const input = field ? document.querySelector<HTMLElement>(`[placeholder="${CSS.escape(field)}"]`) : null
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' }); input?.focus()
  })
  return <div className="ui-empty teach-empty">
    <p>{purpose}</p>
    <div className="teach-empty-actions">
      <button type="button" className="ui-btn ui-btn-primary" onClick={begin}>{start}</button>
      {example !== undefined && storyId !== SANDBOX_ID && <a href={`/try?open=${example}`} target="_blank" rel="noopener noreferrer">{t('See an example')}</a>}
    </div>
  </div>
}

/** Start buttons that need another tab reopen the story there. */
export const openStoryAt = (storyId: string, open: string | number) => window.location.assign(`/stories/${storyId}?open=${open}`)
