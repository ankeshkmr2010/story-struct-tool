import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type ValidatorDefinition, type WritingValidator } from '../api/client'
import { errorText } from '../api/errors'
import { ConfirmInline } from '../ui/primitives'

type AnswerType = ValidatorDefinition['question']['type']
type Option = { id: string; text: string; flag: boolean }
type Goal = 'problem' | 'count' | 'comparison'
const countMeanings = { present: 'Physically present; a mere mention does not count.', speaking_or_acting: 'Speaks or performs an action; silent presence alone does not count.', driving_action: 'Makes a decision, creates conflict or changes what happens; merely arriving or watching does not count.' }
type Example = { id: string; text: string; should_trigger: boolean }
type Draft = { goal: Goal; countWhen: keyof typeof countMeanings; countCriteria: string; limit: number; extraNames: string; first: string; second: string; relationship: string; highlight: NonNullable<ValidatorDefinition['highlight']>; examples: Example[]; name: string; question: string; scope: NonNullable<ValidatorDefinition['input_scope']>; type: AnswerType; expected: boolean; options: Option[]; yes: string; no: string; certainty: number; advice: string; enabled: boolean }
const answerNames: Record<AnswerType, string> = { noul: 'Yes / no', choice: 'Choose an answer', score: 'Rating' }
const defaultOptions = (type: AnswerType): Option[] => type === 'score'
  ? ['No issue', 'Minor concern', 'Worth reviewing', 'Clear issue'].map((text, index) => ({ id: `level_${index}`, text, flag: index >= 2 }))
  : [{ id: 'fits', text: 'Fits the passage', flag: false }, { id: 'unrelated', text: 'Introduces an unrelated topic', flag: true }]
const blankDraft = (): Draft => ({ goal: 'problem', countWhen: 'present', countCriteria: countMeanings.present, limit: 3, extraNames: '', first: '', second: '', relationship: '', highlight: 'sentence', examples: [], name: '', question: '', scope: 'paragraph', type: 'noul', expected: true, options: defaultOptions('noul'), yes: '', no: '', certainty: 80, advice: '', enabled: false })
const templates: Partial<Draft>[] = [
  { name: 'Character limit', goal: 'count', scope: 'paragraph', advice: 'Consider splitting the action or introducing characters gradually.' },
  { name: 'Sentence coherence', scope: 'sentence' as const, question: "Does a sentence introduce an unrelated topic that interrupts its surrounding paragraph? Use the scene as context; allow connected memories, metaphors and intentional digressions.", advice: "Connect this thought to the character's immediate concern, move it to a relevant passage, or remove it if accidental." },
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
  const recipe = d.recipe
  return { goal: recipe?.type ?? 'problem', countWhen: recipe?.type === 'count' ? recipe.count_when ?? 'present' : 'present', countCriteria: recipe?.type === 'count' ? recipe.criteria : countMeanings.present, limit: recipe?.type === 'count' ? recipe.limit : 3, extraNames: recipe?.type === 'count' ? (recipe.additional_names ?? []).join(', ') : '', first: recipe?.type === 'comparison' ? recipe.first : '', second: recipe?.type === 'comparison' ? recipe.second : '', relationship: recipe?.type === 'comparison' ? recipe.relationship : '', highlight: d.highlight ?? 'sentence', examples: (d.examples ?? []).map((example, index) => ({ ...example, id: `example_${index}` })), name: d.name, question: d.question.instructions, scope: d.input_scope ?? 'paragraph', type: d.question.type, expected: 'expected' in d.trigger ? d.trigger.expected ?? true : true, options, yes: yesNo.true ?? '', no: yesNo.false ?? '', certainty: (d.minimum_probability ?? 0.8) * 100, advice: d.advice, enabled: row.enabled }
}

