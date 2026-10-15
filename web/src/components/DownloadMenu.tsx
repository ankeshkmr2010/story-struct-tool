import { useState } from 'react'
import { api } from '../api/client'
import { Menu, MenuLink } from '../ui/Menu'

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
  const [appendices, setAppendices] = useState({ glossary: false, timeline: false, places: false })
  return <Menu label="Export ▾" triggerClassName="share-story-button" panelClassName="download-menu-panel">
    {ITEMS.map(item => <MenuLink key={item.label} href={item.href === api.manuscriptPdfUrl ? api.manuscriptPdfUrl(storyId, appendices) : item.href(storyId)}><strong>{item.label}</strong><span>{item.help}</span></MenuLink>)}
    <fieldset className="border-t border-[var(--line)] p-3 text-xs"><legend className="px-1">PDF appendices (optional)</legend>
      {(['glossary', 'timeline', 'places'] as const).map((key) => <label key={key} className="mr-3 inline-flex items-center gap-1.5"><input type="checkbox" checked={appendices[key]} onChange={(event) => setAppendices({ ...appendices, [key]: event.target.checked })} />{key[0].toUpperCase() + key.slice(1)}</label>)}
    </fieldset>
  </Menu>
}
