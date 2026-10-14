import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type ValidatorDefinition, type WritingValidator } from '../api/client'
import { errorText } from '../api/errors'

type AnswerType = ValidatorDefinition['question']['type']
type Option = { id: string; text: string; flag: boolean }
type Draft = { name: string; question: string; scope: NonNullable<ValidatorDefinition['input_scope']>; type: AnswerType; expected: boolean; options: Option[]; yes: string; no: string; certainty: number; advice: string; enabled: boolean }
const answerNames: Record<AnswerType, string> = { noul: 'Yes / no', choice: 'Choose an answer', score: 'Rating' }
const defaultOptions = (type: AnswerType): Option[] => type === 'score'
  ? ['No issue', 'Minor concern', 'Worth reviewing', 'Clear issue'].map((text, index) => ({ id: `level_${index}`, text, flag: index >= 2 }))
  : [{ id: 'fits', text: 'Fits the passage', flag: false }, { id: 'unrelated', text: 'Introduces an unrelated topic', flag: true }]
const blankDraft = (): Draft => ({ name: '', question: '', scope: 'paragraph', type: 'noul', expected: true, options: defaultOptions('noul'), yes: '', no: '', certainty: 80, advice: '', enabled: false })
const templates = [
  { name: 'Sentence coherence', question: "Does a sentence introduce an unrelated topic that interrupts its surrounding paragraph? Use the scene as context; allow connected memories, metaphors and intentional digressions.", advice: "Connect this thought to the character's immediate concern, move it to a relevant passage, or remove it if accidental." },
  { name: 'Modern slang', question: "Does the passage contain modern slang that conflicts with its established setting or voice? Allow deliberately modern narration and intentional contrasts.", advice: 'Consider wording that fits the setting and voice, or keep the contrast if it is intentional.' },
]

function toDraft(row: WritingValidator): Draft {
  const { definition: d } = row
  const criteria = d.question.criteria
  let options = defaultOptions(d.question.type)
  if (d.question.type === 'choice' && criteria && !Array.isArray(criteria)) {
    const matches = 'matches' in d.trigger ? d.trigger.matches : []
    options = Object.entries(criteria).map(([id, text]) => ({ id, text, flag: matches.includes(id) }))
  } else if (d.question.type === 'score' && Array.isArray(criteria)) {
    const levels = 'levels' in d.trigger ? d.trigger.levels : []
    options = criteria.map((text, index) => ({ id: `level_${index}`, text, flag: levels.includes(index) }))
  }
  const yesNo = d.question.type === 'noul' && criteria && !Array.isArray(criteria) ? criteria : {}
  return { name: d.name, question: d.question.instructions, scope: d.input_scope ?? 'paragraph', type: d.question.type, expected: 'expected' in d.trigger ? d.trigger.expected ?? true : true, options, yes: yesNo.true ?? '', no: yesNo.false ?? '', certainty: (d.minimum_probability ?? 0.8) * 100, advice: d.advice, enabled: row.enabled }
}

function toDefinition(d: Draft): ValidatorDefinition {
  const criteria = d.type === 'choice' ? Object.fromEntries(d.options.map(option => [option.id, option.text.trim()])) : d.type === 'score' ? d.options.map(option => option.text.trim()) : Object.fromEntries([['true', d.yes.trim()], ['false', d.no.trim()]].filter(([, text]) => text))
  const question = { type: d.type, instructions: d.question.trim(), criteria: d.type === 'noul' && !Object.keys(criteria).length ? null : criteria }
  if (!Number.isFinite(d.certainty) || d.certainty < 0 || d.certainty > 100) throw new Error('Choose a certainty between 0 and 100%.')
  if (!d.name.trim() || !question.instructions || !d.advice.trim()) throw new Error('Add a name, question and advice before saving.')
  if (d.type !== 'noul' && d.options.some(option => !option.text.trim())) throw new Error('Describe every answer or rating level.')
  if (d.type !== 'noul' && !d.options.some(option => option.flag)) throw new Error('Choose at least one answer or rating level that should show advice.')
  if (new TextEncoder().encode(JSON.stringify(question)).length > 24000) throw new Error('Shorten the question or answer descriptions before saving.')
  const trigger: ValidatorDefinition['trigger'] = d.type === 'noul' ? { type: 'noul', expected: d.expected } : d.type === 'choice' ? { type: 'choice', matches: d.options.filter(option => option.flag).map(option => option.id) } : { type: 'score', levels: d.options.flatMap((option, index) => option.flag ? [index] : []) }
  return { schema_version: 1, name: d.name.trim(), input_scope: d.scope, question, trigger, minimum_probability: d.certainty / 100, advice: d.advice.trim() }
}