function toDefinition(d: Draft, preview = false): ValidatorDefinition {
  let instructions = d.question.trim()
  if (d.goal === 'count') instructions = `Are there more than ${d.limit} named characters meeting this criterion? ${d.countCriteria}`
  if (d.goal === 'comparison') instructions = `Compare ${d.first} with ${d.second}. Does this mismatch occur: ${d.relationship}?`
  const type = d.goal === 'problem' ? d.type : 'noul'
  if (d.goal === 'count' && (!d.countCriteria.trim() || !Number.isInteger(d.limit) || d.limit < 1 || d.limit > 50)) throw new Error('Set a counting criterion and a limit from 1 to 50.')
  if (d.goal === 'comparison' && (!d.first.trim() || !d.second.trim() || !d.relationship.trim())) throw new Error('Describe both things and the mismatch to look for.')
  if (!preview && d.examples.some(example => !example.text.trim())) throw new Error('Fill in each example or remove the empty one.')
  const name = d.name.trim() || (preview ? 'Your check' : '')
  const advice = d.advice.trim() || (preview ? 'Review the highlighted passage.' : '')
  const criteria = d.goal !== 'problem' ? {} : type === 'choice' ? Object.fromEntries(d.options.map(option => [option.id, option.text.trim()])) : type === 'score' ? d.options.map(option => option.text.trim()) : Object.fromEntries([['true', d.yes.trim()], ['false', d.no.trim()]].filter(([, text]) => text))
  const question = { type, instructions, criteria: type === 'noul' && !Object.keys(criteria).length ? null : criteria }
  if (!Number.isFinite(d.certainty) || d.certainty < 0 || d.certainty > 100) throw new Error('Choose a certainty between 0 and 100%.')
  if (!name || !question.instructions || !advice) throw new Error('Add a name, question and advice before saving.')
  if (type !== 'noul' && d.options.some(option => !option.text.trim())) throw new Error('Describe every answer or rating level.')
  if (type !== 'noul' && !d.options.some(option => option.flag)) throw new Error('Choose at least one answer or rating level that should show advice.')
  if (new TextEncoder().encode(JSON.stringify(question)).length > 24000) throw new Error('Shorten the question or answer descriptions before saving.')
  const trigger: ValidatorDefinition['trigger'] = type === 'noul' ? { type: 'noul', expected: d.goal === 'problem' ? d.expected : true } : type === 'choice' ? { type: 'choice', matches: d.options.filter(option => option.flag).map(option => option.id) } : { type: 'score', levels: d.options.flatMap((option, index) => option.flag ? [index] : []) }
  const recipe: ValidatorDefinition['recipe'] = d.goal === 'count' ? { type: 'count', entity: 'characters', count_when: d.countWhen, criteria: d.countCriteria.trim(), limit: d.limit, additional_names: [...new Set(d.extraNames.split(/[,\n]/).map(name => name.trim()).filter(Boolean))] } : d.goal === 'comparison' ? { type: 'comparison', first: d.first.trim(), second: d.second.trim(), relationship: d.relationship.trim() } : { type: 'problem' }
  return { schema_version: 2, name, input_scope: d.scope, question, trigger, recipe, highlight: d.highlight, examples: d.examples.filter(example => example.text.trim()).map(({ text, should_trigger }) => ({ text: text.trim(), should_trigger })), minimum_probability: d.certainty / 100, advice }
}

