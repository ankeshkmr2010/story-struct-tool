import { Link } from 'react-router-dom'

/** The thank-you page. Wording is the author's own; keep it as written. */

const SHOUTOUTS: readonly { name: string; thanks: string; colour: string; mark: string }[] = [
  {
    name: 'Madam Stuti Dutta',
    thanks: 'The wife (for health and legal reasons she has to be first). Great feedback and encouragement.',
    colour: 'from-rose-500 via-fuchsia-500 to-violet-600',
    mark: '👑',
  },
  {
    name: 'Nikhil Doshi',
    thanks: 'The first reviewer. He actually wrote something.',
    colour: 'from-amber-400 via-orange-500 to-rose-500',
    mark: '✍️',
  },
  {
    name: 'Saransh Sharma',
    thanks: 'The most “author” review.',
    colour: 'from-emerald-400 via-teal-500 to-cyan-600',
    mark: '📚',
  },
  {
    name: 'Hena Varma',
    thanks: 'For the very encouraging and positive feedback and comprehensive feedback.',
    colour: 'from-sky-400 via-blue-500 to-indigo-600',
    mark: '🌟',
  },
  {
    name: 'Ananya',
    thanks: 'The positive vibes.',
    colour: 'from-lime-400 via-green-500 to-emerald-600',
    mark: '✨',
  },
  {
    name: 'Aditya Bhatia',
    thanks:
      'The first person I bounced this idea off. (Last on the list: he has the most time and still hasn’t reviewed it.)',
    colour: 'from-slate-500 via-slate-600 to-slate-800',
    mark: '⏳',
  },
]

export default function Shoutouts() {
  return (
    <main className="min-h-screen bg-linear-to-br from-rose-50 via-amber-50 to-sky-50 text-slate-900 dark:from-slate-950 dark:via-violet-950 dark:to-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        <header className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-fuchsia-600 dark:text-fuchsia-300">
            Thank you
          </p>
          <h1 className="mt-3 bg-linear-to-r from-rose-500 via-amber-500 to-sky-500 bg-clip-text text-5xl font-black tracking-tight text-transparent sm:text-7xl">
            Shoutouts
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-slate-700 dark:text-slate-300">
            StoryTool exists because these people read it, used it and told me the truth.
          </p>
        </header>

        <ul className="mt-12 grid gap-5 sm:grid-cols-2">
          {SHOUTOUTS.map((person, index) => (
            <li
              key={person.name}
              className={`relative overflow-hidden rounded-3xl bg-linear-to-br ${person.colour} p-6 text-white shadow-xl transition-transform hover:-translate-y-1 sm:p-8 ${index === 0 ? 'sm:col-span-2 sm:p-10' : ''}`}
            >
              <span aria-hidden="true" className="absolute -right-4 -top-6 text-8xl opacity-25 sm:text-9xl">
                {person.mark}
              </span>
              <p className="text-sm font-bold uppercase tracking-widest text-white/80">#{index + 1}</p>
              <h2 className={`mt-2 font-black tracking-tight ${index === 0 ? 'text-4xl sm:text-5xl' : 'text-3xl'}`}>
                {person.name}
              </h2>
              <p className={`mt-3 leading-relaxed text-white/95 ${index === 0 ? 'text-xl' : 'text-lg'}`}>
                {person.thanks}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-12 text-center text-sm text-slate-600 dark:text-slate-400">
          <Link to="/" className="underline underline-offset-4 hover:text-slate-900 dark:hover:text-slate-100">
            ← Back to StoryTool
          </Link>
        </p>
      </div>
    </main>
  )
}
