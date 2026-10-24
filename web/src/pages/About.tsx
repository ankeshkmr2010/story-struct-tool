import { Link } from 'react-router-dom'
import { t, tx } from '../i18n'

const RELEASES: [string, string, string][] = [
  ['v1', tx('Investment bank · 2015–18'), tx('Delivered risk data on time, every time. Learned that “probably fine” is not a status.')],
  ['v2', tx('E-commerce and payments · 2018–20'), tx('Kept checkout and merchant payments moving. Developed a healthy respect for sale days.')],
  ['v3', tx('Property search, team lead · 2020–21'), tx('Built search and listings services from scratch and led a small team through every release.')],
  ['v4', tx('Startup co-founder · 2023–24'), tx('Built an automated market-research product. Learned what founders mean by “quick call”.')],
  ['v5', tx('Founding engineer, healthcare AI · 2024–25'), tx('First engineering hire: AI telehealth backend, EHR integrations and retrieval-augmented generation.')],
  ['v6', tx('Senior engineer, healthcare AI · 2025–'), tx('Search across a US healthcare platform, with an LLM retrieval layer on top.')],
  ['nightly', tx('StoryTool · evenings and weekends'), tx('This. You are looking at it.')],
]

export default function About() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-[var(--ink)] sm:px-8">
      <header>
        <p className="eyebrow">{t('ABOUT THE DEVELOPER')}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{t('Hi, I’m Ankesh. I write stories, and apparently the software to keep them in order.')}</h1>
        <p className="mt-5 text-lg leading-8 text-[var(--muted)]">
          {t('I’m a software engineer in Bengaluru with eleven years of building systems that aren’t allowed to break. I also write fiction. After losing a subplot in a file called')}{' '}<code className="text-base">final_v3_REAL.docx</code>{t(', I decided the sensible fix was a whole app.')}
        </p>
      </header>

      <section className="mt-10" aria-labelledby="why-title">
        <h2 id="why-title" className="text-xl font-semibold">{t('Why StoryTool')}</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {t('A novel is a dependency graph with feelings. Characters, threads, timelines and drafts all depend on each other, but most tools store them as a pile of documents. StoryTool keeps the structure, lets your AI help with exactly what you ask (you review every change), and never trains AI on your words.')}
        </p>
      </section>

      <section className="mt-10" aria-labelledby="career-title">
        <h2 id="career-title" className="text-xl font-semibold">{t('Career, as release notes')}</h2>
        <ol className="mt-4 space-y-3">
          {RELEASES.map(([version, role, note]) => <li key={version} className="grid grid-cols-[4.5rem_1fr] gap-3">
            <span className="font-mono text-sm text-[var(--accent)]">{version}</span>
            <span><strong className="font-medium">{t(role)}</strong><span className="block text-sm leading-6 text-[var(--muted)]">{t(note)}</span></span>
          </li>)}
        </ol>
        <p className="mt-4 text-sm text-[var(--muted)]">{t('Computer science at BITS Pilani. Fluent in Python, TypeScript, Java and Go, and conversational in deadline.')}</p>
      </section>

      <section className="mt-10" aria-labelledby="built-title">
        <h2 id="built-title" className="text-xl font-semibold">{t('Built with')}</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {t('Python and Litestar, React and TypeScript, Postgres on Neon, and MCP so your AI can work on your story. Built by one person and a small team of AI coding agents, all closely supervised. The agents write code; the stories are mine.')}
        </p>
      </section>

      <section className="mt-10" aria-labelledby="hello-title">
        <h2 id="hello-title" className="text-xl font-semibold">{t('Say hello')}</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {t('Find me on')}{' '}<a href="https://www.linkedin.com/in/ankesh-kumar-35737a7b" target="_blank" rel="noopener noreferrer" className="underline">{t('LinkedIn')}</a>{t('. Found a bug or have an idea?')}{' '}<Link to="/feedback" className="underline">{t('Feedback')}</Link>{' '}{t('comes straight to me, and I read all of it.')}
        </p>
      </section>
    </main>
  )
}