export default function WritingChecks() {
  const qc = useQueryClient()
  const [offset, setOffset] = useState(0)
  const checks = useQuery({ queryKey: ['validators', offset], queryFn: () => api.listValidators(offset) })
  const [selected, setSelected] = useState<WritingValidator | null>(null)
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [baseline, setBaseline] = useState(() => JSON.stringify(blankDraft()))
  const [message, setMessage] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [sample, setSample] = useState('')
  const [sampleExpected, setSampleExpected] = useState<boolean | null>(null)
  const preview = useMutation({ mutationFn: () => api.previewValidator({ definition: toDefinition(draft, true), content: sample }) })
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
  const busy = save.isPending || change.isPending || latest.isPending || preview.isPending
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
  const openForm = (row: WritingValidator | null, template?: typeof templates[number], discard = false) => {
    if (busy || (dirty && !discard && !window.confirm('Discard unsaved changes to this check?'))) return
    setConfirmReset(false)
    const next = row ? toDraft(row) : { ...blankDraft(), ...template }
    setSelected(row); setDraft(next); setBaseline(JSON.stringify(row || !template ? next : blankDraft())); setMessage(''); save.reset(); change.reset(); latest.reset(); preview.reset()
    window.requestAnimationFrame(() => document.getElementById('check-name')?.focus())
  }
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(previous => ({ ...previous, [key]: value })); save.reset(); preview.reset(); setMessage('') }
  const editOption = (id: string, patch: Partial<Option>) => edit('options', draft.options.map(option => option.id === id ? { ...option, ...patch } : option))
  const error = save.error || change.error || latest.error || preview.error
  useEffect(() => { if (error) document.getElementById('check-save-error')?.scrollIntoView({ block: 'nearest' }) }, [error])
  const conflict = error instanceof Error && error.message.startsWith('409 ')
  const editorConflict = conflict && selected && (save.error || (change.error && change.variables?.row.id === selected.id))
  const adviceLooksLikeExample = /sample paragraph|example\s*:|^["“].{100,}/is.test(draft.advice)
  const when = draft.goal === 'count' ? `more than ${draft.limit} named characters meet your criterion` : draft.goal === 'comparison' ? 'the described mismatch appears' : draft.type === 'noul' ? `the answer is ${draft.expected ? 'Yes' : 'No'}` : draft.options.filter(option => option.flag).map(option => option.text || '(unnamed answer)').join(' or ') || 'you select an answer above'
  return <main className="writing-checks-page">
    <Link to="/library" className="checks-back">← Your stories</Link>
    <header className="page-heading"><div><p className="eyebrow">PRIVATE TO YOU</p><h1>Your writing checks</h1></div><button type="button" disabled={busy} onClick={() => openForm(null)}>+ New check</button></header>
    <p className="checks-intro">Choose what to check, define what counts, and try it on a sample before enabling it. Your prose stays yours.</p>
    <p className="checks-release-note">Enabled checks now run when you turn on Live hints in a saved story. Up to 20 personal checks are included per reading; your prose is never changed.</p>
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
        <div className="checks-templates"><span>Templates:</span>{templates.map(template => <button type="button" disabled={busy} key={template.name} onClick={() => openForm(null, template)}>{template.name}</button>)}</div>
        <form onSubmit={event => { event.preventDefault(); save.mutate() }}><fieldset disabled={busy}>
          <label>Name<input id="check-name" required maxLength={200} value={draft.name} placeholder="e.g. Sentence coherence" onChange={event => edit('name', event.target.value)} /></label>
          <label>What do you want to check?<select value={draft.goal} onChange={event => { const goal = event.target.value as Goal; setDraft(previous => ({ ...previous, goal, type: goal === 'problem' ? previous.type : 'noul', expected: true })); save.reset(); preview.reset() }}><option value="problem">Look for a problem</option><option value="count">Count named characters</option><option value="comparison">Compare two things</option></select></label>
          {draft.goal === 'count' ? <div className="checks-recipe">
            <label>Which characters count?<select value={draft.countWhen} onChange={event => { const countWhen = event.target.value as Draft['countWhen']; setDraft(previous => ({ ...previous, countWhen, countCriteria: countMeanings[countWhen] })); preview.reset() }}><option value="present">Present in the passage</option><option value="speaking_or_acting">Speaking or acting</option><option value="driving_action">Moving the action forward</option></select></label>
            <p className="checks-muted">{countMeanings[draft.countWhen]} Arriving and changing the plot are different; choose the distinction you intend.</p>
            <label>Make the counting criterion your own<textarea required rows={2} maxLength={2000} value={draft.countCriteria} onChange={event => edit('countCriteria', event.target.value)} /></label>
            <label>Show advice when there are more than<input type="number" required min={1} max={50} value={draft.limit} onChange={event => edit('limit', event.target.valueAsNumber)} /></label>
            <details className="checks-advanced"><summary>Extra names or spellings (optional)</summary><label>Names, separated by commas<textarea maxLength={10000} rows={2} value={draft.extraNames} onChange={event => edit('extraNames', event.target.value)} placeholder="Tom, Sella, timmy" /></label><p className="checks-muted">Cast aliases are grouped in saved stories. Other candidate names are checked in the prose; uncertain identities remain visible in the trial.</p></details>
          </div> : draft.goal === 'comparison' ? <div className="checks-recipe"><label>First thing to compare<input required maxLength={1000} value={draft.first} onChange={event => edit('first', event.target.value)} placeholder="The character's stated intention" /></label><label>Second thing to compare<input required maxLength={1000} value={draft.second} onChange={event => edit('second', event.target.value)} placeholder="Their actions in the passage" /></label><label>What mismatch should cause advice?<textarea required maxLength={2000} rows={2} value={draft.relationship} onChange={event => edit('relationship', event.target.value)} placeholder="Their action contradicts the intention without a clear reason." /></label><p className="checks-muted">Both things must be supported by the supplied prose; this check does not pull in private planning notes.</p></div> : <label>What problem should we look for?<textarea required maxLength={8000} rows={3} value={draft.question} placeholder="e.g. A sentence introduces a topic unrelated to the paragraph." onChange={event => edit('question', event.target.value)} /></label>}
          <div className="checks-fields"><label>Check each<select value={draft.scope} onChange={event => edit('scope', event.target.value as Draft['scope'])}><option value="sentence">Sentence</option><option value="paragraph">Paragraph</option><option value="scene">Scene</option></select></label><label>What should the hint highlight?<select value={draft.highlight} onChange={event => edit('highlight', event.target.value as Draft['highlight'])}><option value="sentence">Contributing sentences (default)</option><option value="paragraph">Paragraph</option><option value="scene">Whole scene</option></select></label></div><p className="checks-muted">Checking a paragraph can highlight several sentences together. A sentence can contribute to a group without breaking the rule by itself.</p>
          {draft.goal === 'problem' && <details className="checks-advanced"><summary>Advanced answer settings</summary><div className="checks-fields"><label>Answer format<select value={draft.type} onChange={event => { const type = event.target.value as AnswerType; setDraft(previous => ({ ...previous, type, options: defaultOptions(type) })); save.reset() }}>{Object.entries(answerNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          {draft.type === 'noul' ? <><label>Show advice when the answer is<select value={draft.expected ? 'yes' : 'no'} onChange={event => edit('expected', event.target.value === 'yes')}><option value="yes">Yes</option><option value="no">No</option></select></label><details className="checks-advanced"><summary>Describe Yes and No (optional)</summary><label>Yes means<textarea maxLength={2000} rows={2} value={draft.yes} onChange={event => edit('yes', event.target.value)} /></label><label>No means<textarea maxLength={2000} rows={2} value={draft.no} onChange={event => edit('no', event.target.value)} /></label></details></> : <div className="checks-options"><h3>{draft.type === 'choice' ? 'Answers' : 'Rating levels, lowest to highest'}</h3><p className="checks-muted">Describe each answer and tick the ones that should show advice.</p>{draft.options.map((option, index) => <div className="checks-option" key={option.id}><label>{draft.type === 'choice' ? 'Answer' : 'Level'} {index + 1}<textarea required maxLength={2000} rows={2} value={option.text} onChange={event => editOption(option.id, { text: event.target.value })} /></label><div className="checks-row-actions"><label><input type="checkbox" checked={option.flag} onChange={event => editOption(option.id, { flag: event.target.checked })} />Show advice</label><button type="button" disabled={draft.options.length <= (draft.type === 'score' ? 2 : 1)} onClick={() => edit('options', draft.options.filter(item => item.id !== option.id))}>Remove</button></div></div>)}<button type="button" disabled={draft.options.length >= (draft.type === 'score' ? 10 : 255)} onClick={() => edit('options', [...draft.options, { id: crypto.randomUUID(), text: '', flag: false }])}>+ Add {draft.type === 'score' ? 'level' : 'answer'}</button></div>}</details>}
          <details className="checks-examples"><summary>Examples that teach the distinction ({draft.examples.length})</summary><p className="checks-muted">Examples describe when the rule should or should not trigger. Advice is a practical next step for the writer.</p>{draft.examples.map(example => <div key={example.id} className="checks-option"><label>Sample passage<textarea rows={3} maxLength={4000} value={example.text} onChange={event => edit('examples', draft.examples.map(item => item.id === example.id ? { ...item, text: event.target.value } : item))} /></label><label>Should it show advice?<select value={example.should_trigger ? 'yes' : 'no'} onChange={event => edit('examples', draft.examples.map(item => item.id === example.id ? { ...item, should_trigger: event.target.value === 'yes' } : item))}><option value="yes">Yes</option><option value="no">No</option></select></label><div className="checks-row-actions"><button type="button" onClick={() => { setSample(example.text); setSampleExpected(example.should_trigger); preview.reset() }}>Use in trial</button><button type="button" onClick={() => edit('examples', draft.examples.filter(item => item.id !== example.id))}>Remove</button></div></div>)}<button type="button" disabled={draft.examples.length >= 12} onClick={() => edit('examples', [...draft.examples, { id: crypto.randomUUID(), text: '', should_trigger: true }])}>+ Add example</button></details>
          <label>Advice to show<textarea required maxLength={2000} rows={2} value={draft.advice} placeholder="Write a practical next step, not a grade for the writing." onChange={event => edit('advice', event.target.value)} /></label>
          {adviceLooksLikeExample && <p className="checks-release-note">This looks like an example rather than advice. <button type="button" disabled={draft.examples.length >= 12 || draft.advice.length > 4000} onClick={() => setDraft(previous => ({ ...previous, examples: [...previous.examples, { id: crypto.randomUUID(), text: previous.advice, should_trigger: true }], advice: '' }))}>Move it to Examples</button></p>}
          <details className="checks-advanced"><summary>When to show advice</summary><label>Minimum certainty (%)<input type="number" required min={0} max={100} step="any" value={draft.certainty} onChange={event => edit('certainty', event.target.valueAsNumber)} /></label><p className="checks-muted">Higher values show fewer, stronger hints. Your threshold also respects StoryTool's minimum certainty setting; certainty is a signal, not proof.</p></details>
          <label className="checks-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => edit('enabled', event.target.checked)} />Enabled in Live hints</label>
          <section className="checks-trial"><h3>Try on a passage</h3><p className="checks-muted">This sends your sample, rule and examples to the shared reader and uses your normal reading allowance. It does not save the rule or edit prose.</p><label>Sample passage<textarea rows={4} maxLength={30000} value={sample} onChange={event => { setSample(event.target.value); preview.reset() }} /></label><label>Your expectation<select value={sampleExpected == null ? '' : sampleExpected ? 'yes' : 'no'} onChange={event => setSampleExpected(event.target.value === '' ? null : event.target.value === 'yes')}><option value="">Not sure yet</option><option value="yes">Should show advice</option><option value="no">Should not show advice</option></select></label><button type="button" disabled={!sample.trim() || busy} onClick={() => preview.mutate()}>{preview.isPending ? 'Reading sample…' : 'Try this rule'}</button>
          {preview.data && <div role="status" className="checks-trial-results">{preview.data.warnings.map((warning, index) => <p key={index}>{warning}</p>)}{sampleExpected != null && <p>{(!preview.data.observations.length || preview.data.warnings.length > 0 || preview.data.observations.some(item => item.matched == null)) ? 'Some results are uncertain; inspect the reading below.' : (preview.data.hints.length > 0) === sampleExpected ? 'The reading matches your expectation.' : 'The reading differs from your expectation. Refine the criterion or examples before enabling.'}</p>}{preview.data.observations.map((observation, index) => <article key={index}><strong>Paragraph {observation.paragraph}: {observation.matched == null ? 'Uncertain' : observation.matched ? 'Would show advice' : 'No advice triggered'}</strong>{observation.count != null && <p>{observation.complete ? '' : 'At least '}{observation.count} named characters; limit {observation.limit}.</p>}{!!observation.names.length && <p>Counted: {observation.names.join(', ')}</p>}{!!observation.excluded.length && <p>Not counted: {observation.excluded.join(', ')}</p>}{!!observation.uncertain.length && <p>Uncertain: {observation.uncertain.join(', ')}</p>}</article>)}{preview.data.hints.map(hint => <article key={hint.code}><strong>{hint.message}</strong>{hint.location_uncertain && <p>Sentence location uncertain; paragraph shown instead.</p>}{hint.passages?.map((passage, index) => <blockquote key={index} className="live-hint-excerpt">{passage.text}</blockquote>)}<p>{hint.action}</p></article>)}</div>}</section>
          <aside className="checks-preview" aria-label="Hint preview"><p className="eyebrow">HINT PREVIEW</p><h3>{draft.name || 'Your check'}</h3><p>{draft.advice || 'Your saved advice will appear here.'}</p><p className="checks-muted">Shown when {when}, at {draft.certainty}% certainty or higher. Appearance preview only; no passage has been checked.</p></aside>
          <div className="checks-form-actions"><button type="submit" className="checks-primary" disabled={!dirty}>{save.isPending ? 'Saving…' : selected ? 'Save changes' : 'Create check'}</button>{confirmReset && dirty
            ? <ConfirmInline message="Discard unsaved changes?" confirmLabel="Discard" cancelLabel="Keep editing" danger onConfirm={() => openForm(selected, undefined, true)} onCancel={() => setConfirmReset(false)} />
            : <><button type="button" onClick={() => dirty ? setConfirmReset(true) : openForm(selected)}>Reset form</button>{dirty && <span className="checks-muted">Unsaved changes</span>}</>}</div>
        </fieldset></form>
      </section>
    </div>
  </main>
}
