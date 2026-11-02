import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type SetupList, type SetupMark } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'

const kindName = (mark: SetupMark) => mark.kind === 'setup' ? t('Setup') : t('Payoff')
const markName = (mark: SetupMark) => mark.label || mark.text

/** The marks linked to `mark`: its payoffs for a setup, its setups for a payoff. */
export function linkedMarks(data: SetupList, mark: SetupMark) {
  const byId = new Map(data.marks.map(item => [item.id, item]))
  return data.links
    .filter(link => (mark.kind === 'setup' ? link.setup_id : link.payoff_id) === mark.id)
    .flatMap(link => { const other = byId.get(mark.kind === 'setup' ? link.payoff_id : link.setup_id); return other ? [{ link, mark: other }] : [] })
}

function useSetupEdits(storyId: string) {
  const qc = useQueryClient()
  const done = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['setups', storyId] }),
    qc.invalidateQueries({ queryKey: ['evaluators', storyId] }),
  ])
  return useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSettled: done })
}

/** The menu a setup/payoff chip opens in Write: name it, follow or change its links, accept a
 *  suggestion, or remove it. Flags about missing payoffs live in Checks, not here. */
export function SetupMarkMenu({ storyId, mark, data, x, y, onClose, onOpen }: {
  storyId: string; mark: SetupMark; data: SetupList; x: number; y: number
  onClose: () => void; onOpen: (mark: SetupMark) => void
}) {
  const edit = useSetupEdits(storyId)
  const [label, setLabel] = useState(mark.label ?? '')
  const linked = linkedMarks(data, mark)
  const candidates = data.marks.filter(other => other.kind !== mark.kind && !linked.some(item => item.mark.id === other.id))
  const saveLabel = () => { if ((mark.label ?? '') !== label.trim()) edit.mutate(() => api.updateSetupMark(storyId, mark.id, { label: label.trim() || null })) }
  return <div className="writer-context-menu setup-menu" role="dialog" aria-label={kindName(mark)} style={{ left: Math.max(8, Math.min(x, window.innerWidth - 268)), top: Math.max(8, Math.min(y + 4, window.innerHeight - 320)) }} onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <p><strong>{kindName(mark)}</strong>{mark.status === 'suggested' && <> · {t('suggested by your AI')}</>}</p>
    <label className="setup-menu-label">{t('Name')}
      <input autoFocus value={label} placeholder={mark.text.slice(0, 60)} maxLength={200} onChange={event => setLabel(event.target.value)} onBlur={saveLabel} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveLabel() } }} />
    </label>
    <p>{mark.kind === 'setup' ? t('Paid off by') : t('Sets it up')}</p>
    {linked.length === 0 && <p className="setup-menu-empty">{t('Nothing linked yet.')}</p>}
    <ul className="setup-menu-links">
      {linked.map(({ link, mark: other }) => <li key={link.id}>
        <button type="button" onClick={() => onOpen(other)} title={t('Open in Write')}>{other.scene_title}: {markName(other)}{link.status === 'suggested' ? ` (${t('suggested')})` : ''}</button>
        {link.status === 'suggested' && <button type="button" disabled={edit.isPending} onClick={() => edit.mutate(() => api.acceptSetupLink(storyId, link.id))}>{t('Accept')}</button>}
        <button type="button" disabled={edit.isPending} aria-label={t('Unlink {0}', markName(other))} onClick={() => edit.mutate(() => api.deleteSetupLink(storyId, link.id))}>{t('Unlink')}</button>
      </li>)}
    </ul>
    {candidates.length > 0 && <select aria-label={t('Link to…')} value="" disabled={edit.isPending} onChange={event => { const other = event.target.value; if (other) edit.mutate(() => mark.kind === 'setup' ? api.linkSetup(storyId, mark.id, other) : api.linkSetup(storyId, other, mark.id)) }}>
      <option value="">{mark.kind === 'setup' ? t('Link to a payoff…') : t('Link to a setup…')}</option>
      {candidates.map(other => <option key={other.id} value={other.id}>{other.scene_title}: {markName(other).slice(0, 60)}</option>)}
    </select>}
    {candidates.length === 0 && linked.length === 0 && <p className="setup-menu-empty">{mark.kind === 'setup' ? t('Mark a payoff to link it here.') : t('Mark a setup to link it here.')}</p>}
    {edit.error && <p role="alert">{errorText(edit.error)}</p>}
    <div className="setup-menu-actions">
      {mark.status === 'suggested' && <button type="button" disabled={edit.isPending} onClick={() => edit.mutate(() => api.updateSetupMark(storyId, mark.id, { status: 'active' }))}>{t('Accept')}</button>}
      <button type="button" disabled={edit.isPending} onClick={() => edit.mutate(async () => { await api.deleteSetupMark(storyId, mark.id); onClose() })}>{t('Remove mark')}</button>
      <button type="button" onClick={onClose}>{t('Close')}</button>
    </div>
  </div>
}

