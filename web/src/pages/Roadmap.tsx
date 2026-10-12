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
    title: 'Story evaluation',
    status: 'In progress',
    description:
      'Run craft checks when you want them: scene and sequel rhythm, MICE thread nesting, and AI-assisted reads of your value shifts and character arcs. Flags to consider, never rules to obey.',
  },
  {
    title: 'More export formats',
    status: 'Planned',
    description: 'Take your manuscript out as EPUB, MOBI, PDF, HTML or plain text.',
  },
  {
    title: 'Reviewers and commenters',
    status: 'Planned',
    description: 'Invite readers to leave comments on a shared story without giving them edit access.',
  },
  {
    title: 'Images in your story',
    status: 'Planned',
    description: 'Add images to your story: maps, character art, illustrations.',
  },
  {
    title: 'Review inbox for AI edits',
    status: 'Planned',
    description: 'One place to see, accept or dismiss the changes an AI agent proposes to your story.',
  },
  {
    title: 'Search across your story',
    status: 'Exploring',
    description: 'Find a name, a phrase or an idea anywhere: prose, scenes, characters and notes.',
  },
  {
    title: 'View counts on shared stories',
    status: 'Exploring',
    description: 'See how many people have read the stories you share.',
  },
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

        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
          <Link to="/" className="underline underline-offset-4 hover:text-slate-900 dark:hover:text-slate-100">
            ← Back to StoryTool
          </Link>
        </p>
      </div>
    </main>
  )
}
