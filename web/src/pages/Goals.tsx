import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { HabitGoalForm, Ring, StoryGoalForm, statusLabel, useGoals } from '../components/Goals'
import { WeekPanel } from '../components/LibraryParts'
import { getUiLanguage, plural, t } from '../i18n'

const n = (value: number) => value.toLocaleString(getUiLanguage())

/** One place to manage the daily habit (all stories) and each story's goal. */
export default function GoalsPage() {
  const goals = useGoals()
  const stories = useQuery({ queryKey: ['goal-stories'], queryFn: api.goalStories })
  const cards = useQuery({ queryKey: ['library-overview'], queryFn: api.libraryOverview })
  const coverOf = (id: string) => cards.data?.cards.find(card => card.story_id === id)?.cover_url
  const [editing, setEditing] = useState<string | null>(null)
  const storyTitles = Object.fromEntries((stories.data ?? []).map(row => [row.story_id, row.title]))
  const daily = goals.data?.settings.daily_words

  return <main className="goals-page">
    <Link to="/library" className="goals-back">{t('← Your stories')}</Link>
    <h1>{t('Writing goals')}</h1>
    <p className="goals-intro">{t('A daily habit across all your stories, and a target or deadline for each story. Words count toward both.')}</p>

    <div className="goals-layout">
      <section className="lib-panel goals-habit" aria-labelledby="goals-habit-title">
        <h2 id="goals-habit-title" className="eyebrow">{t('Daily habit · all stories')}</h2>
        {goals.data && <div className="goals-today">
          <Ring value={goals.data.today_words} max={daily ?? Math.max(1, goals.data.today_words)} label={daily ? t('{0} of {1} words today', goals.data.today_words, daily) : plural(goals.data.today_words, '{0} word', '{0} words', goals.data.today_words)} size={64} />
          <div><strong>{daily ? `${n(goals.data.today_words)} / ${n(daily)}` : n(goals.data.today_words)}</strong><span>{t('Today')}</span></div>
          <div><strong>🔥 {n(goals.data.streak)}</strong><span>{t('best {0}', goals.data.best_streak)}</span></div>
        </div>}
        <HabitGoalForm />
      </section>

      <div className="goals-side">
        {goals.data && <WeekPanel goals={goals.data} />}
        {goals.data && <section className="lib-panel" aria-labelledby="goals-sprints-title">
          <h2 id="goals-sprints-title" className="eyebrow">{t('Sprints this week')}</h2>
          {goals.data.recent_sprints.length === 0 ? <p className="lib-note">{t('No sprints yet. Start one from the bar at the bottom of Write.')}</p>
            : <ul className="lib-open">{goals.data.recent_sprints.map(sprint => <li key={sprint.id}><span>{new Date(sprint.started_at).toLocaleDateString(getUiLanguage(), { weekday: 'short', day: 'numeric', month: 'short' })} · {storyTitles[sprint.story_id] ?? ''}</span><span className="lib-chip">{t('{0} words in {1} min', n(sprint.words), sprint.minutes)}</span></li>)}</ul>}
        </section>}
      </div>
    </div>

    <section className="goals-stories" aria-labelledby="goals-stories-title">
      <h2 id="goals-stories-title">{t('Story goals')}</h2>
      {stories.isPending && <p className="writer-help">{t('Loading…')}</p>}
      {stories.isError && <p role="alert" className="writer-error">{errorText(stories.error)}</p>}
      <ul>
        {stories.data?.map(row => <li key={row.story_id} className="goals-story">
          <div className="goals-story-head">
            {coverOf(row.story_id) ? <img className="goals-thumb" src={coverOf(row.story_id)!} alt="" /> : <span className="goals-thumb" aria-hidden="true" />}
            <Link to={`/stories/${row.story_id}`} className="story-card-title">{row.title}</Link>
            {row.goal && <span className={`lib-chip lib-chip--goal is-${row.goal.status}`}>{statusLabel(row.goal)}</span>}
            <span className="lib-grow" />
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-expanded={editing === row.story_id} onClick={() => setEditing(editing === row.story_id ? null : row.story_id)}>{row.goal ? t('Edit goal') : t('Set a goal')}</button>
          </div>
          {row.goal ? <>
            <div className="lib-bar" role="img" aria-label={t('{0}% of goal', row.goal.percent)}><i style={{ width: `${row.goal.percent}%` }} /></div>
            <p className="lib-note">{[t('{0} / {1} words', n(row.goal.words_now), n(row.goal.target_words)), row.goal.deadline && t('Due {0}', new Date(row.goal.deadline + 'T00:00').toLocaleDateString(getUiLanguage(), { day: 'numeric', month: 'short', year: 'numeric' })), row.goal.needed_today && t('{0} a day', n(row.goal.needed_today)), row.goal.today_words > 0 && t('{0} today', n(row.goal.today_words))].filter(Boolean).join(' · ')}</p>
          </> : editing !== row.story_id && <p className="lib-note">{t('No goal.')}</p>}
          {editing === row.story_id && <div className="goals-story-form"><StoryGoalForm storyId={row.story_id} onSaved={() => setEditing(null)} /></div>}
        </li>)}
      </ul>
    </section>
  </main>
}
