"""Pre-scaffolding: seeding a story's structure from its chosen framework.

This is the "nothing is created cold" rule as executable code. Choosing Save the Cat does
not hand the author a blank beat sheet -- it creates fifteen real, editable Beat rows
already attached to the right acts.

Seeding is **additive and idempotent**. Running it twice changes nothing; switching
framework seeds only what is absent and deletes nothing, so a story carrying beats from
two frameworks is a valid state rather than an error.
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.frameworks import Framework, get_framework, missing_acts, missing_beats
from storytool.domain.health import StoryGraph
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat

# Gap between seeded sort keys, leaving room to insert between them later without a rewrite.
SORT_STEP = 100.0


@dataclass(frozen=True, slots=True)
class ScaffoldResult:
    framework: str
    acts_created: int
    beats_created: int

    @property
    def changed(self) -> bool:
        return bool(self.acts_created or self.beats_created)


def plan_scaffold(framework: Framework, graph: StoryGraph) -> tuple[tuple, tuple]:
    """Pure: what would be seeded, given what already exists.

    Returns (act templates, beat templates) still missing.
    """
    existing_act_numbers = frozenset(act.number for act in graph.acts)
    existing_positions = frozenset(
        beat.framework_position for beat in graph.beats if beat.framework_position
    )
    return (
        missing_acts(framework, existing_act_numbers),
        missing_beats(framework, existing_positions),
    )


async def scaffold_story(
    session: AsyncSession, story: Story, graph: StoryGraph, framework_key: str | None = None
) -> ScaffoldResult:
    """Seed acts and beats for a story's framework. Safe to call repeatedly."""
    framework = get_framework(framework_key or story.structure_framework)
    act_templates, beat_templates = plan_scaffold(framework, graph)

    # Acts first, so beats can attach to them by number.
    acts_by_number = {act.number: act for act in graph.acts}
    for template in act_templates:
        act = Act(
            story_id=story.id,
            number=template.number,
            title=template.title,
            sort_key=template.number * SORT_STEP,
        )
        session.add(act)
        acts_by_number[template.number] = act

    # Flush before linking beats: primary keys are Python-side defaults applied at INSERT,
    # so act.id is still None here. Without this, every seeded beat would be orphaned.
    if act_templates:
        await session.flush()

    for index, template in enumerate(beat_templates, start=1):
        owning_act = acts_by_number.get(template.act_number)
        session.add(
            Beat(
                story_id=story.id,
                act_id=owning_act.id if owning_act is not None else None,
                label=template.label,
                description=template.description,
                framework_position=template.position,
                sort_key=index * SORT_STEP,
            )
        )

    await session.flush()
    return ScaffoldResult(
        framework=framework.key.value,
        acts_created=len(act_templates),
        beats_created=len(beat_templates),
    )