export default function WritingChecks() {
  const qc = useQueryClient()
  const [offset, setOffset] = useState(0)
  const checks = useQuery({ queryKey: ['validators', offset], queryFn: () => api.listValidators(offset) })
  const [selected, setSelected] = useState<WritingValidator | null>(null)
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [baseline, setBaseline] = useState(() => JSON.stringify(blankDraft()))
  const [message, setMessage] = useState('')
  const dirty = JSON.stringify(draft) !== baseline
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['validators'] }) }
  const save = useMutation({
    mutationFn: () => {
      const definition = toDefinition(draft)
      return selected ? api.updateValidator(selected.id, { expected_version: selected.version, definition, enabled: draft.enabled }) : api.createValidator({ definition, enabled: draft.enabled })
    },
    onSuccess: row => {
      const next = toDraft(row)
      if (!selected) setOffset(Math.floor((checks.data?.total ?? 0) / 50) * 50)
      setSelected(row); setDraft(next); setBaseline(JSON.stringify(next)); setMessage(`Saved “${row.definition.name}”.`); refresh()
    },
    onError: refresh,
  })
  const change = useMutation({
    mutationFn: async ({ row, remove }: { row: WritingValidator; remove?: boolean }) => {
      if (remove) { await api.deleteValidator(row.id, row.version); return { row, removed: true } }
      return { row: await api.updateValidator(row.id, { expected_version: row.version, enabled: !row.enabled }), removed: false }
    },
    onSuccess: ({ row, removed }) => {
      setMessage(removed ? `Deleted “${row.definition.name}”.` : `“${row.definition.name}” ${row.enabled ? 'enabled' : 'disabled'}.`)
      if (selected?.id === row.id) {
        if (removed) { setSelected(null); setDraft(blankDraft()); setBaseline(JSON.stringify(blankDraft())) }
        else { setSelected(row); setDraft(previous => ({ ...previous, enabled: row.enabled })); setBaseline(previous => JSON.stringify({ ...JSON.parse(previous), enabled: row.enabled })) }
      }
      if (removed && checks.data?.items.length === 1 && offset > 0) setOffset(offset - 50)
      refresh()
    },
    onError: refresh,
  })
  const latest = useMutation({ mutationFn: () => api.getValidator(selected!.id), onSuccess: row => { const next = toDraft(row); setSelected(row); setDraft(next); setBaseline(JSON.stringify(next)); save.reset(); setMessage('Loaded the latest saved check.') } })
  const busy = save.isPending || change.isPending || latest.isPending
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.target === '_blank' || link.pathname === window.location.pathname) return
      if (!window.confirm('Discard unsaved changes to this check?')) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', leave, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', leave, true) }
  }, [dirty])
  const openForm = (row: WritingValidator | null, template?: typeof templates[number]) => {
    if (busy || (dirty && !window.confirm('Discard unsaved changes to this check?'))) return
    const next = row ? toDraft(row) : { ...blankDraft(), ...template }
    setSelected(row); setDraft(next); setBaseline(JSON.stringify(row || !template ? next : blankDraft())); setMessage(''); save.reset(); change.reset(); latest.reset()
    window.requestAnimationFrame(() => document.getElementById('check-name')?.focus())
  }
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(previous => ({ ...previous, [key]: value })); save.reset(); setMessage('') }
  const editOption = (id: string, patch: Partial<Option>) => edit('options', draft.options.map(option => option.id === id ? { ...option, ...patch } : option))
  const error = save.error || change.error || latest.error
  useEffect(() => { if (error) document.getElementById('check-save-error')?.scrollIntoView({ block: 'nearest' }) }, [error])
  const conflict = error instanceof Error && error.message.startsWith('409 ')
  const editorConflict = conflict && selected && (save.error || (change.error && change.variables?.row.id === selected.id))
  const when = draft.type === 'noul' ? `the answer is ${draft.expected ? 'Yes' : 'No'}` : draft.options.filter(option => option.flag).map(option => option.text || '(unnamed answer)').join(' or ') || 'you select an answer above'
  return <main className="writing-checks-page">
    <Link to="/library" className="checks-back">← Your stories</Link>
    <header className="page-heading"><div><p className="eyebrow">PRIVATE TO YOU</p><h1>Your writing checks</h1></div><button type="button" disabled={busy} onClick={() => openForm(null)}>+ New check</button></header>
    <p className="checks-intro">Ask a specific question about your writing, then choose when to show your advice. Your prose stays yours.</p>
    <p className="checks-release-note">Build and save checks now. Running custom checks in Live hints is coming next; enabled settings are saved for that update.</p>
    {message && <p role="status" className="checks-status">{message}</p>}
    {error && <div id="check-save-error" role="alert" className="checks-error"><p>{conflict ? 'This check changed elsewhere. Your unsaved draft is kept. Reopen the check or reload its saved version before editing again.' : errorText(error)}</p>{editorConflict && <button type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm('Replace this draft with the latest saved check?')) latest.mutate() }}>Load latest saved check</button>}</div>}
    <div className="checks-layout">
      <section className="checks-library" aria-label="Saved writing checks"><h2>Saved checks {checks.data && <span>({checks.data.total})</span>}</h2>
        {checks.isPending && <p role="status">Loading checks…</p>}
        {checks.error && <p role="alert">{errorText(checks.error)} <button type="button" onClick={() => { void checks.refetch() }}>Retry</button></p>}
        {checks.data?.total === 0 && <p className="checks-muted">No checks yet. Start with a template or write your own.</p>}
        <ul>{checks.data?.items.map(row => <li key={row.id} className={selected?.id === row.id ? 'is-selected' : ''}><button type="button" className="checks-name" disabled={busy} onClick={() => openForm(row)}>{row.definition.name}</button><p className="checks-muted">{answerNames[row.definition.question.type]} · {row.definition.input_scope ?? 'paragraph'}</p><div className="checks-row-actions"><label><input type="checkbox" checked={row.enabled} disabled={busy} onChange={() => { change.reset(); change.mutate({ row }) }} />Enabled</label><button type="button" disabled={busy} onClick={() => openForm(row)}>Edit</button><button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete “${row.definition.name}”?`)) { change.reset(); change.mutate({ row, remove: true }) } }}>Delete</button></div></li>)}</ul>
        {checks.data && (offset > 0 || checks.data.next_offset != null) && <div className="checks-row-actions"><button type="button" disabled={offset === 0 || checks.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span className="checks-muted">Page {offset / 50 + 1}</span><button type="button" disabled={checks.data.next_offset == null || checks.isFetching} onClick={() => setOffset(checks.data!.next_offset!)}>Next</button></div>}
      </section>
      <section className="checks-builder" aria-label="Check builder"><h2>{selected ? `Edit “${selected.definition.name}”` : 'Create a check'}</h2>
        <div className="checks-templates"><span>Start a new check:</span>{templates.map(template => <button type="button" disabled={busy} key={template.name} onClick={() => openForm(null, template)}>{template.name}</button>)}</div>
        <form onSubmit={event => { event.preventDefault(); save.mutate() }}><fieldset disabled={busy}>
          <label>Name<input id="check-name" required maxLength={200} value={draft.name} placeholder="e.g. Sentence coherence" onChange={event => edit('name', event.target.value)} /></label>
          <label>What should the reader check?<textarea required maxLength={8000} rows={3} value={draft.question} placeholder="Ask one specific question about the supplied passage." onChange={event => edit('question', event.target.value)} /></label>
          <div className="checks-fields"><label>Check each<select value={draft.scope} onChange={event => edit('scope', event.target.value as Draft['scope'])}><option value="sentence">Sentence</option><option value="paragraph">Paragraph</option><option value="scene">Scene</option></select></label><label>Answer format<select value={draft.type} onChange={event => { const type = event.target.value as AnswerType; setDraft(previous => ({ ...previous, type, options: defaultOptions(type) })); save.reset() }}>{Object.entries(answerNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          {draft.type === 'noul' ? <><label>Show advice when the answer is<select value={draft.expected ? 'yes' : 'no'} onChange={event => edit('expected', event.target.value === 'yes')}><option value="yes">Yes</option><option value="no">No</option></select></label><details className="checks-advanced"><summary>Describe Yes and No (optional)</summary><label>Yes means<textarea maxLength={2000} rows={2} value={draft.yes} onChange={event => edit('yes', event.target.value)} /></label><label>No means<textarea maxLength={2000} rows={2} value={draft.no} onChange={event => edit('no', event.target.value)} /></label></details></> : <div className="checks-options"><h3>{draft.type === 'choice' ? 'Answers' : 'Rating levels, lowest to highest'}</h3><p className="checks-muted">Describe each answer and tick the ones that should show advice.</p>{draft.options.map((option, index) => <div className="checks-option" key={option.id}><label>{draft.type === 'choice' ? 'Answer' : 'Level'} {index + 1}<textarea required maxLength={2000} rows={2} value={option.text} onChange={event => editOption(option.id, { text: event.target.value })} /></label><div className="checks-row-actions"><label><input type="checkbox" checked={option.flag} onChange={event => editOption(option.id, { flag: event.target.checked })} />Show advice</label><button type="button" disabled={draft.options.length <= (draft.type === 'score' ? 2 : 1)} onClick={() => edit('options', draft.options.filter(item => item.id !== option.id))}>Remove</button></div></div>)}<button type="button" disabled={draft.options.length >= (draft.type === 'score' ? 10 : 255)} onClick={() => edit('options', [...draft.options, { id: crypto.randomUUID(), text: '', flag: false }])}>+ Add {draft.type === 'score' ? 'level' : 'answer'}</button></div>}
          <label>Advice to show<textarea required maxLength={2000} rows={2} value={draft.advice} placeholder="Write a practical next step, not a grade for the writing." onChange={event => edit('advice', event.target.value)} /></label>
          <details className="checks-advanced"><summary>When to show advice</summary><label>Minimum certainty (%)<input type="number" required min={0} max={100} step="any" value={draft.certainty} onChange={event => edit('certainty', event.target.valueAsNumber)} /></label><p className="checks-muted">Higher values show fewer, stronger hints. Certainty is a signal, not proof.</p></details>
          <label className="checks-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => edit('enabled', event.target.checked)} />Enabled when custom checks go live</label>
          <aside className="checks-preview" aria-label="Hint preview"><p className="eyebrow">HINT PREVIEW</p><h3>{draft.name || 'Your check'}</h3><p>{draft.advice || 'Your saved advice will appear here.'}</p><p className="checks-muted">Shown when {when}, at {draft.certainty}% certainty or higher. Appearance preview only; no passage has been checked.</p></aside>
          <div className="checks-form-actions"><button type="submit" className="checks-primary" disabled={!dirty}>{save.isPending ? 'Saving…' : selected ? 'Save changes' : 'Create check'}</button><button type="button" onClick={() => openForm(selected)}>Reset form</button>{dirty && <span className="checks-muted">Unsaved changes</span>}</div>
        </fieldset></form>
      </section>
    </div>
  </main>
}
