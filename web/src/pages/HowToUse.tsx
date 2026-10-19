import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { WriteWithAI } from '../components/WriteWithAI'

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
  locked: 'bg-slate-300 dark:bg-slate-600',
}

const SECTIONS = [
  ['start', 'First five minutes'],
  ['search', 'Search your stories'],
  ['modes', 'How you work'],
  ['levels', 'The eight levels'],
  ['links', 'Linking plan to draft'],
  ['time', 'Story time and flashbacks'],
  ['feedback', 'What the tool tells you'],
  ['writing', 'Write, Focus, and exporting'],
  ['images', 'Images and illustrations'],
  ['sharing', 'Sharing and reading stories'],
  ['beta-readers', 'Beta readers, feedback and polls'],
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
    description: 'Levels past the first unready one are dimmed until the structure above them is ready; you can still open them.',
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
    tone: 'border-amber-400 bg-amber-50 dark:bg-amber-950',
    swatch: 'bg-amber-400',
    kind: 'Gaps',
    text: 'Structure you have not built yet — a beat nothing fulfils, a character with no want. Normal mid-draft, not errors.',
  },
  {
    label: 'Continuity · contradiction',
    tone: 'border-red-400 bg-red-50 dark:bg-red-950',
    swatch: 'bg-red-400',
    kind: 'Proven',
    text: 'The draft disagrees with itself: a character in two places at one story time, an on-page event with no scene. Stated as fact, because it is provable.',
  },
  {
    label: 'Continuity · possible',
    tone: 'border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950',
    swatch: 'bg-violet-400',
    kind: 'A question',
    text: 'A model read something that does not match your links. Shown with its confidence and phrased as a question, because it may be wrong.',
  },
  {
    label: 'Noticed',
    tone: 'border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950',
    swatch: 'bg-sky-400',
    kind: 'Observations',
    text: 'What a reading pass found in your prose — a character in six scenes with no arc, a thread gone quiet. Dismiss any of them permanently.',
  },
] as const

