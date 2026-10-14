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
    title: 'Latin-script language support',
    status: 'Planned',
    description: 'Language-aware support for stories written in Latin-script languages, including accented text and punctuation.',
  },
  {
    title: 'View counts on shared stories',
    status: 'Exploring',
    description: 'See how many people have read the stories you share.',
  },
]


const HERO_FEATURES = new Set(['Jev Noticing for everyone', 'Images in your story', 'Try before signing up', 'Beta readers and polls', 'Search your story and library', 'On-demand craft checks', 'Catch-up outline', 'Connect your AI', 'Continuous chapter writer', 'Whole-story versions', 'Review inbox for AI edits', 'Story grid', 'Backup, restore and Word export'])

const DELIVERED: readonly { date: string; items: readonly (readonly [string, string])[] }[] = [
  {
    date: '14 Oct 2026',
    items: [
      ['Images in your story', 'illustrations and reference art with captions, inline Write thumbnails, right-click insertion, scene links and portable exports. Large photos shrink before upload, with a gentle alt-text prompt. A dedicated page manages usage and safe deletion; guided samples show the flow.'],
      ['Try before signing up', 'a guided writing sandbox with local search and History, plus interactive feature demos and sample downloads. Tours support Previous, Next and resume; sign in to keep your edits.'],
      ['Writing and reader guides', 'AI quickstart prompts, images and exports, plus beta rounds, private reader conversations and polls.'],
      ['Jev Noticing for everyone', 'StoryTool provides a shared story reader for all users — no personal AI key needed. Choose read prose in Noticed for advisory observations; Jev never writes prose or applies changes.'],
      ['Flexible scene reader foundation', 'unchanged scene questions reuse private cached answers. Shared-reader limits and safe fallbacks control usage, while story checks stay separate from Jev or a compatible local model.'],
      ['Evaluate polish', 'credited craft definitions, review dates, stale-review actions and findings that open the relevant planning item.'],
      ['Site navigation and link previews', 'sticky navigation, a direct tour entry and custom thumbnails for Landing, Your stories, Roadmap, Shoutouts, Feedback and How to use. Enabled public showcases use their own title and first manuscript image.'],
    ],
  },
  {
    date: '13 Oct 2026 — beta readers',
    items: [
      ['Beta readers and polls', 'frozen manuscript rounds with controlled invitations, private passage conversations and versioned polls, managed together from Beta readers.'],
    ],
  },
  {
    date: '13 Oct 2026 — search integration',
    items: [
      ['Search for your connected AI', 'bounded exact and related search, with passage evidence for craft reviews and prompts that guide agents to verify their findings.'],
    ],
  },
  {
    date: '13 Oct 2026 — site guide update',
    items: [
      ['Search, export and AI guides', 'instructions for library and meaning search, Word import, manuscript formats and AI connections, with meaning-search privacy explained.'],
    ],
  },
  {
    date: '13 Oct 2026',
    items: [
      ['Search your story and library', 'one search window for saved prose and planning details, with exact and optional related matches, readable filters and links to matching passages.'],
      ['Automatic review refresh', 'reviews submitted by AI clients appear while Evaluate is open, with manual refresh still available.'],
      ['Word manuscript import', 'bring a .docx manuscript into a new story, then write, read or build its outline from the imported prose.'],
      ['Submission PDF export', 'export a manuscript with a title page, double-spaced prose, running page headers and optional reference appendices.'],
      ['Your author name', 'set a pen name in Settings and use it as the byline in manuscript exports.'],
      ['More craft reviews', 'review value shifts against scene prose and a character’s misbelief at the midpoint. Use the feedback to decide what to revise.'],
    ],
  },
  {
    date: '12 Oct 2026',
    items: [
      ['Easier AI setup', 'Claude and ChatGPT first, other clients available on demand, and a starter prompt in plain writing language.'],
      ['Product feedback', 'send private bug reports and suggestions about StoryTool from the signed-in Feedback page.'],
      ['On-demand craft checks', 'check scene/sequel rhythm and MICE thread nesting in Evaluate; get an AI review of your MICE threads. Suggestions to consider, never rules to obey.'],
      ['EPUB, HTML and plain-text export', 'take your manuscript out as an e-book, a web page or plain text.'],
    ],
  },
  {
    date: '11 Oct 2026',
    items: [
      ['Public story showcase', 'an opt-in, read-only page anyone can open: manuscript, story context and timeline.'],
      ['Catch-up outline', 'an AI agent builds the outline from prose you have already written; keep all, some or none.'],
      ['Backup, restore and Word export', 'download a full backup or a .docx manuscript, and restore any backup into your library.'],
      ['Who wrote what', 'see which changes came from you or an AI in the authorship report under History.'],
    ],
  },
  {
    date: '10 Oct 2026',
    items: [
      ['Review inbox for AI edits', 'see, accept or dismiss every change an AI agent proposes, filtered by status and source.'],
      ['Story grid', 'every scene at a glance with status, POV, place, time, goal, conflict, outcome and word count.'],
      ['Scene snapshots', 'preview and restore earlier drafts of any scene.'],
      ['Epigraphs and chapter notes', 'an opening quote plus opening and closing notes for each chapter.'],
    ],
  },
  {
    date: '9 Oct 2026',
    items: [
      ['Sharing with readers', 'share a story read-only, and optionally let readers import their own copy.'],
      ['Continuous chapter writer', 'write a whole chapter on one scrolling page, plus focused reading and an EmojiDB shortcut in the right-click menu.'],
      ['Glossary', 'keep your story’s terms, aliases and definitions in one place.'],
      ['Connect your AI', 'sign your AI assistant in to one story or your whole library, and revoke it any time.'],
      ['Trash', 'deleted stories wait in Trash until you restore them or delete them for good.'],
    ],
  },
  {
    date: '8 Oct 2026',
    items: [
      ['Accounts, timelines and the assistant', 'Google sign-in, story timelines and an in-app AI assistant.'],
      ['Whole-story versions', 'automatic checkpoints, and a safe restore that keeps the draft you replaced.'],
    ],
  },
  {
    date: '6 Oct 2026',
    items: [['Places and continuity', 'track where scenes happen and get flagged when the timeline contradicts itself.']],
  },
  {
    date: '5 Oct 2026',
    items: [
      ['Chapters, scenes and prose', 'write scenes inside chapters, with revisions, annotations, progress and Markdown export.'],
      ['Noticing', 'suggestions drawn from what you write, so the plan can follow the draft.'],
    ],
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

        <section className="mt-12" aria-labelledby="delivered-heading">
          <h2 id="delivered-heading" className="text-xl font-semibold tracking-tight">Delivered</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">What has shipped so far, newest first.</p>
          <ol className="mt-6 border-l-2 border-slate-200 dark:border-slate-800">
            {DELIVERED.map((day) => (
              <li key={day.date} className="relative pb-8 pl-6 last:pb-0">
                <span aria-hidden="true" className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-slate-50 dark:ring-slate-950" />
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">{day.date}</p>
                <ul className="mt-2 space-y-2">
                  {day.items.map(([title, description]) => (
                    <li key={title} className="text-sm leading-6">
                      <span className={HERO_FEATURES.has(title) ? "rounded-full px-2 py-0.5 font-semibold ring-1 ring-emerald-400 dark:ring-emerald-600" : "font-semibold"}>{title}</span>
                      <span className="text-slate-600 dark:text-slate-300"> — {description}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
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
