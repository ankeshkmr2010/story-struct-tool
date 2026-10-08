import { Link } from 'react-router-dom'

/**
 * The guide.
 *
 * Deliberately styled with the *same* colour language as the app rather than a neutral
 * documentation palette: emerald means ready, amber means a gap worth attention, red means a
 * proven contradiction, violet means a model's guess. A reader who learns the colours here
 * recognises them in the sidebar and the right-hand rail, so the page teaches by resemblance
 * instead of description.
 */

type Status = 'ready' | 'nudge' | 'locked'

const DOT: Record<Status, string> = {
  ready: 'bg-emerald-500',
  nudge: 'bg-amber-400',
  locked: 'bg-slate-300',
}

const SECTIONS = [
  ['start', 'First five minutes'],
  ['modes', 'How you work'],
  ['levels', 'The eight levels'],
  ['links', 'Linking plan to draft'],
  ['time', 'Story time and flashbacks'],
  ['feedback', 'What the tool tells you'],
  ['writing', 'Writing and exporting'],
] as const

const LEVELS: readonly (readonly [string, string])[] = [
  ['Premise', 'Describe the story in a sentence. Set its genre, point of view, and structure framework.'],
  ['Arc skeleton', 'Mark the major turning points: what starts the trouble, what changes its direction, what ends it.'],
  ['Characters', 'Who wants what. Set roles, then the want and the need — the gap between them is the arc.'],
  ['Acts', 'The large movements, and what changes in each. Link the turning points that open and close them.'],
  ['Beats', 'The moments an act owes: inciting incident, midpoint, all is lost. Seeded from your framework.'],
  ['Threads', 'The storylines carrying those beats — the main plot, a relationship, a subplot.'],
  ['Chapters', 'Containers for scenes. Assign an act and declare which beats the chapter fulfils.'],
  ['Scenes', 'Write the prose. Record goal, conflict, outcome, POV, and what structure it advances.'],
]

const MODES = [
  {
    name: 'Plotter',
    status: 'locked' as Status,
    tagline: 'Top down, in order',
    description: 'Levels stay locked until the structure above them is ready.',
    start: 'Start with a premise and work down the ladder.',
  },
  {
    name: 'Hybrid',
    status: 'nudge' as Status,
    tagline: 'Commit anywhere, any time',
    description: 'Everything is reachable. Missing scaffolding appears as a nudge you can ignore.',
    start: 'Start with a premise and a protagonist, then work wherever the idea is.',
  },
  {
    name: 'Pantser',
    status: 'ready' as Status,
    tagline: 'Discover by writing',
    description: 'All levels open, readiness nudges hidden. Structure grows out of the prose.',
    start: 'Open Scenes, add one, and write. Place it in a chapter later.',
  },
] as const

const FEEDBACK = [
  {
    label: 'Health',
    tone: 'border-amber-400 bg-amber-50',
    swatch: 'bg-amber-400',
    kind: 'Gaps',
    text: 'Structure you have not built yet — a beat nothing fulfils, a character with no want. Normal mid-draft, not errors.',
  },
  {
    label: 'Continuity · contradiction',
    tone: 'border-red-400 bg-red-50',
    swatch: 'bg-red-400',
    kind: 'Proven',
    text: 'The draft disagrees with itself: a character in two places at one story time, an on-page event with no scene. Stated as fact, because it is provable.',
  },
  {
    label: 'Continuity · possible',
    tone: 'border-violet-300 bg-violet-50',
    swatch: 'bg-violet-400',
    kind: 'A question',
    text: 'A model read something that does not match your links. Shown with its confidence and phrased as a question, because it may be wrong.',
  },
  {
    label: 'Noticed',
    tone: 'border-sky-300 bg-sky-50',
    swatch: 'bg-sky-400',
    kind: 'Observations',
    text: 'What a reading pass found in your prose — a character in six scenes with no arc, a thread gone quiet. Dismiss any of them permanently.',
  },
] as const

