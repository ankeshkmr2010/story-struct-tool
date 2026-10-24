import type { ChapterBrief } from '../api/client'
import { t } from '../i18n'
import { valueLabel } from '../i18n/server'

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
    <div className="brief-row grid grid-cols-[150px_1fr] gap-3 py-1.5">
      <dt className="field-label">{label}</dt>
      <dd className="text-sm text-slate-800 dark:text-slate-100">{children}</dd>
    </div>
  )
}

const Unset = ({ children }: { children: React.ReactNode }) => (
  <span className="text-sm text-slate-400 italic">{children}</span>
)

export function ChapterBriefCard({ brief }: { brief: ChapterBrief }) {
  return (
    <div className="brief-card rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="section-title">
          {t('Chapter {0}', brief.number)}
          {brief.title && <span className="font-normal text-slate-500 dark:text-slate-400"> — {brief.title}</span>}
        </h3>
        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-300">
          {valueLabel(brief.status)}
        </span>
      </div>

      <dl className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        <Row label={t('Act')}>
          {brief.act_number ? (
            <>
              {brief.act_number}
              {brief.act_title && ` — ${brief.act_title}`}
            </>
          ) : (
            <Unset>{t('not assigned to an act')}</Unset>
          )}
        </Row>

        <Row label={t('Beats to fulfil')}>
          {brief.beats.length === 0 ? (
            <Unset>{t('none — this chapter owes nothing')}</Unset>
          ) : (
            <ul className="space-y-1">
              {brief.beats.map((beat) => (
                <li key={beat.beat_id} className="flex items-center gap-2">
                  <span
                    className={
                      beat.is_fulfilled ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'
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

        <Row label={t('Arc advancing')}>
          {brief.arcs_advancing.length === 0 ? (
            <Unset>{t('no scenes advance an arc here')}</Unset>
          ) : (
            <ul className="space-y-0.5">
              {brief.arcs_advancing.map((arc) => (
                <li key={arc.arc_id}>{arc.summary.replace('->', '→')}</li>
              ))}
            </ul>
          )}
        </Row>

        <Row label={t('Thread')}>
          {brief.threads.length === 0 ? (
            <Unset>{t('no thread')}</Unset>
          ) : (
            brief.threads.join(', ')
          )}
        </Row>

        <Row label={t('Emotional shift')}>
          {brief.emotional_shift_from || brief.emotional_shift_to ? (
            <>
              {brief.emotional_shift_from ?? '?'} → {brief.emotional_shift_to ?? '?'}
              {brief.emotional_shift_inherited && (
                <span className="ml-2 text-xs text-slate-400">{t('inherited from act')}</span>
              )}
            </>
          ) : (
            <Unset>{t('none recorded')}</Unset>
          )}
        </Row>

        <Row label={t('POV')}>
          {brief.pov_character_name ?? <Unset>{t('no POV character')}</Unset>}
        </Row>

        <Row label={t('Scenes')}>
          {brief.scenes.length === 0 ? (
            <Unset>{t('no scenes yet')}</Unset>
          ) : (
            <>
              {t('{0} scene{1}', brief.scenes.length, brief.scenes.length === 1 ? '' : t('s'))}
              {brief.placeholder_scene_count > 0 && (
                <span className="text-slate-500 dark:text-slate-400">
                  {t('{0}· {1} placeholder{2}', ' ', brief.placeholder_scene_count, brief.placeholder_scene_count === 1 ? '' : t('s'))}
                </span>
              )}
              <ul className="mt-1.5 space-y-0.5">
                {brief.scenes.map((scene) => (
                  <li key={scene.scene_id} className="flex items-center gap-2 text-xs">
                    <span className={scene.is_complete ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>
                      {scene.is_complete ? '✓' : '○'}
                    </span>
                    <span className="text-slate-700 dark:text-slate-200">{scene.title ?? t('untitled')}</span>
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
