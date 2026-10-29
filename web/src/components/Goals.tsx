import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type GoalSettings, type Goals, type StoryGoal, type StoryGoalEnvelope } from '../api/client'
import { errorText } from '../api/errors'
import { useWriterStatus } from './writerDraft'
import { getUiLanguage, t } from '../i18n'

const HINT_KEY = 'storytool-goal-hint'
const SPRINT_LENGTHS = [15, 25, 45]
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
const n = (value: number) => value.toLocaleString(getUiLanguage())
// Monday first, matching the server's writing_days bit order.
const weekdays = () => Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index)).toLocaleDateString(getUiLanguage(), { weekday: 'narrow', timeZone: 'UTC' }))

const useStoryTitle = (storyId: string) => useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) }).data?.title ?? ''

export function statusLabel(goal: Pick<StoryGoal, 'status' | 'behind_by'>) {
  if (goal.status === 'done') return t('Done')
  if (goal.status === 'behind') return t('Behind by {0}', n(goal.behind_by))
  if (goal.status === 'overdue') return t('Past deadline')
  if (goal.status === 'on_track') return t('On track')
  return t('In progress')
}

/** The account's goals; also moves the goal day to this browser's time zone once. */
export function useGoals(enabled = true) {
  const qc = useQueryClient()
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals, enabled, refetchOnWindowFocus: true })
  const synced = useRef(false)
  useEffect(() => {
    const zone = browserZone()
    if (!goals.data || synced.current || goals.data.settings.timezone === zone) return
    synced.current = true
    void api.saveGoals({ ...goals.data.settings, timezone: zone }).then(() => qc.invalidateQueries({ queryKey: ['goals'] })).catch(() => { /* Retried next visit. */ })
  }, [goals.data, qc])
  return goals
}

