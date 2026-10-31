import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type LibraryCardState, type Story } from '../api/client'
import { t } from '../i18n'
import { useGuide } from './guide'

const CHARACTERS_LEVEL = 3
const CHECK_VIEW = 108

/**
 * Usability phase 3, item 9: four first steps on the Library, each opening the right screen.
 * Seeded examples don't count. It goes away once the three main steps are done, or when dismissed.
 */
export function FirstHourChecklist({ stories, cards, onNewStory }: { stories: Story[]; cards: LibraryCardState[]; onNewStory: () => void }) {
  const { guide, update } = useGuide()
  const own = cards.filter(card => !card.example && !card.archived)
  const wrote = own.some(card => card.drafted_scene_count > 0)
  const cast = own.some(card => card.character_count > 0)
  const checked = Boolean(guide?.check_run)
  const visible = Boolean(guide) && !guide!.checklist_dismissed && !(wrote && cast && checked)
  const grants = useQuery({ queryKey: ['oauth-grants'], queryFn: api.listOAuthGrants, enabled: visible })
  const tokens = useQuery({ queryKey: ['agent-tokens'], queryFn: api.listAgentTokens, enabled: visible })
  if (!visible) return null
  const connected = (grants.data ?? []).some(grant => !grant.revoked_at) || (tokens.data ?? []).length > 0
  // The writer's most recently edited story; with none yet, the steps start by creating one.
  const target = stories.filter(story => own.some(card => card.story_id === story.id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  const step = (done: boolean, label: string, open: string | null, optional = false) => <li className={done ? 'is-done' : ''}>
    <span className="first-hour-mark" aria-hidden="true">{done ? '✓' : ''}</span>
    {done ? <span>{label}</span> : open ? <Link to={open}>{label}</Link> : <button type="button" onClick={onNewStory}>{label}</button>}
    {optional && <span className="first-hour-optional">{t('optional')}</span>}
    <span className="sr-only">{done ? t('done') : t('not done yet')}</span>
  </li>
  return <section className="first-hour" aria-labelledby="first-hour-title">
    <header><h2 id="first-hour-title">{t('Your first hour')}</h2><button type="button" onClick={() => update({ checklist_dismissed: true })}>{t('Hide')}</button></header>
    <ol>
      {step(wrote, t('Write a scene'), target ? `/stories/${target.id}?open=write` : null)}
      {step(cast, t('Add a character'), target ? `/stories/${target.id}?open=${CHARACTERS_LEVEL}` : null)}
      {step(checked, t('Run one check'), target ? `/stories/${target.id}?open=${CHECK_VIEW}` : null)}
      {step(connected, t('Connect your AI'), '/how-to-use#write-with-ai', true)}
    </ol>
  </section>
}
