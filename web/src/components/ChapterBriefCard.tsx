import type { ChapterBrief } from '../api/client'

/**
 * The Chapter Context Brief, laid out as the design document specified:
 *
 *   Chapter 7
 *   Act: Two — Confrontation
 *   Beat to fulfil: "All Is Lost"
 *   Character arc advancing: Maya (denial → acceptance)
 *   Thread: A-story
 *   Emotional shift: hope → despair
 *   Scenes: 3 placeholders
 *
 * Not one line of this is typed at chapter level — it is all traversal of upward
 * references, which is why an empty chapter still opens with something to say.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{children}</dd>
    </div>
  )
}

const Unset = ({ children }: { children: React.ReactNode }) => (
  <span className="text-sm text-slate-400 italic">{children}</span>
)

export function ChapterBriefCard({ brief }: { brief: ChapterBrief }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-slate-900">
          Chapter {brief.number}
          {brief.title && <span className="font-normal text-slate-500"> — {brief.title}</span>}
        </h3>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
          {brief.status}
        </span>
      </div>

      <dl className="mt-3 divide-y divide-slate-100">
        <Row label="Act">
          {brief.act_number ? (
            <>
              {brief.act_number}
              {brief.act_title && ` — ${brief.act_title}`}
            </>
          ) : (
            <Unset>not assigned to an act</Unset>
          )}
        </Row>

        <Row label="Beats to fulfil">
          {brief.beats.length === 0 ? (
            <Unset>none — this chapter owes nothing</Unset>
          ) : (
            <ul className="space-y-1">
              {brief.beats.map((beat) => (
                <li key={beat.beat_id} className="flex items-center gap-2">
                  <span
                    className={
                      beat.is_fulfilled ? 'text-emerald-600' : 'text-amber-600'
                    }
                  >
                    {beat.is_fulfilled ? '✓' : '○'}
                  </span>
                  <span>“{beat.label}”</span>
                </li>
              ))}
            </ul>
          )}
        </Row>

        <Row label="Arc advancing">
          {brief.arcs_advancing.length === 0 ? (
            <Unset>no scenes advance an arc here</Unset>
          ) : (
            <ul className="space-y-0.5">
              {brief.arcs_advancing.map((arc) => (
                <li key={arc.arc_id}>{arc.summary.replace('->', '→')}</li>
              ))}
            </ul>
          )}
        </Row>

        <Row label="Thread">
          {brief.threads.length === 0 ? (
            <Unset>no thread</Unset>
          ) : (
            brief.threads.join(', ')
          )}
        </Row>

        <Row label="Emotional shift">
          {brief.emotional_shift_from || brief.emotional_shift_to ? (
            <>
              {brief.emotional_shift_from ?? '?'} → {brief.emotional_shift_to ?? '?'}
              {brief.emotional_shift_inherited && (
                <span className="ml-2 text-xs text-slate-400">inherited from act</span>
              )}
            </>
          ) : (
            <Unset>none recorded</Unset>
          )}
        </Row>

        <Row label="POV">
          {brief.pov_character_name ?? <Unset>no POV character</Unset>}
        </Row>

        <Row label="Scenes">
          {brief.scenes.length === 0 ? (
            <Unset>no scenes yet</Unset>
          ) : (
            <>
              {brief.scenes.length} scene{brief.scenes.length === 1 ? '' : 's'}
              {brief.placeholder_scene_count > 0 && (
                <span className="text-slate-500">
                  {' '}
                  · {brief.placeholder_scene_count} placeholder
                  {brief.placeholder_scene_count === 1 ? '' : 's'}
                </span>
              )}
              <ul className="mt-1.5 space-y-0.5">
                {brief.scenes.map((scene) => (
                  <li key={scene.scene_id} className="flex items-center gap-2 text-xs">
                    <span className={scene.is_complete ? 'text-emerald-600' : 'text-amber-600'}>
                      {scene.is_complete ? '✓' : '○'}
                    </span>
                    <span className="text-slate-700">{scene.title ?? 'untitled'}</span>
                    <span className="text-slate-400">{scene.type}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Row>
      </dl>
    </div>
  )
}