/** Design → Setups and payoffs: every pair in reading order, open any end in Write. */
export function SetupMarksPanel({ storyId, onOpenPassage }: { storyId: string; onOpenPassage: (sceneId: string, find: string, paragraph: number) => void }) {
  const setups = useQuery({ queryKey: ['setups', storyId], queryFn: () => api.listSetups(storyId) })
  const edit = useSetupEdits(storyId)
  if (setups.isPending) return <p className="writer-help">{t('Loading setups and payoffs…')}</p>
  if (setups.error) return <p role="alert">{errorText(setups.error)}</p>
  const data = setups.data
  const open = (mark: SetupMark) => { if (mark.found && mark.find && mark.paragraph) onOpenPassage(mark.scene_id, mark.find, mark.paragraph) }
  const item = (mark: SetupMark) => <span className="setup-item">
    <button type="button" className="link-button" disabled={!mark.found} onClick={() => open(mark)}>{markName(mark)}</button>
    <span className="setup-item-scene">{mark.scene_title}{!mark.found && <> · {t('text changed')}</>}</span>
    {mark.status === 'suggested' && <>
      <span className="setup-item-scene">{t('suggested by your AI')}</span>
      <button type="button" disabled={edit.isPending} onClick={() => edit.mutate(() => api.updateSetupMark(storyId, mark.id, { status: 'active' }))}>{t('Accept')}</button>
      <button type="button" disabled={edit.isPending} onClick={() => edit.mutate(() => api.deleteSetupMark(storyId, mark.id))}>{t('Remove')}</button>
    </>}
  </span>
  const linkedPayoffs = new Set(data.links.map(link => link.payoff_id))
  const setupMarks = data.marks.filter(mark => mark.kind === 'setup')
  const loose = data.marks.filter(mark => mark.kind === 'payoff' && !linkedPayoffs.has(mark.id))
  return <div className="setup-panel">
    <p className="writer-help">{t('Select text in Write, then choose Mark as setup or Mark as payoff. Click a chip in Write to link them. Check my story → Craft checks lists setups that never pay off.')}</p>
    {edit.error && <p role="alert" className="writer-error">{errorText(edit.error)}</p>}
    {data.marks.length === 0 && <p className="writer-help">{t('Nothing marked yet.')}</p>}
    {setupMarks.length > 0 && <ul className="setup-list">
      {setupMarks.map(mark => {
        const payoffs = linkedMarks(data, mark)
        return <li key={mark.id}>
          <p className="setup-kind">{t('Setup')}</p>{item(mark)}
          <ul>
            {payoffs.length === 0 && <li className="writer-help">{t('No payoff yet.')}</li>}
            {payoffs.map(({ link, mark: payoff }) => <li key={link.id}>
              <span className="setup-kind">{t('Payoff')}</span>{item(payoff)}
              {link.status === 'suggested' && <>
                <span className="setup-item-scene">{t('link suggested by your AI')}</span>
                <button type="button" disabled={edit.isPending} onClick={() => edit.mutate(() => api.acceptSetupLink(storyId, link.id))}>{t('Accept')}</button>
                <button type="button" disabled={edit.isPending} onClick={() => edit.mutate(() => api.deleteSetupLink(storyId, link.id))}>{t('Remove')}</button>
              </>}
            </li>)}
          </ul>
        </li>
      })}
    </ul>}
    {loose.length > 0 && <>
      <h3 className="setup-heading">{t('Payoffs with no setup')}</h3>
      <ul className="setup-list">{loose.map(mark => <li key={mark.id}>{item(mark)}</li>)}</ul>
    </>}
  </div>
}
