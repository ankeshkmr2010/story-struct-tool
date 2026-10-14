import { Link } from 'react-router-dom'

/** The public roadmap. Plain promises, no dates: statuses move as work lands. */

type Status = 'In progress' | 'Planned' | 'Exploring'

const BADGE: Record<Status, string> = {
  'In progress': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  Planned: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  Exploring: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

const ITEMS: readonly { title: string; status: Status; description: string }[] = [
  {
    title: 'Scrivener support',
    status: 'Planned',
    description:
      'Import a manuscript from Scrivener. Word (.docx) import is already available.',
  },
  {
    title: 'View counts on shared stories',
    status: 'Exploring',
    description: 'See how many people have read the stories you share.',
  },
]


const DELIVERED: readonly { title: string; description: string; highlight?: boolean }[] = [
  { title: 'Write, read and plan', highlight: true, description: 'Continuous chapter writing, focused reading and a scene grid, with your outline and story context close at hand.' },
  { title: 'Work with your AI', highlight: true, description: 'Connect your assistant, review proposed edits and catch up your outline from prose. Craft reviews cover rhythm, MICE threads, value shifts and misbelief.' },
  { title: 'Images and portable manuscripts', highlight: true, description: 'Add illustrations, captions and reference images. Export Word, PDF, EPUB, HTML, Markdown or plain text; import Word and keep full backups.' },
  { title: 'Share and hear from readers', highlight: true, description: 'Private sharing, public showcases and frozen beta rounds, with passage feedback, private conversations and reader polls.' },
  { title: 'Find the passage you need', highlight: true, description: 'Search prose and planning details across your library, with exact and optional meaning matches. Connected AI can retrieve evidence too.' },
  { title: 'Try before signing up', highlight: true, description: 'A guided writing sandbox and interactive feature demos. Sign in to keep your story and edits.' },
  { title: 'History you can return to', description: 'Scene snapshots, whole-story versions, safe restores and a record of who wrote what. Trash keeps deleted stories recoverable until permanent deletion.' },
  { title: 'Keep your world together', description: 'Characters, places, glossary, timelines and continuity notices, plus chapter epigraphs and notes.' },
  { title: 'Guidance and feedback', description: 'How-to guides, AI connection prompts, author-name settings, private product feedback and public shoutouts.' },
]

export default function Roadmap() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <header className="mt-4 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            On the horizon
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            What we're building next.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-600 dark:text-slate-300">
            StoryTool grows from what writers ask for. Here's what's on the way.
          </p>
        </header>

        <ul className="mt-8 space-y-3">
          {ITEMS.map((item) => (
            <li
              key={item.title}
              className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{item.title}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[item.status]}`}>
                  {item.status}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
            </li>
          ))}
        </ul>

        <section className="mt-12" aria-labelledby="delivered-heading">
          <h2 id="delivered-heading" className="text-xl font-semibold tracking-tight">Delivered</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">The main features available today. Ringed cards highlight the essentials.</p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {DELIVERED.map((item) => (
              <li key={item.title} className={`rounded-lg border bg-white p-4 dark:bg-slate-900 ${item.highlight ? 'border-emerald-300 ring-1 ring-emerald-300 dark:border-emerald-700 dark:ring-emerald-700' : 'border-slate-200 dark:border-slate-800'}`}>
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
          <Link to="/" className="underline underline-offset-4 hover:text-slate-900 dark:hover:text-slate-100">
            ← Back to StoryTool
          </Link>
        </p>
      </div>
    </main>
  )
}
