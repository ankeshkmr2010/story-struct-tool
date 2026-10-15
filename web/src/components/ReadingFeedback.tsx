import { useMutation } from '@tanstack/react-query'
import { api, type DecisionLabel } from '../api/client'
import { errorText } from '../api/errors'

export function ReadingFeedback({ storyId, checkCode, evidenceKeys, probability, rubricVersion, disabled, onRecorded, onDismiss, compact = false }: { storyId: string; checkCode: string; evidenceKeys: string[]; probability: number; rubricVersion?: DecisionLabel['rubric_version']; disabled?: boolean; compact?: boolean; onRecorded?: (outcome: DecisionLabel['outcome']) => void; onDismiss?: () => void }) {
  const record = useMutation({ mutationFn: (outcome: DecisionLabel['outcome']) => api.recordDecisionFeedback(storyId, { check_code: checkCode, evidence_keys: [...new Set(evidenceKeys)].slice(0, 256), probability, outcome, rubric_version: rubricVersion }), onSuccess: (_, outcome) => onRecorded?.(outcome) })
  if (!evidenceKeys.length) return null
  return <div className={compact ? "text-xs" : "mt-2 text-xs"}>
    {record.isSuccess ? <span role="status">Feedback saved: {record.variables === 'accepted' ? 'useful' : 'dismissed'}.</span> : <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={compact ? "rounded p-1 hover:bg-[var(--line)]" : "underline"} aria-label="Useful" title="Useful" disabled={disabled || record.isPending} onClick={() => record.mutate('accepted')}>{compact ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 10v11H3V10h4Zm0 0 5-8c2 0 3 2 2 5l-1 3h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 2H7" /></svg> : 'Useful'}</button>
      <button type="button" className={compact ? "rounded p-1 hover:bg-[var(--line)]" : "underline"} aria-label="Dismiss" title="Dismiss" disabled={disabled || record.isPending} onClick={() => { onDismiss?.(); record.mutate('dismissed') }}>{compact ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg> : 'Dismiss'}</button>
      {record.isPending && <span role="status">Saving feedback…</span>}
    </div>}
    {record.error && <p role="alert">Feedback was not saved. {errorText(record.error)} Try the action again.</p>}
  </div>
}
