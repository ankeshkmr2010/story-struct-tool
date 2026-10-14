import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

const ITEMS = [
  { label: 'Manuscript (.docx)', help: 'For Word or Google Docs', href: api.manuscriptDocxUrl },
  { label: 'Submission manuscript (.pdf)', help: 'Double-spaced; optional appendices below', href: api.manuscriptPdfUrl },
  { label: 'E-book (.epub)', help: 'For Apple Books, Kobo and Kindle (via Send to Kindle)', href: api.manuscriptEpubUrl },
  { label: 'Web page (.html)', help: 'Opens in any browser', href: api.manuscriptHtmlUrl },
  { label: 'Manuscript (.md)', help: 'Includes an image folder in a ZIP when needed', href: api.manuscriptUrl },
  { label: 'Plain text (.txt)', help: 'No formatting at all', href: api.manuscriptTextUrl },
  { label: 'Full backup (.json)', help: 'Everything, including notes and revisions. Restore it from your library.', href: api.backupUrl },
]

export function DownloadMenu({ storyId }: { storyId: string }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const [appendices, setAppendices] = useState({ glossary: false, timeline: false, places: false })
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
      {ITEMS.map(item => <a key={item.label} role="menuitem" href={item.href === api.manuscriptPdfUrl ? api.manuscriptPdfUrl(storyId, appendices) : item.href(storyId)} onClick={() => { if (menu.current) menu.current.open = false }}><strong>{item.label}</strong><span>{item.help}</span></a>)}
      <fieldset className="border-t border-[var(--line)] p-3 text-xs"><legend className="px-1">PDF appendices (optional)</legend>
        {(['glossary', 'timeline', 'places'] as const).map((key) => <label key={key} className="mr-3 inline-flex items-center gap-1.5"><input type="checkbox" checked={appendices[key]} onChange={(event) => setAppendices({ ...appendices, [key]: event.target.checked })} />{key[0].toUpperCase() + key.slice(1)}</label>)}
      </fieldset>
    </div>
  </details>
}
