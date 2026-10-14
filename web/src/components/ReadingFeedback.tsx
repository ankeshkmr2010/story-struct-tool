import { useMutation } from '@tanstack/react-query'
import { api, type DecisionLabel } from '../api/client'
import { errorText } from '../api/errors'

export function ReadingFeedback({ storyId, checkCode, evidenceKeys, probability, disabled, onRecorded }: { storyId: string; checkCode: string; evidenceKeys: string[]; probability: number; disabled?: boolean; onRecorded?: (outcome: DecisionLabel['outcome']) => void }) {
  const record = useMutation({ mutationFn: (outcome: DecisionLabel['outcome']) => api.recordDecisionFeedback(storyId, { check_code: checkCode, evidence_keys: [...new Set(evidenceKeys)].slice(0, 256), probability, outcome }), onSuccess: (_, outcome) => onRecorded?.(outcome) })
  if (!evidenceKeys.length) return null
  return <div className="mt-2 text-xs">
    {record.isSuccess ? <span role="status">Feedback saved: {record.variables === 'accepted' ? 'useful' : 'dismissed'}.</span> : <div className="flex flex-wrap gap-3">
      <button type="button" className="underline" disabled={disabled || record.isPending} onClick={() => record.mutate('accepted')}>Useful</button>
      <button type="button" className="underline" disabled={disabled || record.isPending} onClick={() => record.mutate('dismissed')}>Dismiss</button>
      {record.isPending && <span role="status">Saving feedback…</span>}
    </div>}
    {record.error && <p role="alert">Feedback was not saved. {errorText(record.error)} Try the action again.</p>}
  </div>
}
