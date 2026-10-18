import { Link } from 'react-router-dom'

const RELEASES: [string, string, string][] = [
  ['v1', 'Investment bank · 2015–18', 'Delivered risk data on time, every time. Learned that “probably fine” is not a status.'],
  ['v2', 'E-commerce and payments · 2018–20', 'Kept checkout and merchant payments moving. Developed a healthy respect for sale days.'],
  ['v3', 'Property search, team lead · 2020–21', 'Built search and listings services from scratch and led a small team through every release.'],
  ['v4', 'Startup co-founder · 2023–24', 'Built an automated market-research product. Learned what founders mean by “quick call”.'],
  ['v5', 'Founding engineer, healthcare AI · 2024–25', 'First engineering hire: AI telehealth backend, EHR integrations and retrieval-augmented generation.'],
  ['v6', 'Senior engineer, healthcare AI · 2025–', 'Search across a US healthcare platform, with an LLM retrieval layer on top.'],
  ['nightly', 'StoryTool · evenings and weekends', 'This. You are looking at it.'],
]

export default function About() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-[var(--ink)] sm:px-8">
      <header>
        <p className="eyebrow">ABOUT THE DEVELOPER</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Hi, I’m Ankesh. I write stories, and apparently the software to keep them in order.</h1>
        <p className="mt-5 text-lg leading-8 text-[var(--muted)]">
          I’m a software engineer in Bengaluru with eleven years of building systems that aren’t allowed to break. I also write fiction.
          After losing a subplot in a file called <code className="text-base">final_v3_REAL.docx</code>, I decided the sensible fix was a whole app.
        </p>
      </header>

      <section className="mt-10" aria-labelledby="why-title">
        <h2 id="why-title" className="text-xl font-semibold">Why StoryTool</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          A novel is a dependency graph with feelings. Characters, threads, timelines and drafts all depend on each other, but most tools store them as a pile of documents.
          StoryTool keeps the structure, lets your AI help with exactly what you ask (you review every change), and never trains AI on your words.
        </p>
      </section>

      <section className="mt-10" aria-labelledby="career-title">
        <h2 id="career-title" className="text-xl font-semibold">Career, as release notes</h2>
        <ol className="mt-4 space-y-3">
          {RELEASES.map(([version, role, note]) => <li key={version} className="grid grid-cols-[4.5rem_1fr] gap-3">
            <span className="font-mono text-sm text-[var(--accent)]">{version}</span>
            <span><strong className="font-medium">{role}</strong><span className="block text-sm leading-6 text-[var(--muted)]">{note}</span></span>
          </li>)}
        </ol>
        <p className="mt-4 text-sm text-[var(--muted)]">Computer science at BITS Pilani. Fluent in Python, TypeScript, Java and Go, and conversational in deadline.</p>
      </section>

      <section className="mt-10" aria-labelledby="built-title">
        <h2 id="built-title" className="text-xl font-semibold">Built with</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          Python and Litestar, React and TypeScript, Postgres on Neon, and MCP so your AI can work on your story.
          Built by one person and a small team of AI coding agents, all closely supervised. The agents write code; the stories are mine.
        </p>
      </section>

      <section className="mt-10" aria-labelledby="hello-title">
        <h2 id="hello-title" className="text-xl font-semibold">Say hello</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          Find me on <a href="https://www.linkedin.com/in/ankesh-kumar-35737a7b" target="_blank" rel="noopener noreferrer" className="underline">LinkedIn</a>.
          Found a bug or have an idea? <Link to="/feedback" className="underline">Feedback</Link> comes straight to me, and I read all of it.
        </p>
      </section>
    </main>
  )
}
