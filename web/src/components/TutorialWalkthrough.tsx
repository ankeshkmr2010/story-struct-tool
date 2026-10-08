export function TutorialWalkthrough({ onTimeline, onCharacters, onScenes, onPractice }: {
  onTimeline: () => void
  onCharacters: () => void
  onScenes: () => void
  onPractice: () => void
}) {
  return (
    <details open className="mt-5 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/40 p-4 sm:p-5">
      <summary className="cursor-pointer text-sm font-semibold text-sky-950 dark:text-sky-300">Learn with this story: timelines, arcs, and placeholders</summary>
      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        <section>
          <h2 className="text-sm font-semibold">1. Two orders, the same events</h2>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">The story opens at time 30 during the storm, then flashes back to yesterday's warning at time 10.</p>
          <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">World time: <strong>10 → 30 → 40 → 50 → 60 → 70</strong></p>
          <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">Reading order: <strong>30 → 10 → 40 → 50 → 60 → 70</strong></p>
          <button type="button" onClick={onTimeline} className="mt-3 text-xs font-medium text-sky-700 dark:text-sky-300 underline">Explore the two timelines →</button>
        </section>
        <section>
          <h2 className="text-sm font-semibold">2. An arc is a change in belief</h2>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">Mara wants to restore the light. She needs to trust Finn. Her arc moves from “I must do everything myself” to “We share responsibility.” Each scene advances a particular stage.</p>
          <div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={onCharacters} className="text-xs font-medium text-sky-700 dark:text-sky-300 underline">See Mara's arc →</button><button type="button" onClick={onScenes} className="text-xs font-medium text-sky-700 dark:text-sky-300 underline">See scene-to-stage links →</button></div>
        </section>
        <section>
          <h2 className="text-sm font-semibold">3. Details and draft status are separate</h2>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">The optional practice scene has a placeholder badge because its goal, conflict, outcome, and POV are empty. Fill those to change the badge automatically. Choose its Draft status separately.</p>
          <button type="button" onClick={onPractice} className="mt-3 text-xs font-medium text-sky-700 dark:text-sky-300 underline">Try the placeholder exercise →</button>
        </section>
      </div>
      <p className="mt-4 border-t border-sky-100 dark:border-sky-800 pt-3 text-xs text-slate-500 dark:text-slate-400">These are editable copies. Scene prose autosaves; outline fields save when you leave the field, and dropdown choices save immediately.</p>
    </details>
  )
}
