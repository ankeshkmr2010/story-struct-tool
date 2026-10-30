import { HelpTip } from './HelpTip'
import { t, tx } from '../i18n'

// Plain label, the craft term it stands for, a one-line definition and a tiny example
// (usability phase 1). One place, so every screen names these ideas the same way.
const TERMS = {
  value_shift: [tx('What changes in this scene'), tx('Value shift'), tx('Something important flips between the start and end of the scene.'), tx('Safe → in danger')],
  value_from: [tx('Starts as'), tx('Value shift'), tx('Something important flips between the start and end of the scene.'), tx('Safe → in danger')],
  value_to: [tx('Ends as'), tx('Value shift'), tx('Something important flips between the start and end of the scene.'), tx('Safe → in danger')],
  misbelief: [tx('Hero’s false belief'), tx('Misbelief'), tx('The wrong idea the character must unlearn.'), tx('“I must do everything myself.”')],
  wound: [tx('Old hurt'), tx('Wound'), tx('The past event that planted the false belief.'), tx('Asked for help once, and it cost them.')],
  want: [tx('What they chase'), tx('Want'), tx('The outward goal they pursue.'), tx('Fix the lantern before the storm.')],
  need: [tx('What they really need'), tx('Need'), tx('The inner change that would make them whole.'), tx('Learn to let others help.')],
  sequel_rhythm: [tx('Action and reaction rhythm'), tx('Scene and sequel'), tx('Action scenes followed by quieter scenes where the character reacts and decides.'), tx('The storm, then the long night after.')],
  reaction: [tx('Reaction scene'), tx('Sequel'), tx('Action scenes followed by quieter scenes where the character reacts and decides.'), tx('The storm, then the long night after.')],
  mice: [tx('Story threads, opened and closed'), tx('MICE threads'), tx('Threads should close in the reverse order they opened.'), tx('Arrive, ask, answer, leave.')],
  world_order: [tx('In-world order'), tx('World order'), tx('When things happen in the story’s world, not when the reader sees them.'), tx('A flashback is early in world time.')],
  world_time: [tx('In-world time'), tx('World time'), tx('When things happen in the story’s world, not when the reader sees them.'), tx('A flashback is early in world time.')],
  beat: [tx('Story moment'), tx('Beat'), tx('A moment the structure says should happen.'), tx('The midpoint reversal.')],
  arc_stage: [tx('Step in a character’s change'), tx('Arc stage'), tx('One step from false belief to change.'), tx('Asks for help for the first time.')],
  turning_point: [tx('Big turn'), tx('Turning point'), tx('A moment that sends the story in a new direction.'), tx('The storm knocks out the light.')],
  threads: [tx('Threads'), tx('Threads'), tx('Storylines that run through several scenes.'), tx('Mara learning to trust Finn.')],
} as const

export type CraftTermId = keyof typeof TERMS

export const craftPlain = (id: CraftTermId) => t(TERMS[id][0])
/** For buttons and other places a ? cannot sit inside: a hover title with the term and definition. */
export const craftTitle = (id: CraftTermId) => `${t(TERMS[id][1])}: ${t(TERMS[id][2])} ${t('For example: {0}', t(TERMS[id][3]))}`

/** The plain label, the craft term as a small subtitle, and a ? with definition and example. */
export function CraftTerm({ id, label, help = true }: { id: CraftTermId; label?: string; help?: boolean }) {
  const [plain, term, definition, example] = TERMS[id]
  const shown = label ?? t(plain)
  return <span className="craft-term" title={help ? undefined : craftTitle(id)}>
    <span className="craft-plain">{shown}</span>
    {t(term) !== shown && <small className="craft-name">{t(term)}</small>}
    {help && <HelpTip label={t(term)}>{t(definition)} <em>{t('For example: {0}', t(example))}</em></HelpTip>}
  </span>
}