export default function HowToUse() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <nav className="flex items-center justify-between gap-4" aria-label="Guide navigation">
          <Link to="/" className="text-lg font-semibold">
            StoryTool
          </Link>
          <Link
            to="/"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Open your stories →
          </Link>
        </nav>

        <header className="mt-10 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            How to use StoryTool
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Turn an idea into a story you can follow.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-600">
            StoryTool holds the shape of your story so you don't have to keep it all in your
            head. Each level scaffolds the next, so a chapter opens already knowing which act
            it sits in and which beat it owes.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            You write the story. The tool keeps its structure close at hand and points out
            gaps — it never writes for you, and it never blocks you.
          </p>
        </header>

        <div className="mt-12 gap-10 lg:grid lg:grid-cols-[180px_minmax(0,1fr)]">
          {/* Sticky contents: the page is long enough that a reader needs a way back. */}
          <nav
            aria-label="Contents"
            className="mb-8 lg:mb-0 lg:sticky lg:top-8 lg:self-start"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Contents
            </p>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 lg:flex-col lg:gap-1">
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-sm text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-14">
            <Section id="start" eyebrow="01" title="Your first five minutes">
              <ol className="space-y-3 text-sm leading-6 text-slate-600">
                {[
                  <>Sign in with Google. Your library belongs to your account.</>,
                  <>
                    Type a title on the home page, choose{' '}
                    <strong className="font-medium text-slate-900">Create</strong>, and open
                    the story.
                  </>,
                  <>Pick an authoring mode in the header — Hybrid is the default.</>,
                  <>Add a premise and a protagonist, or jump to Scenes and start writing.</>,
                  <>Come back to the other levels later. Half-filled entries are fine.</>,
                ].map((step, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-medium text-white">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </Section>

            <Section id="modes" eyebrow="02" title="Choose how you work">
              <p className="text-sm leading-6 text-slate-600">
                All three modes read the same story — the mode only decides how firmly the
                sidebar holds you to the order. Switch at any time from the story header;
                nothing you have written changes.
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {MODES.map((mode) => (
                  <article
                    key={mode.name}
                    className="flex flex-col rounded-xl border border-slate-200 bg-white p-5"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${DOT[mode.status]}`} />
                      <h3 className="font-semibold">{mode.name}</h3>
                      {mode.name === 'Hybrid' && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                          default
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                      {mode.tagline}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{mode.description}</p>
                    <p className="mt-4 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-800">
                      {mode.start}
                    </p>
                  </article>
                ))}
              </div>
            </Section>

            <Section id="levels" eyebrow="03" title="Build the structure in eight levels">
              <p className="text-sm leading-6 text-slate-600">
                Move between levels in the left sidebar. The dot tells you where you stand:
              </p>
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                <Legend dot={DOT.ready}>ready — the level above carries enough weight</Legend>
                <Legend dot={DOT.nudge}>
                  not ready — select it to see exactly what is missing
                </Legend>
                <Legend dot={DOT.locked}>locked — Plotter mode only</Legend>
              </ul>

              <ol className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {LEVELS.map(([name, description], index) => (
                  <li key={name} className="flex items-start gap-4 px-5 py-4">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">{name}</h3>
                      <p className="mt-0.5 text-sm leading-6 text-slate-600">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="mt-4 text-sm leading-6 text-slate-500">
                <strong className="font-medium text-slate-700">Places</strong> sits below the
                eight under <em>Reference</em>. Locations never gate a level — but linking
                scenes to them is what makes continuity checking possible.
              </p>
            </Section>

            <Section id="links" eyebrow="04" title="Connect the plan to the draft">
              <p className="text-sm leading-6 text-slate-600">
                The links you make are what the tool reasons over. Assign a chapter to an act
                and declare the beats it fulfils; in a scene's details, connect its beat,
                thread, POV character, and the arc stage it advances.
              </p>
              <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-5">
                <h3 className="text-sm font-semibold text-sky-950">
                  Example — a betrayal scene
                </h3>
                <p className="mt-2 text-sm leading-6 text-sky-900">
                  Your protagonist learns an ally has betrayed them. Link the scene to the{' '}
                  <strong className="font-medium">Midpoint</strong> beat, the main thread, and
                  the character's <em>trust → doubt</em> arc stage. The chapter brief then
                  states what that chapter owes the story — computed, never typed twice.
                </p>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                Drag a chapter or scene to reorder it, or drag a scene into another chapter.
                Deleting takes two clicks — the <span aria-hidden>×</span> arms it, the second
                confirms.
              </p>
            </Section>

            <Section id="time" eyebrow="05" title="Story time and flashbacks">
              <p className="text-sm leading-6 text-slate-600">
                Two fields in a scene's details do more work than they look like they do.
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <article className="rounded-xl border border-slate-200 bg-white p-5">
                  <h3 className="text-sm font-semibold">Story time</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    A plain number ordering events in the world, not in the telling. Any scale
                    works — 10, 20, 30 — because only the order matters. A free-text time label
                    ("Saturday, midnight") is for you to read.
                  </p>
                </article>
                <article className="rounded-xl border border-violet-200 bg-violet-50/60 p-5">
                  <h3 className="text-sm font-semibold text-violet-950">Flashback</h3>
                  <p className="mt-2 text-sm leading-6 text-violet-900">
                    Mark a scene that deliberately jumps backwards. Without it, the tool reads
                    an earlier story time later in the book as a contradiction — so an unmarked
                    flashback gets reported as a mistake.
                  </p>
                </article>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                Fill both in and the contradiction checks come alive: a character in two places
                at one story time, or an arc moving backwards. Leave them empty and the tool
                stays quiet rather than guessing. Open{' '}
                <strong className="font-medium text-slate-900">Story timeline</strong> above the
                levels to see events with their people and locations. World time follows when
                events happen; Reading order follows when they are told. A late confession can
                reveal an early event without moving it in world time.
              </p>
            </Section>

            <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5">
              <h2 className="text-lg font-semibold">Chat with your story assistant</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Connect an OpenRouter, Claude, or OpenAI API key in Settings, open a story, and choose Story assistant. Discuss ideas and answer its questions, then ask it to populate characters, arcs, beats, chapters, scenes, places, or timeline events. It remembers the recent conversation and reads your current story.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">Advice is saved in the chat. Proposed edits appear under Review story changes; inspect them and choose Apply changes to fill your story. Follow up to revise the plan. Applied changes can be undone before later edits.</p>
              <h2 className="mt-6 text-lg font-semibold">Why an entry says “placeholder”</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">A completeness badge is automatic: it means required details are missing. Click the badge to see the exact fields. Characters need a name, role, want, and need; beats need a label and description; scenes need goal, conflict, outcome, and POV. Fill the fields on the entry's card and the badge updates when saved.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">Chapters and scenes also have a separate Draft status that you choose: placeholder, outlined, drafted, or revised. Open Chapter details or Scene details and links to change it. A complete outline can still have Draft status “placeholder”; a drafted scene can still be missing planning details.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">Try the original Last Lantern tutorial in your library. It contains a worked character arc, a flashback, and one clearly labeled practice placeholder you can fill yourself.</p>
            </section>
            <Section id="feedback" eyebrow="06" title="What the tool tells you">
              <p className="text-sm leading-6 text-slate-600">
                Four kinds of feedback, deliberately distinct. A guess is never presented with
                the authority of a proof.
              </p>
              <ul className="mt-5 space-y-3">
                {FEEDBACK.map((item) => (
                  <li
                    key={item.label}
                    className={`rounded-lg border-l-4 px-4 py-3 ${item.tone}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`size-2 rounded-full ${item.swatch}`} />
                      <h3 className="text-sm font-semibold">{item.label}</h3>
                      <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                        {item.kind}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-slate-700">{item.text}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm leading-6 text-slate-500">
                None of it rewrites your draft or changes your structure. Treat it as a list
                for your next pass, not a checklist to clear.
              </p>
            </Section>

            <Section id="writing" eyebrow="07" title="Writing, reading, exporting">
              <div className="grid gap-5 sm:grid-cols-2">
                <Item title="Draft in the editor">
                  Open Scenes, pick a scene, write. Prose is Markdown and autosaves as you
                  type. The rail beside it keeps the goal, conflict, outcome and chapter
                  context in view.
                </Item>
                <Item title="Annotate a line">
                  Select text and choose <strong className="font-medium">Annotate
                  selection</strong> to leave a note on it. Notes follow the sentence as you
                  edit; if the text goes, the note is kept and flagged rather than silently
                  moved.
                </Item>
                <Item title="Define your places">
                  Under Reference, give locations a description and atmosphere, then link
                  scenes to them. Places shows where each one appears and who was there.
                </Item>
                <Item title="Ask the tool to read">
                  In Noticed, choose <strong className="font-medium">read prose</strong>. The
                  panel names the active reader; with no model configured it matches names
                  only. Observations you dismiss stay dismissed.
                </Item>
                <Item title="Track progress">
                  The header shows total words and how many scenes are drafted. Word counts
                  come from the prose, so they are always current.
                </Item>
                <Item title="Take the words with you">
                  <strong className="font-medium">Export .md</strong> compiles the manuscript
                  in reading order. Undrafted chapters are marked rather than skipped, so the
                  export doubles as a to-do list.
                </Item>
              </div>
            </Section>
          </div>
        </div>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-6">
          <p className="text-sm text-slate-500">
            Start with what you know. Build the rest as the story grows.
          </p>
          <Link
            to="/"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Open your stories →
          </Link>
        </footer>
      </div>
    </main>
  )
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-8">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        {eyebrow}
      </p>
      <h2 id={`${id}-heading`} className="mt-1 text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Legend({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      {children}
    </li>
  )
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-slate-600">{children}</p>
    </article>
  )
}
