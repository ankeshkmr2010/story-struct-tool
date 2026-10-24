import { t, tx } from '.'

// The API sends some labels and sentences in English. These maps translate the known ones;
// anything unknown (new server text, user data) is shown as sent.

const LEVELS: Record<number, string> = {
  1: tx('Premise'), 2: tx('Arc skeleton'), 3: tx('Characters'), 4: tx('Acts'),
  5: tx('Beats'), 6: tx('Threads'), 7: tx('Chapters'), 8: tx('Scenes'),
}

/** Ladder level name; `fallback` is the server label. */
export const levelLabel = (level: number, fallback: string) => (LEVELS[level] ? t(LEVELS[level]) : fallback)

const VALUES: Record<string, string> = {
  placeholder: tx('Placeholder'), outlined: tx('Outlined'), drafted: tx('Drafted'), revised: tx('Revised'),
  pending: tx('Pending'), proposed: tx('Pending'), applied: tx('Applied'), dismissed: tx('Dismissed'), undone: tx('Undone'), invalid: tx('Invalid'), all: tx('All'),
  story: tx('Story'), character: tx('Character'), location: tx('Location'), act: tx('Act'), beat: tx('Beat'), thread: tx('Thread'),
  relationship: tx('Relationship'), chapter: tx('Chapter'), scene: tx('Scene'), glossary_entry: tx('Glossary entry'), event: tx('Event'), arc: tx('Arc'), arc_stage: tx('Arc stage'),
  create: tx('Created'), update: tx('Updated'), delete: tx('Deleted'), link: tx('Linked'),
}

/** An enum value (status, entity kind, change action); unknown values are humanised. */
export function valueLabel(value: string): string {
  if (VALUES[value]) return t(VALUES[value])
  const text = value.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// English sentences from the API, with {0}, {1}… where the server inserts values.
const SENTENCES = [
  // Health findings (api/src/storytool/domain/health.py)
  tx('Add a premise: the core idea the rest of the plan builds on.'),
  tx('{0} of {1} turning points marked. A turning point is a timeline event that changes the story\'s direction (for example the inciting incident, midpoint and climax); set Turning point to Yes on at least {1}.'),
  tx('{0} turning points marked. More than {1} usually means some are smaller beats rather than major turns.'),
  tx('No character is marked as the protagonist.'),
  tx('{0} has no want or need yet. Want is what they chase; need is what they actually lack.'),
  tx('{0} has no want yet. Want is what they chase; need is what they actually lack.'),
  tx('{0} has no need yet. Want is what they chase; need is what they actually lack.'),
  tx('{0}\'s want and need are the same, so there is no inner conflict to resolve.'),
  tx('An arc has fewer than {0} stages, so the character does not change.'),
  tx('An arc has no ending recorded.'),
  tx('Act {0} has no emotional shift, so nothing changes in it.'),
  tx('{0} acts share the number {1}.'),
  tx('Act {0} does not end on a turning point.'),
  tx('{0} beat(s) are not in any act.'),
  tx('Act {0} has no beats yet, so nothing has to happen in it.'),
  tx('Beats exist, but no storyline thread carries them.'),
  tx('{0} threads are marked A-story (the main storyline); pick one.'),
  tx('Planned work: Act {0} is awaiting fulfilment of "{1}".'),
  tx('Planned work: The story is awaiting fulfilment of "{0}".'),
  tx('Chapter {0} is not assigned to an act.'),
  tx('Chapter {0} covers no beats, directly or through its scenes.'),
  tx('Chapter {0} has no POV character.'),
  tx('Chapter {0} has no scenes yet.'),
  tx('{0} scene(s) are not in any chapter.'),
  tx('{0} scene(s) do not cover any beat.'),
  tx('{0} scene(s) do not move any storyline thread forward.'),
  tx('{0} has an arc defined but no scenes advancing it.'),
  tx('Thread "{0}" has no scenes in Act {1}.'),
  tx('A scene is in {0}\'s POV but its chapter declares a different POV character.'),
  // Ladder advice (api/src/storytool/domain/decisions/nudges.py)
  tx('Clarify who wants what and what stands in their way.'),
  tx('Consider what failure would cost the protagonist.'),
  tx('Sketch the changes that steer the story.'),
  tx('Give the central character a clear desire and conflict.'),
  tx('Consider what changes across each act.'),
  tx('Make the next planned developments concrete.'),
  tx('Identify the promises or questions that carry through the story.'),
  tx('Consider a chapter grouping for the next stretch of writing.'),
  tx('Give the next scene a concrete purpose or change.'),
  // Evaluator names (api/src/storytool/domain/evaluation)
  tx('Setups and payoffs'), tx('Prose continuity'), tx('MICE thread nesting'), tx('Misbelief at midpoint'),
  tx('TK placeholders'), tx('Smart consistency'), tx('Scene and sequel rhythm'), tx('Value shift versus prose'),
  // Change authors (api/src/storytool/db/plugin.py)
  tx('Author'), tx('External MCP client'), tx('Framework scaffold'), tx('Undo applied changes'), tx('App assistant ({0})'),
  // OAuth connection scope (api/src/storytool/domain/auth/oauth_controller.py)
  tx('All your stories'), tx('Beta round: {0}'),
]

const PATTERNS = SENTENCES.map((sentence) => {
  const order: number[] = []
  const source = sentence.split(/\{(\d)\}/).map((part, index) => {
    if (index % 2) { order.push(Number(part)); return '(.+?)' }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return { sentence, order, pattern: new RegExp(`^${source}$`) }
})

/** Translates a known English sentence from the API, keeping the values it carries. */
export function serverText(text: string): string {
  for (const { sentence, order, pattern } of PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    const args: string[] = []
    order.forEach((slot, index) => { args[slot] = match[index + 1] })
    return t(sentence, ...args)
  }
  return text
}
