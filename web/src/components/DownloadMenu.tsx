import { useState, type MouseEvent } from 'react'
import { api } from '../api/client'
import { Dialog } from '../ui/Dialog'
import { Menu, MenuLink } from '../ui/Menu'

const ITEMS = [
  { label: 'Manuscript (.docx)', help: 'For Word or Google Docs', href: api.manuscriptDocxUrl },
  { label: 'Submission manuscript (.pdf)', help: 'Double-spaced; optional appendices below', href: api.manuscriptPdfUrl },
  { label: 'E-book (.epub)', help: 'For Apple Books, Kobo and Kindle (via Send to Kindle)', href: api.manuscriptEpubUrl },
  { label: 'Web page (.html)', help: 'Opens in any browser', href: api.manuscriptHtmlUrl },
  { label: 'Manuscript (.md)', help: 'Includes an image folder in a ZIP when needed', href: api.manuscriptUrl },
  { label: 'Plain text (.txt)', help: 'No formatting at all', href: api.manuscriptTextUrl },
  { label: 'Full backup (.json)', help: 'Everything, including notes and revisions. Restore it from your library.', href: api.backupUrl, backup: true },
]

export function DownloadMenu({ storyId, onShowPlaceholders }: { storyId: string; onShowPlaceholders?: () => void }) {
  const [appendices, setAppendices] = useState({ glossary: false, timeline: false, places: false })
  const [unfinished, setUnfinished] = useState<{ href: string; count: number } | null>(null)
  // Manuscript exports first look for [TK] placeholders; a failed check never blocks the export.
  const checkPlaceholders = async (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault()
    const count = await api.runEvaluator(storyId, 'tk_placeholders').then(result => result.findings.length, () => 0)
    if (count) setUnfinished({ href, count })
    else window.location.assign(href)
  }
  return <>
  <Menu label="Export ▾" triggerClassName="share-story-button" panelClassName="download-menu-panel">
    {ITEMS.map(item => {
      const href = item.href === api.manuscriptPdfUrl ? api.manuscriptPdfUrl(storyId, appendices) : item.href(storyId)
      return <MenuLink key={item.label} href={href} onClick={'backup' in item ? undefined : event => { void checkPlaceholders(event, href) }}><strong>{item.label}</strong><span>{item.help}</span></MenuLink>
    })}
    <fieldset className="border-t border-[var(--line)] p-3 text-xs"><legend className="px-1">PDF appendices (optional)</legend>
      {(['glossary', 'timeline', 'places'] as const).map((key) => <label key={key} className="mr-3 inline-flex items-center gap-1.5"><input type="checkbox" aria-label={`Include ${key} appendix in PDF`} checked={appendices[key]} onChange={(event) => setAppendices({ ...appendices, [key]: event.target.checked })} />{key[0].toUpperCase() + key.slice(1)}</label>)}
    </fieldset>
  </Menu>
  <Dialog open={unfinished !== null} onClose={() => setUnfinished(null)} title={unfinished?.count === 1 ? '1 TK placeholder remains' : `${unfinished?.count ?? 0} TK placeholders remain`}>
    <p className="writer-help">This draft still has [TK] markers for details you meant to fill in later. They will appear in the export as written.</p>
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      {onShowPlaceholders && <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setUnfinished(null); onShowPlaceholders() }}>Show them</button>}
      <button type="button" className="ui-btn ui-btn-primary" onClick={() => { if (unfinished) window.location.assign(unfinished.href); setUnfinished(null) }}>Export anyway</button>
    </div>
  </Dialog>
  </>
}
