import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'

export function ReaderCalibration() {
  const query = useQuery({ queryKey: ['decision-calibration'], queryFn: api.decisionCalibration })
  const [copy, setCopy] = useState('')
  return <section className="mt-12" aria-labelledby="reader-calibration-title">
    <div className="flex items-center justify-between gap-3"><h2 id="reader-calibration-title" className="text-xl font-semibold">{t('Reader feedback calibration')}</h2><button type="button" className="text-sm underline" onClick={() => { void query.refetch() }}>{t('Refresh')}</button></div>
    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{t('Last 90 days, separated by provider, model and rubric version. Useful/dismissed feedback reflects writers\' judgement, not guaranteed correctness. Suggestions require at least 100 signed-in labels and five reviewers, exclude anonymous labels and never lower the current threshold. No threshold changes automatically.')}</p>
    {query.isPending && <p className="mt-3">{t('Loading calibration…')}</p>}
    {query.error && <p role="alert" className="mt-3">{errorText(query.error)}</p>}
    {query.data?.length === 0 && <p className="mt-3 text-sm">{t('No reader feedback yet.')}</p>}
    {!!query.data?.length && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{[t('Check / model'), t('Useful / labels'), t('Reviewers'), t('Anonymous'), t('Threshold'), t('Suggested')].map(title => <th key={title} className="p-2">{title}</th>)}</tr></thead><tbody>{query.data.map(row => <tr key={row.override_key} className="border-t border-[var(--line)]">
      <td className="p-2"><strong>{row.check_code}</strong><br />{row.model}<br /><span className="text-[var(--muted)]">{row.provider.split(':')[0]} · {row.rubric_version}</span><details><summary>{t('Confidence bands')}</summary>{row.bands.map(band => <p key={band.lower}>{t('{0}–{1}: {2}/{3} useful', band.lower.toFixed(2), Math.min(1, band.lower + .05).toFixed(2), band.accepted, band.labels)}</p>)}</details></td>
      <td className="p-2">{row.accepted} / {row.labels}</td><td className="p-2">{row.reviewers}</td><td className="p-2">{row.anonymous_labels}</td><td className="p-2">{row.threshold.toFixed(2)}</td>
      <td className="p-2">{row.suggested_threshold == null ? t('No recommendation') : <>{row.suggested_threshold.toFixed(2)} <button type="button" className="underline" onClick={() => { void navigator.clipboard.writeText(JSON.stringify({ [row.override_key]: row.suggested_threshold })).then(() => setCopy(t('Override JSON copied. Merge it into STORYTOOL_DECISION_THRESHOLDS in Render.'))).catch(() => setCopy(t('Clipboard unavailable. Use the key and value shown below.'))) }}>{t('Copy override')}</button><details><summary>{t('Override key')}</summary><code className="break-all">{row.override_key}</code></details></>}</td>
    </tr>)}</tbody></table></div>}
    {copy && <p role="status" className="mt-3 text-xs">{copy}</p>}
  </section>
}