export default function HowToUse() {
  const location = useLocation()
  const navigate = useNavigate()
  const isAIHash = (hash: string) => hash === '#write-with-ai' || hash === '#mcp' || hash.startsWith('#ai-')
  const [tab, setTab] = useState<'basics' | 'ai'>(() => isAIHash(location.hash) ? 'ai' : 'basics')
  useEffect(() => { if (location.hash) setTab(isAIHash(location.hash) ? 'ai' : 'basics') }, [location.hash])
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">

        <header className="mt-4 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            How to use StoryTool
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Turn an idea into a story you can follow.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-600 dark:text-slate-300">
            StoryTool holds the shape of your story so you don't have to keep it all in your
            head. Each level scaffolds the next, so a chapter opens already knowing which act
            it sits in and which beat it owes.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Write on your own or with your connected AI. StoryTool keeps the structure
            close at hand, points out gaps, and leaves every change in your control.
          </p>
        </header>

        <div className="history-tabs mt-8" role="tablist" aria-label="How to use guides" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'basics' : event.key === 'End' ? 'ai' : tab === 'ai' ? 'basics' : 'ai'
          setTab(next); navigate(next === 'ai' ? '#write-with-ai' : '#guide-basics'); document.getElementById(`guide-tab-${next}`)?.focus()
        }}>
          <button id="guide-tab-basics" type="button" role="tab" aria-selected={tab === 'basics'} aria-controls="guide-basics" tabIndex={tab === 'basics' ? 0 : -1} onClick={() => { setTab('basics'); navigate('#guide-basics') }}>Use StoryTool</button>
          <button id="guide-tab-ai" type="button" role="tab" aria-selected={tab === 'ai'} aria-controls="write-with-ai" tabIndex={tab === 'ai' ? 0 : -1} onClick={() => { setTab('ai'); navigate('#write-with-ai') }}>Write with AI</button>
        </div>
        <section id="write-with-ai" role="tabpanel" aria-labelledby="guide-tab-ai" hidden={tab !== 'ai'}>{tab === 'ai' && <WriteWithAI />}</section>
        <div id="guide-basics" role="tabpanel" aria-labelledby="guide-tab-basics" hidden={tab !== 'basics'}>
        <div className="mt-12 gap-10 lg:grid lg:grid-cols-[180px_minmax(0,1fr)]">
          {/* Sticky contents: the page is long enough that a reader needs a way back. */}
          <nav
            aria-label="Contents"
            className="mb-8 lg:mb-0 lg:sticky lg:self-start"
            style={{ top: 'calc(var(--site-header-height, 73px) + 20px)' }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Contents
            </p>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 lg:flex-col lg:gap-1">
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-sm text-slate-500 dark:text-slate-400 underline-offset-4 hover:text-slate-900 dark:hover:text-slate-100 hover:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-14">
            <Section id="start" eyebrow="01" title="Your first five minutes">
              <ol start={1} className="list-none space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {[
                  <>Sign in with Google. Your library belongs to your account.</>,
                  <>
                    Open Your stories, type a title, choose{' '}
                    <strong className="font-medium text-slate-900 dark:text-slate-100">Create</strong>, and open
                    the story.
                  </>,
                  <>Pick an authoring mode in <strong className="font-medium">Design → Plan → Premise</strong> — Hybrid is the default.</>,
                  <>Open <strong className="font-medium">Write</strong>, add an optional chapter title, and start typing. You don’t need to name a scene first.</>,
                  <>Use <strong className="font-medium">Design</strong> for your premise, protagonist, outline, and timeline. Come back to structure whenever useful; half-filled entries are fine.</>,
                ].map((step, index) => (
                  <li key={index} value={index + 1} className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-fit shrink-0 items-center rounded bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white dark:bg-slate-200 dark:text-slate-950">
                      Step {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </Section>

            <Section id="search" eyebrow="SEARCH" title="Find a line or an idea">
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Open Search in Your stories to search across your library, or use a story's search control for its current context. Type a name, phrase or idea, then use Type and Field to narrow the results. Open a result to jump to its scene or Plan entry.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Text matches find names and phrases. When enabled, meaning search adds related matches based on ideas rather than exact words; these are labeled Related. Results can take time to appear while a story is being indexed.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Meaning search sends scene text, story details and search queries to Cloudflare for embeddings while enabled. <Link to="/privacy#meaning-search-title" className="underline">Read the privacy details →</Link></p>
            </Section>

            <Section id="modes" eyebrow="02" title="Choose how you work">
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                All three modes read the same story — the mode only decides how firmly the
                sidebar holds you to the order. Switch from Design → Plan → Premise;
                nothing you have written changes.
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {MODES.map((mode) => (
                  <article
                    key={mode.name}
                    className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${DOT[mode.status]}`} />
                      <h3 className="font-semibold">{mode.name}</h3>
                      {mode.name === 'Hybrid' && (
                        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          default
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                      {mode.tagline}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{mode.description}</p>
                    <p className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4 text-sm leading-6 text-slate-800 dark:text-slate-100">
                      {mode.start}
                    </p>
                  </article>
                ))}
              </div>
            </Section>

            <Section id="levels" eyebrow="03" title="Build the structure in eight levels">
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                Move between levels in the left sidebar. The dot tells you where you stand:
              </p>
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
                <Legend dot={DOT.ready}>ready — the level above carries enough weight</Legend>
                <Legend dot={DOT.nudge}>
                  not ready — select it to see exactly what is missing
                </Legend>
                <Legend dot={DOT.locked}>dimmed — Plotter mode, past the first unready level; still opens</Legend>
              </ul>

              <ol className="mt-5 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                {LEVELS.map(([name, description], index) => (
                  <li key={name} className="flex items-start gap-4 px-5 py-4">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">{name}</h3>
                      <p className="mt-0.5 text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">
                <strong className="font-medium text-slate-700 dark:text-slate-200">Places</strong> sits below the
                eight under <em>Reference</em>. Locations never gate a level — but linking
                scenes to them is what makes continuity checking possible.
              </p>
            </Section>

            <Section id="links" eyebrow="04" title="Connect the plan to the draft">
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                The links you make are what the tool reasons over. Assign a chapter to an act
                and declare the beats it fulfils; in a scene's details, connect its beat,
                thread, POV character, and the arc stage it advances.
              </p>
              <div className="mt-5 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 p-5">
                <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-300">
                  Example — a betrayal scene
                </h3>
                <p className="mt-2 text-sm leading-6 text-sky-900 dark:text-sky-300">
                  Your protagonist learns an ally has betrayed them. Link the scene to the{' '}
                  <strong className="font-medium">Midpoint</strong> beat, the main thread, and
                  the character's <em>trust → doubt</em> arc stage. The chapter brief then
                  states what that chapter owes the story — computed, never typed twice.
                </p>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Drag a chapter or scene to reorder it, or drag a scene into another chapter.
                Deleting takes two clicks — the <span aria-hidden>×</span> arms it, the second
                confirms.
              </p>
            </Section>

            <Section id="time" eyebrow="05" title="Story time and flashbacks">
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                Two fields in a scene's details do more work than they look like they do.
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <article className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                  <h3 className="text-sm font-semibold">Story time</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    A plain number ordering events in the world, not in the telling. Any scale
                    works — 10, 20, 30 — because only the order matters. A free-text time label
                    ("Saturday, midnight") is for you to read.
                  </p>
                </article>
                <article className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/60 p-5">
                  <h3 className="text-sm font-semibold text-violet-950 dark:text-violet-300">Flashback</h3>
                  <p className="mt-2 text-sm leading-6 text-violet-900 dark:text-violet-300">
                    Mark a scene that deliberately jumps backwards. Without it, the tool reads
                    an earlier story time later in the book as a contradiction — so an unmarked
                    flashback gets reported as a mistake.
                  </p>
                </article>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Fill both in and the contradiction checks come alive: a character in two places
                at one story time, or an arc moving backwards. Leave them empty and the tool
                stays quiet rather than guessing. Open{' '}
                <strong className="font-medium text-slate-900 dark:text-slate-100">Story timeline</strong> above the
                levels to see events with their people and locations. World time follows when
                events happen; Reading order follows when they are told. A late confession can
                reveal an early event without moving it in world time.
              </p>
            </Section>

            <section className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/50 p-5">
              <h2 className="text-lg font-semibold">Save and restore the whole story</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Open Versions beside Export in a story's header. A named version captures prose, structure, characters, arcs, locations, timeline, notes, and their links together. Automatic editing checkpoints are saved at most once per minute; the latest 50 are kept. Named and recovery versions are retained. Deleting a story asks for confirmation and moves it to Trash, keeping all contents and versions. Open Trash in your library and select Restore to bring it back. Delete permanently requires a separate confirmation and typing DELETE; it removes the story and version history from the database and cannot be undone in StoryTool.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Select a version to preview its differences from the working draft, then choose Restore this version. The tool first saves a recovery checkpoint. If another edit happens after the preview, refresh the preview before restoring. Account settings, provider keys, and AI conversation history stay separate.</p>
              <h2 className="mt-6 text-lg font-semibold">Chat with your story assistant</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Connect an OpenRouter, Claude, or OpenAI API key in Settings, open a story, and choose Story assistant. Discuss ideas and answer its questions, then ask it to populate characters, arcs, beats, chapters, scenes, places, or timeline events. It remembers the recent conversation and reads your current story.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Advice is saved in the chat. Proposed edits appear under Review story changes; inspect them and choose Apply changes to fill your story. Follow up to revise the plan. Applied changes can be undone before later edits.</p>
              <h2 className="mt-6 text-lg font-semibold">Keep reference material in its own fields</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">In Premise, open World, style, theme, and notes. World rules, style rules, motifs, and the thematic statement stay separate from the one-sentence premise. Characters have description, aliases, relation to the protagonist, and private notes; scene notes stay separate from scene summaries. Private notes are not shared or imported.</p>
              <h2 className="mt-6 text-lg font-semibold">See who changed a field</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Open Authorship in the story header for field-level history. Author, app assistant, external MCP client, import, undo, and version restore are labelled separately. Older untracked text has unknown authorship. Planned beats and unwritten on-page events are planning information, not contradictions.</p>
              <h2 className="mt-6 text-lg font-semibold">Why an entry says “placeholder”</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">A completeness badge is automatic: it means required details are missing. Click the badge to see the exact fields. Characters need a name and role; protagonists, antagonists, and positive/negative arcs also need want and need. Wounds are optional; beats need a label and description; scenes need goal, conflict, outcome, and POV. Fill the fields on the entry's card and the badge updates when saved.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Chapters and scenes also have a separate Draft status that you choose: placeholder, outlined, drafted, or revised. Open Chapter details or Scene details and links to change it. A complete outline can still have Draft status “placeholder”; a drafted scene can still be missing planning details.</p>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Try the original Last Lantern tutorial in your library. It contains a worked character arc, a flashback, and one clearly labeled practice placeholder you can fill yourself.</p>
            </section>
            <Section id="feedback" eyebrow="06" title="What the tool tells you">
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
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
                      <span className="rounded bg-white/70 dark:bg-slate-900/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        {item.kind}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-slate-700 dark:text-slate-200">{item.text}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">
                None of it rewrites your draft or changes your structure. Treat it as a list
                for your next pass, not a checklist to clear.
              </p>
            </Section>

            <Section id="sharing" eyebrow="07" title="Share a story, keep control of your draft">
              <div className="grid gap-5 sm:grid-cols-2">
                <Item title="Share an individual story">Choose Share on a library card or in the story header. Enter the recipient’s StoryTool sign-in email. Read only is the default; choose Read and import a copy if you want them to have an editable independent draft. Copy the reader link and send it yourself. No email is sent automatically.</Item>
                <Item title="Read stories shared with you">Open Shared with you in your library, or follow the reader link while signed in with the authorized email. The separate reader shows the manuscript with chapter navigation and a timeline. Context shows linked beats, arc stages, characters, and places without editing controls.</Item>
                <Item title="Import only when permitted">If the author allows it, choose Import a copy and confirm. The copy includes current prose, structure, arcs, and timeline links, starts its own version history, and belongs to your account. Changes to either draft do not sync. Past versions and AI conversations aren’t shared or imported.</Item>
                <Item title="Change or revoke access">Open Share again to change a recipient’s permission or revoke access. The reader shows the author’s current saved draft; Refresh story loads newer changes. Moving the original to Trash hides it from recipients until restored. Revoking or deleting the original does not remove copies already imported.</Item>
              </div>
              <h3 id="beta-readers" className="mt-8 scroll-mt-24 text-xl font-semibold">Beta readers, feedback and polls</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Choose Beta readers beside Share on a library card or in the story header. Reader management and feedback come first; Beta polls is below them on the same page.</p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <Item title="Publish a manuscript round">Give the round a title and reader brief, choose all or selected chapters, and optionally set a deadline. Publish saved draft freezes that manuscript for the round while you continue writing. Readers see the manuscript and brief; planning details, AI conversations and other readers’ private feedback stay hidden. The deadline is guidance, not an automatic lock.</Item>
                <Item title="Invite and manage readers">Copy the invitation link and send it yourself; StoryTool does not send an email. Anyone with it must sign in and request your approval by default. Enable automatic admission if you prefer. Approved rounds appear under Shared with you. Disable or rotate the invitation without removing admitted readers, or revoke a reader’s access separately. Closing a round stops new feedback and votes while existing feedback stays readable.</Item>
                <Item title="Have a private feedback conversation">Readers select a passage and click the small comment icon beside it, or right-click a paragraph and choose Comment on selected text or Comment on this scene. Leave feedback in the header covers a chapter or the whole story. Save a private draft or send it to the author. My feedback and polls keeps conversations reachable; each has a protected URL showing the quoted passage and replies. Readers see their own threads and author replies; authors can mark feedback addressed or reopen it. Readers may also share their chapter progress and reading status.</Item>
                <Item title="Create polls and see results">Under Beta polls, create a question for a round or chapter with one-choice, multiple-choice or written answers. Manage draft, open, closed and archived polls, edit or delete them, and see results. Each reader has one response, editable while open. Choose identified or name-hidden answers; readers see results only if enabled, after answering or closing. Changing questions or options after responses creates a new version. Archive preserves results; permanent deletion asks for confirmation.</Item>
                <Item title="Work through feedback in your story">Open conversations collect in the Feedback tab of the story’s side panel, in reading order, with the count on Beta readers buttons. Show in Write jumps to the quoted passage; a small marker sits beside quoted lines in Write and opens the matching card. Mark addressed or Reopen from the card, or open the full conversation.</Item>
                <Item title="Bring AI into beta reading">With the Draft replies to beta readers permission, your connected AI can read open feedback and round progress (readers appear as anonymous labels), save draft replies that only you see until you send them, and mark feedback addressed. Turn on Let readers connect their own AI on a round and approved readers can connect their AI to that round only: its frozen chapters, their own comments and your polls, read-only. Turning it off or removing a reader cuts their AI off at once.</Item>
              </div>
            </Section>

            <Section id="writing" eyebrow="08" title="Write, Design, and your writing flow">
              <div className="grid gap-5 sm:grid-cols-2">
                <Item title="Draft in the editor">
                  Open a story’s <strong className="font-medium">Write</strong> tab and start
                  typing. A chapter’s scenes appear together on one scrolling manuscript.
                  Chapter titles and scene names are optional. Add a scene break at the end
                  or continue into the next chapter. Prose is Markdown and autosaves; Context
                  opens scene details and the chapter brief, while Focus hides the surrounding
                  controls. The <strong className="font-medium">Design</strong> tab keeps the
                  full planning workspace. Both tabs edit the same story.
                </Item>
                <Item title="Switch between Write, Read, and Design">
                  All three tabs use the same chapters, scenes, and prose. Each story reopens
                  where you left off on any device: the same tab, chapter and position, and Your
                  stories offers a Pick up where you left off card. Write saves pending prose before
                  you switch tabs or chapters; if saving fails, resolve the error first.
                  Write is available in Plotter, Pantser, and Hybrid.
                </Item>
                <Item title="Read continuously or turn pages">
                  Open Read to experience your saved story without editing. Every chapter and
                  scene stays in reading order in one manuscript. Choose Continuous scroll or
                  Pages. In Pages, use Previous/Next, click the page edges, or focus the reading
                  area and use arrow keys or Page Up/Down. Chapters and linked timeline events
                  jump to passages without replacing the manuscript.
                </Item>
                <Item title="Set up a comfortable reading view">
                  Appearance controls font size, serif/sans font, spacing, text width, and
                  optional scene names. Pages reflow when these settings or the window size
                  change. Focus hides surrounding panels; Escape returns you. Settings and a
                  passage bookmark are remembered on this device. Shared stories use the same
                  reader while keeping the author’s permissions.
                </Item>
                <Item title="See edits from your LLM session">
                  StoryTool checks for changes every 15 seconds while the page is visible.
                  Changed chapters, scenes, beats, arcs, timeline, proposals, and prose refresh
                  automatically. Unsaved prose is preserved when a remote edit conflicts;
                  review the latest saved text before choosing which draft to keep. Saved
                  sort order is honored throughout the app; chapter-number and ID tie breakers
                  keep entries with equal order keys stable.
                </Item>
                <Item title="Enter Focus">
                  Choose <strong className="font-medium">Focus</strong> in the writing toolbar
                  for a full-screen manuscript with navigation and context hidden. Use
                  <strong className="font-medium"> Exit focus</strong> or Escape to return.
                  You can keep typing while focused; save status stays beside each passage.
                </Item>
                <Item title="Open Context when useful">
                  Click into a passage, then choose <strong className="font-medium">Context</strong>.
                  The panel shows its chapter brief and scene details: POV, characters,
                  location, goal, conflict, outcome, beats, threads, and arc stages.
                  On smaller screens, Context opens as a side panel; Chapters reveals your
                  chapter list. Close either to give the manuscript its full width.
                </Item>
                <Item title="Add scenes and chapters as you go">
                  You can write a whole chapter without naming scenes. Choose
                  <strong className="font-medium"> Scene break at end</strong> when you want
                  another scene, or <strong className="font-medium"> Next chapter</strong>
                  to continue. Titles can be changed in place. Existing unattached scenes
                  appear under Unfiled writing; scenes follow reading order, including flashbacks.
                </Item>
                <Item title="Delete a scene safely">
                  Choose Delete scene beside a passage in Write, or above Scene details in
                  Design. Confirm the deletion; Cancel keeps the scene. Unsaved prose must
                  save successfully first. Every deletion saves a whole-story recovery
                  version before removing the scene, plus a version of the result. Use
                  History in the Design rail to recover it; restoring a version restores
                  the whole story, including prose, notes, and structural links.
                </Item>
                <Item title="Recover a draft or resolve a conflict">
                  Wait for <strong className="font-medium">Saved</strong> before closing your
                  browser tab. Failed saves keep your draft in that tab for retry, including
                  after a reload. If another client changed a passage, choose Review latest
                  text, then explicitly keep your draft or use the latest saved text.
                  Browser-tab recovery is temporary: closing the tab can remove it, and
                  signing out clears it. Versions preserve saved story state separately.
                </Item>
                <Item title="Define your places">
                  Open Places in the side panel, give locations a description and atmosphere, then link
                  scenes to them. Places shows where each one appears and who was there.
                </Item>
                <Item title="Build your own writing checks">
                  Open <strong className="font-medium">Writing checks</strong> in your account dropdown. Choose whether to find a problem, count named characters or compare two things. For a character limit, define whether presence, speaking/acting or moving the action forward counts; merely arriving may not change the plot. Set the limit and write a practical next step. Keep sample passages under Examples, separate from advice.
                  <br /><br />
                  Choose what to highlight: contributing sentences are the default, with paragraph and whole-scene options. Try the rule on a sample before enabling it; inspect counted, excluded and uncertain names and compare with your expectation. The trial sends your sample, rule and examples to the shared reader using your reading allowance, without saving the rule or editing prose. Enable the saved check, then switch on Live hints in Write. Adjacent contributing sentences are grouped; an uncertain location falls back to a paragraph. Checks remain private and advisory.
                  <br /><br />
                  Your connected AI can create, read, edit, toggle and delete checks, or try a supplied sample through MCP, with your explicit writing-check permissions. It should supply the same recipe, counting criterion, examples and highlight preference used by the form.
                </Item>
                <Item title="Ask the tool to read">
                  Evaluate opens on an Overview: Run all runs every ready check at once and lists each check’s status, with an amber dot where there is something to look at. In a check, Run reads saved scenes with the shared reader and combines evidence for craft checks. Uncertain findings offer Verify with your AI or a copy-scene prompt; verification includes only the selected scenes and their relevant thread or protagonist-belief context, and native reports remain available on return. Missing coverage is shown explicitly. In Noticed, choose <strong className="font-medium">read prose</strong>. When the site-provided Jev reader is available, no personal AI connection is needed. The
                  panel names the active reader; with no model configured it matches names
                  only. Observations you dismiss stay dismissed.
                </Item>
                <Item title="Leave a TK and keep writing">
                  When a detail can wait, type <code>[TK]</code> or <code>[TK: name of the inn]</code> and carry on, or right-click and choose Add TK here (a selection becomes its note). Every placeholder is listed in the TKs tab of the side panel while you write and under Design → Placeholders, in reading order: open one, fill it in place or remove the marker. Export asks before a manuscript leaves with TKs still in it. Name consistency flags near-miss spellings of your character, place and glossary names (Maia for Maya); if a variant is intended, add it as an alias from the finding. Your connected AI can run both checks with run_story_check.
                </Item>
                <Item title="Disclose AI use">
                  In Design → History → Who wrote what, the AI-use disclosure card summarises saved edits to
                  prose and planning by you, connected AI clients and StoryTool’s assistant, with the AI tools
                  used and when tracking began. Copy it or download it as text for agents, publishers or contests.
                  It counts edits, not words, so check it before sending.
                </Item>
                <Item title="Track progress">
                  The header shows total words and how many scenes are drafted. Word counts
                  come from the prose, so they are always current.
                </Item>
                <Item title="Take the words with you">
                  Open <strong className="font-medium">Export ▾</strong> for Word (.docx), Markdown (.md),
                  EPUB, HTML, plain text or submission PDF. PDF uses double-spaced manuscript pages
                  and offers optional glossary, timeline and places appendices; it may reject characters
                  its fonts cannot display. Set your author name in Settings for the export byline.
                  Illustrations stay at their manuscript positions in Word, PDF, EPUB and HTML.
                  Markdown downloads a ZIP with the manuscript and image files when needed;
                  plain text keeps image descriptions and captions in place.
                  <strong className="font-medium"> Backup</strong> downloads
                  everything, including image files, notes and scene revisions; use Restore backup in your library to bring
                  it back as a new story.
                </Item>
                <Item title="Bring in existing prose">
                  In Your stories, choose <strong className="font-medium">Create ▾ → From Word (.docx)</strong> or{' '}
                  <strong className="font-medium">From Scrivener (.zip)</strong> (zip the whole .scriv folder first),{' '}
                  <strong className="font-medium">From Markdown or text</strong> or <strong className="font-medium">From EPUB</strong> (DRM-free).
                  StoryTool reads the file and shows what it found; you choose where chapters and scenes start (headings,
                  “Chapter” lines, *** separators, page breaks, or Scrivener folder levels), whether to skip a title page,
                  and whether synopses and notes come along, with a live preview. Or copy the prompt for your connected AI:
                  it can read the outline, plan exact breaks, titles and summaries, preview them and import once you approve.
                  The import window stays open through completion and offers prompts to organize
                  chapters/scenes or populate story components while preserving your prose.
                  Imported stories keep an <strong className="font-medium">Import prompts</strong> entry.
                </Item>
              </div>
            </Section>
            <Section id="images" eyebrow="IMAGES" title="Illustrations and reference images">
              <div className="space-y-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                <Item title="Upload and manage images">Open Images in the story header from Write, Read or Design. Upload a JPEG, PNG or WebP, give it a name, and add an image description (alt text) and optional caption. The dedicated Images page has All images, Manuscript, Reference and Unused filters. Select a named thumbnail to edit details or see every current use, with links to its chapter and scene or planning entry. Uploads show a preview and progress; Write and reference entries also offer pickers to reuse saved images. Large photos are resized in your browser to WebP at up to 2,400 px before upload; small images stay unchanged. Alt text is optional, with a gentle reminder for screen-reader and EPUB accessibility. Limits are 5 MB per saved image, 50 images and 100 MB per story; still images must be no larger than 20 megapixels.</Item>
                <Item title="Insert an illustration">In Write, right-click where the image belongs and choose Insert image. The compact picker keeps that position: click a saved thumbnail to insert it, or choose Upload new image and Upload & insert. Shift+F10 opens the same menu at the keyboard cursor; Cut, Copy, Paste and Select all are also available. Write shows a thumbnail at that position, with its name and caption. Click it for a larger preview; Remove deletes only that placement. The underlying marker is kept for saving and exports, and Read displays the illustration in place.</Item>
                <Item title="Keep reference art with your plan">Choose Add reference image on a character, place, glossary entry or scene. Select or upload an image, then choose Attach image. Reference attachments appear beside that item and stay outside manuscript exports unless you also insert the image into prose. Detach image removes only that attachment.</Item>
                <Item title="Preview while reading">Click an image in Read to open a larger preview with its caption. Close it with Close, Escape or the backdrop, or use Open original image to view the file separately. Images follow the story’s sharing permissions; beta rounds preserve the illustrations and captions published with that draft.</Item>
                <Item title="Delete current uses safely">In Images, select an image and choose Delete image. The confirmation shows how many manuscript placements and reference attachments will be removed. Pending writing saves first. Scene revisions and a recovery version preserve the previous state; historical files and existing beta rounds keep the image. Files kept for history still count toward the story’s limits. Permanently deleting the story queues its retained files for storage cleanup.</Item>
                <Item title="Try the image flow">In step 2 of the guided tour, choose Try inserting an image, or open Discover more and choose Images to edit a sample caption, preview the illustration, and try delete/restore. The sample HTML download includes the illustration in place; the text download keeps its description and caption.</Item>
              </div>
            </Section>
          </div>
        </div>

        </div>
        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 dark:border-slate-700 pt-6">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Start with what you know. Build the rest as the story grows.
          </p>
          <Link
            to="/library"
            className="rounded-md bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm font-medium text-white dark:text-slate-950 hover:bg-slate-700 dark:hover:bg-slate-300"
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
      <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-300">{children}</p>
    </article>
  )
}
