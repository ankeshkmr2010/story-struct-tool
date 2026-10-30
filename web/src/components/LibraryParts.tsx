import { Link } from 'react-router-dom'
import { useState } from 'react'
import type { Goals, LibraryCardState } from '../api/client'
import { GoalsDialog, statusLabel } from './Goals'
import { getUiLanguage, t } from '../i18n'

// Six cover tints; a story keeps its tint because it comes from the story id.
export function coverTint(id: string) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `lib-cover--${hash % 6}`
}

export function StatusChip({ status }: { status: LibraryCardState['status'] }) {
  const label = status === 'revision' ? t('Revision') : status === 'draft' ? t('Draft') : t('Planning')
  return <span className={`lib-chip lib-chip--${status}`} title={t('Planning until prose exists; Revision once half the scenes are revised.')}>{label}</span>
}

/** The story you were last in, with its progress and what is waiting in it. */
export function ContinueCard({ storyId, title, mode, edited, card, feedback }: {
  storyId: string; title: string; mode: string; edited: string; card?: LibraryCardState; feedback: number
}) {
  const total = card?.scene_count ?? 0
  const done = card?.drafted_scene_count ?? 0
  return <article className="lib-continue">
    <div className={`lib-cover ${card?.cover_url ? 'has-image' : coverTint(storyId)}`} aria-hidden="true">{card?.cover_url ? <img className="lib-cover-img" src={card.cover_url} alt="" style={{ objectPosition: `${card.cover_focus_x * 100}% ${card.cover_focus_y * 100}%` }} /> : <span className="lib-cover-title">{title}</span>}</div>
    <div className="lib-continue-body">
      <div className="lib-continue-top"><span className="eyebrow">{t('Continue writing')}</span><span>{edited}</span></div>
      <div><h2>{title}</h2><p>{mode}</p></div>
      {card?.goal_percent != null ? <div className="lib-progress">
        <div><span>{t('{0}% of goal', card.goal_percent)} · {statusLabel({ status: card.goal_status ?? 'open', behind_by: 0 })}</span></div>
        <div className="lib-bar" role="img" aria-label={t('{0}% of goal', card.goal_percent)}><i style={{ width: `${card.goal_percent}%` }} /></div>
      </div> : total > 0 && <div className="lib-progress">
        <div><span>{t('{0} of {1} scenes', done, total)}</span></div>
        <div className="lib-bar" role="img" aria-label={t('{0} of {1} scenes', done, total)}><i style={{ width: `${Math.round(done / total * 100)}%` }} /></div>
      </div>}
      <div className="lib-continue-foot">
        {(card?.tk_count ?? 0) > 0 && <span className="lib-chip lib-chip--amber">{t(card!.tk_count === 1 ? '{0} TK' : '{0} TKs', card!.tk_count)}</span>}
        {(card?.pending_agent_changes ?? 0) > 0 && <span className="lib-chip lib-chip--amber">{t('{0} agent changes', card!.pending_agent_changes)}</span>}
        {feedback > 0 && <span className="lib-chip">{t('{0} reader comments', feedback)}</span>}
        <span className="lib-grow" />
        <Link to={`/stories/${storyId}`} className="ui-btn ui-btn-primary">{t('Continue writing →')}</Link>
      </div>
    </div>
  </article>
}

/** The daily habit: streak, this week's words against the goal line, sprints. */
export function WeekPanel({ goals }: { goals: Goals }) {
  const [editing, setEditing] = useState(false)
  const daily = goals.settings.daily_words
  const max = Math.max(1, daily ?? 0, ...goals.week.map(day => day.words))
  const days = goals.week.map(day => {
    const date = new Date(day.day + 'T00:00')
    return { ...day, label: date.toLocaleDateString(getUiLanguage(), { weekday: 'narrow' }), name: date.toLocaleDateString(getUiLanguage(), { weekday: 'long' }) }
  })
  return <section className="lib-panel" aria-labelledby="lib-week-title">
    <h2 id="lib-week-title" className="eyebrow">{t('This week')}</h2>
    {goals.streak > 0 && <p className="lib-streak">🔥 {t('{0}-day streak', goals.streak)}{goals.best_streak > goals.streak && <span> · {t('best {0}', goals.best_streak)}</span>}</p>}
    <div className="lib-week-stats">
      <span><strong>{goals.week_words.toLocaleString(getUiLanguage())}</strong>{t('words')}</span>
      <span><strong>{goals.week_sessions.toLocaleString(getUiLanguage())}</strong>{t('sessions')}</span>
    </div>
    <div className="lib-spark-wrap">
      {daily && <span className="lib-goal-line" style={{ bottom: `${18 + Math.round(daily / max * 48)}px` }} aria-hidden="true" />}
      <ol className="lib-spark" aria-label={t('Words per day, last seven days')}>
        {days.map(day => <li key={day.day} title={`${day.name}: ${t('{0} words', day.words.toLocaleString(getUiLanguage()))}`}><i style={{ height: `${Math.max(4, Math.round(day.words / max * 100))}%` }} className={!day.words ? 'is-empty' : daily && !day.met ? 'is-short' : ''} /><span aria-hidden="true">{day.label}</span><span className="sr-only">{`${day.name}: ${t('{0} words', day.words)}`}</span></li>)}
      </ol>
    </div>
    {goals.week_sprints > 0 && <p className="lib-note">{t(goals.week_sprints === 1 ? '{0} sprint · {1} words' : '{0} sprints · {1} words', goals.week_sprints, goals.week_sprint_words.toLocaleString(getUiLanguage()))}</p>}
    {daily ? <p className="lib-note">{t('Goal: {0} words a writing day.', daily.toLocaleString(getUiLanguage()))} <button type="button" className="goal-link" onClick={() => setEditing(true)}>{t('Edit')}</button></p>
      : <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm lib-set-goal" onClick={() => setEditing(true)}>{t('Set a daily goal')}</button>}
    <p className="lib-note">{goals.settings.count_ai ? t('Counts words you type in Write and AI changes you accept.') : t('Counts words you type in Write. Text from connected AI and imports is not counted.')}</p>
    {editing && <GoalsDialog onClose={() => setEditing(false)} />}
  </section>
}

export function OpenItemsPanel({ tks, comments, agentChanges, behind }: { tks: number; comments: number; agentChanges: number; behind: number }) {
  const rows: [string, number, boolean][] = [[t('TKs'), tks, true], [t('Agent changes to review'), agentChanges, true], [t('Reader comments'), comments, false], ...(behind ? [[t('Behind on a goal'), behind, true] as [string, number, boolean]] : [])]
  return <section className="lib-panel" aria-labelledby="lib-open-title">
    <h2 id="lib-open-title" className="eyebrow">{t('Open items')}</h2>
    <ul className="lib-open">{rows.map(([label, count, amber]) => <li key={label}><span>{label}</span><span className={`lib-chip${amber && count ? ' lib-chip--amber' : ''}`}>{count}</span></li>)}</ul>
  </section>
}
