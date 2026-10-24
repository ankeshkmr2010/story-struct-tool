import { Link } from 'react-router-dom'
import { t } from '../i18n'

export default function Pricing() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-[var(--ink)] sm:px-8">
      <header>
        <p className="eyebrow">{t('PRICING')}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{t('Free during beta.')}</h1>
        <p className="mt-5 text-lg leading-8 text-[var(--muted)]">{t('Plan, write, review and share your stories without a StoryTool subscription charge during beta.')}</p>
      </header>
      <section className="mt-10 space-y-4" aria-labelledby="included-title">
        <h2 id="included-title" className="text-xl font-semibold">{t('Your writing workspace')}</h2>
        <p className="leading-7 text-[var(--muted)]">{t('Writing and reading, story structure, timelines, continuity and craft checks, version history, manuscript exports and sharing are included. AI is optional.')}</p>
        <Link to="/library" className="landing-primary">{t('Start your story →')}</Link>
      </section>
      <section className="mt-10 space-y-3" aria-labelledby="ai-costs-title">
        <h2 id="ai-costs-title" className="text-xl font-semibold">{t('AI costs are separate')}</h2>
        <p className="leading-7 text-[var(--muted)]">{t('Use the AI client you already have, or connect your own provider API key for the in-app assistant. Any client subscription or API charges are set by that service and are separate from StoryTool.')}</p>
        <Link to="/#mcp" className="underline underline-offset-4">{t('See how to connect your AI →')}</Link>
      </section>
      <section className="mt-10 space-y-3" aria-labelledby="future-pricing-title">
        <h2 id="future-pricing-title" className="text-xl font-semibold">{t('After beta')}</h2>
        <p className="leading-7 text-[var(--muted)]">{t('Future pricing is undecided. We will publish details here when that changes. Your manuscript exports and backups are available during beta.')}</p>
      </section>
      <p className="mt-12 text-sm text-[var(--muted)]"><Link to="/" className="underline underline-offset-4">{t('← Back to StoryTool')}</Link></p>
    </main>
  )
}
