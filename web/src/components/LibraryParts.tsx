import { Link } from 'react-router-dom'
import type { LibraryCardState, LibraryOverview } from '../api/client'
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
    <div className={`lib-cover ${coverTint(storyId)}`} aria-hidden="true">{title}</div>
    <div className="lib-continue-body">
      <div className="lib-continue-top"><span className="eyebrow">{t('Continue writing')}</span><span>{edited}</span></div>
      <div><h2>{title}</h2><p>{mode}</p></div>
      {total > 0 && <div className="lib-progress">
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

/** Words the author typed in StoryTool over the last seven days, oldest first. */
export function WeekPanel({ week }: { week: LibraryOverview['week'] }) {
  const max = Math.max(1, ...week.days)
  const today = new Date()
  const days = week.days.map((words, index) => {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (6 - index)))
    return { words, label: day.toLocaleDateString(getUiLanguage(), { weekday: 'narrow', timeZone: 'UTC' }), name: day.toLocaleDateString(getUiLanguage(), { weekday: 'long', timeZone: 'UTC' }) }
  })
  return <section className="lib-panel" aria-labelledby="lib-week-title">
    <h2 id="lib-week-title" className="eyebrow">{t('This week')}</h2>
    <div className="lib-week-stats">
      <span><strong>{week.words.toLocaleString(getUiLanguage())}</strong>{t('words')}</span>
      <span><strong>{week.sessions.toLocaleString(getUiLanguage())}</strong>{t('sessions')}</span>
    </div>
    <ol className="lib-spark" aria-label={t('Words per day, last seven days')}>
      {days.map((day, index) => <li key={index} title={`${day.name}: ${t('{0} words', day.words.toLocaleString(getUiLanguage()))}`}><i style={{ height: `${Math.max(4, Math.round(day.words / max * 100))}%` }} className={day.words ? '' : 'is-empty'} /><span aria-hidden="true">{day.label}</span><span className="sr-only">{`${day.name}: ${t('{0} words', day.words)}`}</span></li>)}
    </ol>
    <p className="lib-note">{t('Counts words you type in Write. Text from connected AI and imports is not counted.')}</p>
  </section>
}

export function OpenItemsPanel({ tks, comments, agentChanges }: { tks: number; comments: number; agentChanges: number }) {
  const rows: [string, number, boolean][] = [[t('TKs'), tks, true], [t('Agent changes to review'), agentChanges, true], [t('Reader comments'), comments, false]]
  return <section className="lib-panel" aria-labelledby="lib-open-title">
    <h2 id="lib-open-title" className="eyebrow">{t('Open items')}</h2>
    <ul className="lib-open">{rows.map(([label, count, amber]) => <li key={label}><span>{label}</span><span className={`lib-chip${amber && count ? ' lib-chip--amber' : ''}`}>{count}</span></li>)}</ul>
  </section>
}
