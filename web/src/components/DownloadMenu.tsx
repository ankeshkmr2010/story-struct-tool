import { useEffect, useRef } from 'react'
import { api } from '../api/client'

const ITEMS = [
  { label: 'Manuscript (.docx)', help: 'For Word or Google Docs', href: api.manuscriptDocxUrl },
  { label: 'E-book (.epub)', help: 'For Apple Books, Kobo and Kindle (via Send to Kindle)', href: api.manuscriptEpubUrl },
  { label: 'Web page (.html)', help: 'Opens in any browser', href: api.manuscriptHtmlUrl },
  { label: 'Manuscript (.md)', help: 'Plain text with Markdown headings', href: api.manuscriptUrl },
  { label: 'Plain text (.txt)', help: 'No formatting at all', href: api.manuscriptTextUrl },
  { label: 'Full backup (.json)', help: 'Everything, including notes and revisions. Restore it from your library.', href: api.backupUrl },
]

export function DownloadMenu({ storyId }: { storyId: string }) {
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const details = menu.current
      if (!details?.open) return
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !details.contains(event.target as Node)) details.open = false
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [])
  return <details ref={menu} className="download-menu">
    <summary className="share-story-button">Export ▾</summary>
    <div className="download-menu-panel" role="menu">
      {ITEMS.map(item => <a key={item.label} role="menuitem" href={item.href(storyId)} onClick={() => { if (menu.current) menu.current.open = false }}><strong>{item.label}</strong><span>{item.help}</span></a>)}
    </div>
  </details>
}