export function Ring({ value, max, label, size = 22 }: { value: number; max: number; label: string; size?: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  const radius = size / 2 - 2.5
  const length = 2 * Math.PI * radius
  return <svg className={`goal-ring${ratio >= 1 ? ' is-met' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
    <circle cx={size / 2} cy={size / 2} r={radius} className="goal-ring-track" />
    <circle cx={size / 2} cy={size / 2} r={radius} className="goal-ring-fill" strokeDasharray={length} strokeDashoffset={length * (1 - ratio)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
  </svg>
}

/** Write's status bar: today's habit ring, this story's pace ring, sprints. */
export function GoalBar({ storyId, focus, onFocus }: { storyId: string; focus: boolean; onFocus: (on: boolean) => void }) {
  const qc = useQueryClient()
  const storyTitle = useStoryTitle(storyId)
  const goals = useGoals()
  const story = useQuery({ queryKey: ['story-goal', storyId], queryFn: () => api.storyGoal(storyId) })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sprintMenu, setSprintMenu] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [hint, setHint] = useState(() => { try { return localStorage.getItem(HINT_KEY) !== 'dismissed' } catch { return false } })
  // Refresh counts once each save lands.
  const status = useWriterStatus(storyId)
  useEffect(() => {
    if (status !== 'saved') return
    const timer = window.setTimeout(() => { void qc.invalidateQueries({ queryKey: ['goals'] }); void qc.invalidateQueries({ queryKey: ['story-goal', storyId] }) }, 400)
    return () => window.clearTimeout(timer)
  }, [status, qc, storyId])
  const sprint = goals.data?.active_sprint
  const endsAt = sprint ? Date.parse(sprint.started_at) + sprint.minutes * 60_000 : 0
  useEffect(() => {
    if (!sprint) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [sprint])
  const finish = useMutation({
    mutationFn: (id: string) => api.endSprint(id),
    onSuccess: ended => {
      void qc.invalidateQueries({ queryKey: ['goals'] }).then(() => {
        const fresh = qc.getQueryData<Goals>(['goals'])
        const met = fresh?.settings.daily_words && fresh.today_words >= fresh.settings.daily_words
        setSummary([t('{0} words in {1} min', n(ended.words), Math.max(1, Math.round((Date.parse(ended.ended_at ?? '') - Date.parse(ended.started_at)) / 60_000))), met ? t("Today's goal met ✓") : null].filter(Boolean).join(' · '))
        window.setTimeout(() => setSummary(null), 8000)
      })
    },
  })
  const start = useMutation({
    mutationFn: (minutes: number) => api.startSprint({ story_id: storyId, minutes, target_words: null }),
    onSuccess: () => { setSprintMenu(false); setNow(Date.now()); void qc.invalidateQueries({ queryKey: ['goals'] }) },
  })
  // End each sprint once, whether its time ran out or the writer ended it.
  const endedSprint = useRef<string | null>(null)
  const endSprint = (id: string) => { if (endedSprint.current === id) return; endedSprint.current = id; finish.mutate(id) }
  useEffect(() => { if (sprint && now >= endsAt) endSprint(sprint.id) })

  const habit = goals.data
  const daily = habit?.settings.daily_words ?? null
  const goal = story.data?.goal
  const needed = goal?.needed_today ?? null
  const left = Math.max(0, Math.round((endsAt - now) / 1000))
  const dismissHint = () => { setHint(false); try { localStorage.setItem(HINT_KEY, 'dismissed') } catch { /* Optional browser storage. */ } }

  if (sprint) return <div className="goal-bar is-sprint" role="timer" aria-label={t('Sprint')}>
    <span>◷ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
    <span>{t('+{0} words', n(sprint.words))}</span>
    <button type="button" onClick={() => endSprint(sprint.id)} disabled={finish.isPending}>{t('End sprint')}</button>
    <button type="button" onClick={() => onFocus(!focus)} aria-pressed={focus}>{t('Focus')}</button>
  </div>

  return <div className="goal-bar">
    {summary && <p className="goal-summary" role="status">{summary}</p>}
    {(daily || goal) ? <button type="button" className="goal-rings" aria-expanded={open} onClick={() => setOpen(!open)}>
      {daily && habit && <><Ring value={habit.today_words} max={daily} label={t('{0} of {1} words today', habit.today_words, daily)} /><span>{n(habit.today_words)} / {n(daily)}</span></>}
      {goal && <><Ring value={goal.status === 'done' ? 1 : goal.today_words} max={goal.status === 'done' ? 1 : (needed ?? goal.target_words)} label={t('{0}: {1}% of goal', storyTitle, goal.percent)} size={18} /><span>{needed ? `${n(goal.today_words)} / ${n(needed)}` : `${goal.percent}%`}</span></>}
    </button> : habit && !habit.has_goal && habit.today_words >= 100 && hint ? <span className="goal-hint">
      <button type="button" onClick={() => setEditing(true)}>{t('Want a daily goal? Set one')}</button>
      <button type="button" aria-label={t('Dismiss')} onClick={dismissHint}>×</button>
    </span> : <button type="button" className="goal-set" onClick={() => setEditing(true)}>{t('Set a goal')}</button>}
    <span className="goal-bar-actions">
      <span className="goal-sprint">
        <button type="button" aria-expanded={sprintMenu} onClick={() => setSprintMenu(!sprintMenu)}>▶ {t('Sprint')}</button>
        {sprintMenu && <span className="goal-pop goal-sprint-menu" role="menu">{SPRINT_LENGTHS.map(minutes => <button key={minutes} type="button" role="menuitem" disabled={start.isPending} onClick={() => start.mutate(minutes)}>{t('{0} min', minutes)}</button>)}</span>}
      </span>
      <button type="button" onClick={() => onFocus(!focus)} aria-pressed={focus}>{t('Focus')}</button>
    </span>
    {open && <div className="goal-pop goal-popover" role="dialog" aria-label={t('Goals')}>
      {habit && <p><strong>{t('Today')}</strong><span>{daily ? `${n(habit.today_words)} / ${n(daily)}` : n(habit.today_words)}</span>{habit.streak > 0 && <span className="goal-streak">🔥 {t('{0}-day streak', habit.streak)}</span>}</p>}
      {goal && <StoryGoalLines title={storyTitle} goal={goal} />}
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { setOpen(false); setEditing(true) }}>{t('Edit goals')}</button>
    </div>}
    {start.isError && <p role="alert" className="writer-error">{errorText(start.error)}</p>}
    {editing && <GoalsDialog storyId={storyId} storyTitle={storyTitle} onClose={() => setEditing(false)} />}
  </div>
}

function StoryGoalLines({ title, goal }: { title: string; goal: StoryGoal }) {
  return <p><strong>{title}</strong><span>{t('{0} / {1} words', n(goal.words_now), n(goal.target_words))}{goal.deadline && ` · ${t('due {0}', new Date(goal.deadline + 'T00:00').toLocaleDateString(getUiLanguage(), { day: 'numeric', month: 'short' }))}`}</span>
    <span className={`goal-status is-${goal.status}`}>{goal.needed_today ? `${t('{0} today', n(goal.needed_today))} · ` : ''}{statusLabel(goal)}</span></p>
}

/** Context tab card for this story's goal. */
export function StoryGoalCard({ storyId }: { storyId: string }) {
  const storyTitle = useStoryTitle(storyId)
  const story = useQuery({ queryKey: ['story-goal', storyId], queryFn: () => api.storyGoal(storyId) })
  const [editing, setEditing] = useState(false)
  const goal = story.data?.goal
  return <div className="ws-card goal-card">
    <h4>{t('Goal')}</h4>
    {goal ? <>
      <p>{t('{0} / {1} words', n(goal.words_now), n(goal.target_words))}</p>
      <div className="ws-track goal-track" aria-hidden="true"><i className="on" style={{ flex: `0 0 ${goal.percent}%` }} /></div>
      <p className="ws-card-note">{[goal.deadline && t('Due {0}', new Date(goal.deadline + 'T00:00').toLocaleDateString(getUiLanguage(), { day: 'numeric', month: 'short', year: 'numeric' })), goal.needed_today && t('{0} a day', n(goal.needed_today)), statusLabel(goal)].filter(Boolean).join(' · ')}</p>
      <button type="button" className="goal-link" onClick={() => setEditing(true)}>{t('Edit goal')}</button>
    </> : <p className="ws-card-note">{t('No goal.')} <button type="button" className="goal-link" onClick={() => setEditing(true)}>{t('Add a target or deadline')}</button></p>}
    {editing && <GoalsDialog storyId={storyId} storyTitle={storyTitle} onClose={() => setEditing(false)} />}
  </div>
}

/** The daily habit form, shared by Settings and the goals dialog. */
export function HabitGoalForm({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient()
  const goals = useGoals()
  const settings = goals.data?.settings
  const [form, setForm] = useState<GoalSettings | null>(null)
  const value = form ?? settings
  const save = useMutation({
    mutationFn: (body: GoalSettings) => api.saveGoals(body),
    onSuccess: () => { setForm(null); void qc.invalidateQueries({ queryKey: ['goals'] }); void qc.invalidateQueries({ queryKey: ['story-goal'] }); onSaved?.() },
  })
  if (!value) return <p className="writer-help">{t('Loading…')}</p>
  const set = (patch: Partial<GoalSettings>) => setForm({ ...value, ...patch })
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate({ ...value, timezone: browserZone() }) }
  return <form className="goal-form" onSubmit={submit}>
    <label>{t('Words per writing day')}<input type="number" min={1} max={100000} placeholder={t('No daily goal')} value={value.daily_words ?? ''} onChange={event => set({ daily_words: event.target.value ? Math.max(1, Number(event.target.value)) : null })} /></label>
    <fieldset><legend>{t('Writing days')}</legend><div className="goal-days">{weekdays().map((label, index) => <button key={index} type="button" aria-pressed={Boolean(value.writing_days >> index & 1)} onClick={() => { const next = value.writing_days ^ (1 << index); if (next) set({ writing_days: next }) }}>{label}</button>)}</div></fieldset>
    <label className="goal-check"><input type="checkbox" checked={value.forgive_missed} onChange={event => set({ forgive_missed: event.target.checked })} />{t('Forgive one missed writing day a week')}</label>
    <label className="goal-check"><input type="checkbox" checked={value.count_ai} onChange={event => set({ count_ai: event.target.checked })} />{t('Count words from AI changes I accept')}</label>
    <p className="writer-help">{t('Rest days never break a streak. Deleting text never lowers today’s count, and one paste counts at most 1,000 words.')}</p>
    {save.isError && <p role="alert" className="writer-error">{errorText(save.error)}</p>}
    <div className="goal-form-actions"><button type="submit" className="ui-btn ui-btn-primary" disabled={save.isPending}>{t('Save daily goal')}</button>{settings?.daily_words && <button type="button" className="ui-btn ui-btn-ghost" disabled={save.isPending} onClick={() => save.mutate({ ...value, daily_words: null, timezone: browserZone() })}>{t('Remove daily goal')}</button>}</div>
  </form>
}

/** This story's target, optional deadline and optional fixed daily pace. */
export function StoryGoalForm({ storyId, onSaved }: { storyId: string; onSaved?: () => void }) {
  const qc = useQueryClient()
  const story = useQuery({ queryKey: ['story-goal', storyId], queryFn: () => api.storyGoal(storyId) })
  const goal = story.data?.goal
  const [target, setTarget] = useState<string | null>(null)
  const [deadline, setDeadline] = useState<string | null>(null)
  const [daily, setDaily] = useState<string | null>(null)
  const refresh = (data?: StoryGoalEnvelope) => {
    if (data) qc.setQueryData(['story-goal', storyId], data)
    void qc.invalidateQueries({ queryKey: ['library-overview'] })
    void qc.invalidateQueries({ queryKey: ['goal-stories'] })
    onSaved?.()
  }
  const save = useMutation({
    mutationFn: () => api.saveStoryGoal(storyId, {
      target_words: Number(target ?? goal?.target_words ?? 0),
      deadline: (deadline ?? goal?.deadline ?? '') || null,
      daily_words: (daily ?? String(goal?.daily_words ?? '')) ? Number(daily ?? goal?.daily_words) : null,
    }),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: () => api.deleteStoryGoal(storyId), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['story-goal', storyId] }); refresh() } })
  const targetValue = target ?? (goal ? String(goal.target_words) : '')
  return <form className="goal-form" onSubmit={event => { event.preventDefault(); if (Number(targetValue) > 0) save.mutate() }}>
    <label>{t('Target length (words)')}<input type="number" min={1} required placeholder="80000" value={targetValue} onChange={event => setTarget(event.target.value)} /></label>
    <label>{t('Deadline (optional)')}<input type="date" value={deadline ?? goal?.deadline ?? ''} onChange={event => setDeadline(event.target.value)} /></label>
    <label>{t('Fixed words a day (optional)')}<input type="number" min={1} placeholder={t('Worked out from the deadline')} value={daily ?? (goal?.daily_words ? String(goal.daily_words) : '')} onChange={event => setDaily(event.target.value)} /></label>
    <p className="writer-help">{t('With a deadline, the daily pace is what is left divided by your writing days remaining, so it updates every day.')}</p>
    {(save.isError || remove.isError) && <p role="alert" className="writer-error">{errorText(save.error ?? remove.error)}</p>}
    <div className="goal-form-actions"><button type="submit" className="ui-btn ui-btn-primary" disabled={save.isPending || !(Number(targetValue) > 0)}>{t('Save story goal')}</button>{goal && <button type="button" className="ui-btn ui-btn-ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>{t('Remove story goal')}</button>}</div>
  </form>
}

export function GoalsDialog({ storyId, storyTitle, onClose }: { storyId?: string; storyTitle?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="goal-dialog" aria-labelledby="goal-dialog-title" onClose={onClose} onCancel={onClose}>
    <div className="goal-dialog-head"><h2 id="goal-dialog-title">{t('Writing goals')}</h2><Link to="/goals" className="goal-link" onClick={() => dialog.current?.close()}>{t('All goals →')}</Link><button type="button" aria-label={t('Close')} onClick={() => dialog.current?.close()}>×</button></div>
    <section><h3>{t('Daily habit · all stories')}</h3><HabitGoalForm /></section>
    {storyId && <section><h3>{storyTitle ? t('This story · {0}', storyTitle) : t('This story')}</h3><StoryGoalForm storyId={storyId} /></section>}
  </dialog>
}
