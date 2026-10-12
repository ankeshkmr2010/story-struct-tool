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

const SHOUTOUTS: readonly { name: string; thanks: string }[] = [
  {
    name: 'Madam Stuti Dutta',
    thanks: 'my wife, first on this list for health and legal reasons. Great feedback and endless encouragement.',
  },
  { name: 'Nikhil Doshi', thanks: 'the first reviewer, and the first to actually write something in it.' },
  { name: 'Saransh Sharma', thanks: 'the most “author” review of them all.' },
  { name: 'Hena Varma', thanks: 'for feedback that was as comprehensive as it was encouraging.' },
  { name: 'Ananya', thanks: 'for the positive vibes.' },
  { name: 'Aditya Bhatia', thanks: 'the first person I bounced this idea off.' },
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

        <section className="mt-10" aria-labelledby="shoutouts-heading">
          <h2 id="shoutouts-heading" className="text-xl font-semibold tracking-tight">
            Shoutouts
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Thank you to the people who read early, told the truth and kept this going.
          </p>
          <ul className="mt-4 space-y-3">
            {SHOUTOUTS.map((person) => (
              <li key={person.name} className="text-sm leading-6">
                <span className="font-semibold">{person.name}</span>
                <span className="text-slate-600 dark:text-slate-300"> — {person.thanks}</span>
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
