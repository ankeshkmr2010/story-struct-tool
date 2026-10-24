import { useState, type MouseEvent } from 'react'
import { api } from '../api/client'
import { Dialog } from '../ui/Dialog'
import { Menu, MenuLink } from '../ui/Menu'
import { t, tx } from '../i18n'

const ITEMS = [
  { label: tx('Manuscript (.docx)'), help: tx('For Word or Google Docs'), href: api.manuscriptDocxUrl },
  { label: tx('Submission manuscript (.pdf)'), help: tx('Double-spaced; optional appendices below'), href: api.manuscriptPdfUrl },
  { label: tx('E-book (.epub)'), help: tx('For Apple Books, Kobo and Kindle (via Send to Kindle)'), href: api.manuscriptEpubUrl },
  { label: tx('Web page (.html)'), help: tx('Opens in any browser'), href: api.manuscriptHtmlUrl },
  { label: tx('Manuscript (.md)'), help: tx('Includes an image folder in a ZIP when needed'), href: api.manuscriptUrl },
  { label: tx('Plain text (.txt)'), help: tx('No formatting at all'), href: api.manuscriptTextUrl },
  { label: tx('Full backup (.json)'), help: tx('Everything, including notes and revisions. Restore it from your library.'), href: api.backupUrl, backup: true },
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
  <Menu label={t('Export ▾')} triggerClassName="share-story-button" panelClassName="download-menu-panel">
    {ITEMS.map(item => {
      const href = item.href === api.manuscriptPdfUrl ? api.manuscriptPdfUrl(storyId, appendices) : item.href(storyId)
      return <MenuLink key={item.label} href={href} onClick={'backup' in item ? undefined : event => { void checkPlaceholders(event, href) }}><strong>{t(item.label)}</strong><span>{item.help && t(item.help)}</span></MenuLink>
    })}
    <fieldset className="border-t border-[var(--line)] p-3 text-xs"><legend className="px-1">{t('PDF appendices (optional)')}</legend>
      {(['glossary', 'timeline', 'places'] as const).map((key) => <label key={key} className="mr-3 inline-flex items-center gap-1.5"><input type="checkbox" aria-label={t('Include {0} appendix in PDF', key)} checked={appendices[key]} onChange={(event) => setAppendices({ ...appendices, [key]: event.target.checked })} />{key[0].toUpperCase() + key.slice(1)}</label>)}
    </fieldset>
  </Menu>
  <Dialog open={unfinished !== null} onClose={() => setUnfinished(null)} title={unfinished?.count === 1 ? t('1 TK placeholder remains') : t('{0} TK placeholders remain', unfinished?.count ?? 0)}>
    <p className="writer-help">{t('This draft still has [TK] markers for details you meant to fill in later. They will appear in the export as written.')}</p>
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      {onShowPlaceholders && <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setUnfinished(null); onShowPlaceholders() }}>{t('Show them')}</button>}
      <button type="button" className="ui-btn ui-btn-primary" onClick={() => { if (unfinished) window.location.assign(unfinished.href); setUnfinished(null) }}>{t('Export anyway')}</button>
    </div>
  </Dialog>
  </>
}
