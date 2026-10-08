"""An original, worked example of chronology, disclosure order and a character arc."""

from uuid import UUID

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.cast.models import Arc, ArcStage, Character
from storytool.domain.narrative.models import Chapter, Scene, scene_arc_advance, scene_beat
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event
from storytool.examples.outline import Moment, StudyOutline, seed_outline

TITLE = "The Last Lantern — Timeline & Arc Tutorial"
GENRE = "Tutorial · timelines and arcs"

TUTORIAL = StudyOutline(
    title=TITLE,
    premise="When a harbour lantern fails during a storm, Mara must trust the friend she "
    "dismissed to guide a fishing boat safely home.",
    genre=GENRE,
    pov_style="third_limited",
    protagonist="Mara",
    antagonists=(),
    protagonist_want="Restore the harbour signal and bring the fishing boat home",
    protagonist_need="Trust Finn and share responsibility instead of proving herself alone",
    chapter_titles=("A light in the storm", "The cost of going alone", "A light kept together"),
    voice_notes="Original tutorial fiction. World-time numbers show sequence, not minutes. "
    "Open Story timeline and switch between World time and Reading order; then inspect "
    "Mara's arc in Characters and its linked stages in Scene details.",
    moments=(
        Moment(
            "The lantern fails during the storm",
            30,
            "Storm night · the opening",
            "Harbour quay",
            ("Mara", "Finn"),
            1,
            "The story opens in the middle of the trouble: a fishing boat approaches, "
            "the signal dies, and Mara refuses Finn's offer to help.",
            turning=True,
        ),
        Moment(
            "Yesterday's warning",
            10,
            "Previous afternoon · before the storm",
            "Lantern workshop",
            ("Mara", "Finn"),
            1,
            "A flashback reveals that Finn warned Mara about the cracked connector. "
            "She insisted she could maintain the light alone.",
            flashback=True,
        ),
        Moment(
            "Mara's repair fails",
            40,
            "Storm night · after the failure",
            "Lantern workshop",
            ("Mara",),
            2,
            "Mara tries to repair the connector without Finn. Her spare fuse burns out, "
            "and she has to admit that her method cannot save the boat.",
            turning=True,
        ),
        Moment(
            "Mara asks Finn for help",
            50,
            "Storm night · the decision",
            "Signal tower",
            ("Mara", "Finn"),
            2,
            "Mara asks Finn to hold the connector while she fits the replacement. "
            "They divide the task and agree to trust each other's part.",
            turning=True,
        ),
        Moment(
            "The boat follows the restored light",
            60,
            "Storm night · the rescue",
            "Signal tower",
            ("Mara", "Finn"),
            3,
            "Their shared repair restores the signal. The boat changes course and "
            "follows the harbour light safely past the rocks.",
            turning=True,
        ),
        Moment(
            "They agree to keep the light together",
            70,
            "Next morning · the resolution",
            "Harbour quay",
            ("Mara", "Finn"),
            3,
            "Mara thanks Finn and proposes a shared maintenance rota. Her need is "
            "fulfilled by a changed practice, not merely by a successful repair.",
            turning=True,
        ),
    ),
)

PROSE = (
    "The lamp above the quay blinked once and went dark. Beyond the harbour wall, a boat's "
    "white light pitched between the waves. Mara counted the seconds until it would reach "
    "the rocks. Finn set his toolbox beside hers. 'Give me the connector,' he said. "
    "She pulled the box closer. 'I have it.' The wind tore the words away, but not the look "
    "on his face. When she opened the casing, the crack he had warned her about shone "
    "like a thin black river across the metal. She could hear the boat's engine now.",
    "The previous afternoon, sunlight had filled the workshop. Finn held the connector "
    "against the window and pointed to its split seam. Mara told him the light had worked "
    "all winter. He offered to test it with her before the weather turned. 'It is my "
    "responsibility,' she said. Finn put the part down carefully. She heard his chair scrape "
    "back, and for a moment wanted to call him back. Instead she tightened the screws. "
    "Doing it alone had always felt safer than letting anyone see her uncertain.",
    "Back in the storm, Mara carried the broken part into the workshop. She wedged it "
    "against the bench and fitted her last spare fuse. The moment she pressed the switch, "
    "a bright thread flashed inside the glass and vanished. The connector needed to be held "
    "steady while the replacement was seated; one hand could not do both jobs. Mara looked "
    "at the empty chair opposite her. The repair had failed, but the worse failure had "
    "happened yesterday, when she mistook being responsible for being alone.",
    "Finn was waiting at the tower door. Mara stopped beside him, still holding the casing. "
    "'I need another pair of hands,' she said. He did not smile or tell her that he had "
    "warned her. He asked what she needed him to hold. Together they climbed the stairs. "
    "Finn steadied the connector while Mara seated the replacement from his toolbox. "
    "When the wind shook the tower, she stopped gripping both parts and let him keep "
    "his hold. For the first time that night, the work became manageable.",
    "The signal cast a long gold path across the water. Mara watched the boat hesitate, "
    "then turn into it. Finn kept his hand on the casing until the engine's sound changed "
    "from a distant struggle to a steady harbour rumble. Only then did Mara close the "
    "cover. She had wanted to restore the light, and they had done it. What she had needed "
    "was harder to name: the courage to give somebody else a part she could not safely "
    "carry. Below them, the boat passed the last rock.",
    "In the morning the quay smelled of wet rope and cooling engines. Mara brought two "
    "cups of tea to the workshop door. She thanked Finn before asking if he would share "
    "the maintenance rota. 'You are still responsible for the light,' he said. 'Yes,' she "
    "answered, handing him a cup. 'But that does not mean I have to be its only keeper.' "
    "They wrote their names on alternating days. The storm had ended; the new habit "
    "was the thing that would outlast it.",
)


async def seed_tutorial(session: AsyncSession, owner_id: UUID) -> Story:
    existing = await session.scalar(
        select(Story).where(Story.user_id == owner_id, Story.title == TITLE).limit(1)
    )
    if existing is not None:
        return existing
    story = await seed_outline(session, owner_id, TUTORIAL)
    characters = {
        item.name: item
        for item in (
            await session.execute(select(Character).where(Character.story_id == story.id))
        ).scalars()
    }
    mara, finn = characters["Mara"], characters["Finn"]
    mara.arc_type = "positive"
    mara.misbelief = "If I ask for help, I have failed at my responsibility"
    finn.arc_type = "flat"
    finn.want = "Help restore the signal before the boat reaches the rocks"
    finn.need = "Offer his expertise without turning help into a contest"
    scenes = list(
        (
            await session.execute(
                select(Scene).where(Scene.story_id == story.id).order_by(Scene.sort_key)
            )
        ).scalars()
    )
    goals = (
        (
            "Restore the signal before the boat reaches the rocks",
            "The light fails and Mara refuses help",
            "The cracked connector makes the danger concrete",
            "confidence",
            "defensiveness",
        ),
        (
            "Maintain the light on her own",
            "Finn's warning challenges her claim of control",
            "Mara rejects a joint test, establishing her misbelief",
            "certainty",
            "stubbornness",
        ),
        (
            "Repair the connector with her last spare fuse",
            "The task needs two steady pairs of hands",
            "The fuse burns out and Mara admits her method has failed",
            "determination",
            "doubt",
        ),
        (
            "Ask Finn to share the repair",
            "Admitting the need for help threatens her pride",
            "They divide the work and Mara lets Finn hold his part",
            "shame",
            "trust",
        ),
        (
            "Keep the signal working until the boat reaches safety",
            "Wind and movement threaten the repair",
            "The restored light guides the boat past the rocks",
            "anxiety",
            "relief",
        ),
        (
            "Turn the rescue into a durable shared practice",
            "It would be easy to return to doing everything alone",
            "Mara and Finn agree to share the maintenance rota",
            "relief",
            "shared confidence",
        ),
    )
    for index, (scene, prose, values) in enumerate(zip(scenes, PROSE, goals, strict=True)):
        scene.content = prose
        scene.word_count = len(prose.split())
        scene.status = "drafted"
        scene.pov_character_id = mara.id
        (
            scene.goal,
            scene.conflict,
            scene.outcome,
            scene.emotional_value_from,
            scene.emotional_value_to,
        ) = values
        if index == 5:
            scene.type = "sequel"
    arc = Arc(
        story_id=story.id,
        character_id=mara.id,
        resolution="Mara keeps her responsibility while sharing its work with Finn.",
    )
    session.add(arc)
    await session.flush()
    stages = []
    for index, (label, description) in enumerate(
        [
            (
                "I must do everything myself",
                "Her misbelief is active both before the storm and at the opening.",
            ),
            (
                "My method has failed",
                "The failed repair breaks her confidence in solitary control.",
            ),
            (
                "I can ask for help",
                "Mara makes a choice and puts trust into practice during the repair.",
            ),
            (
                "We share responsibility",
                "The final rota demonstrates a lasting new belief, not just a temporary rescue.",
            ),
        ],
        1,
    ):
        stage = ArcStage(arc_id=arc.id, label=label, description=description, sort_key=index * 100)
        session.add(stage)
        stages.append(stage)
    await session.flush()
    for scene, stage_index in zip(scenes, [0, 0, 1, 2, 2, 3], strict=True):
        await session.execute(
            insert(scene_arc_advance).values(scene_id=scene.id, arc_stage_id=stages[stage_index].id)
        )
    acts = list(
        (
            await session.execute(select(Act).where(Act.story_id == story.id).order_by(Act.number))
        ).scalars()
    )
    events = {
        item.label: item
        for item in (
            await session.execute(select(Event).where(Event.story_id == story.id))
        ).scalars()
    }
    act_values = [
        (
            "The failure raises the stakes; an early flashback explains "
            "Mara's refusal to share the work.",
            "confidence",
            "defensiveness",
            0,
            0,
        ),
        (
            "Mara's solitary repair fails. She chooses to ask Finn for help and divides the task.",
            "defensiveness",
            "trust",
            0,
            3,
        ),
        (
            "Their joint repair saves the boat. A shared rota turns the lesson "
            "into a lasting practice.",
            "anxiety",
            "shared confidence",
            3,
            5,
        ),
    ]
    for act, (summary, before, after, opening, closing) in zip(acts, act_values, strict=True):
        act.summary, act.emotional_shift_from, act.emotional_shift_to = summary, before, after
        act.opening_turning_point_id = events[TUTORIAL.moments[opening].title].id
        act.closing_turning_point_id = events[TUTORIAL.moments[closing].title].id
    chapters = list(
        (
            await session.execute(
                select(Chapter).where(Chapter.story_id == story.id).order_by(Chapter.number)
            )
        ).scalars()
    )
    for chapter in chapters:
        chapter.summary = acts[chapter.number - 1].summary
        chapter.status = "drafted"
        chapter.emotional_shift_from = acts[chapter.number - 1].emotional_shift_from
        chapter.emotional_shift_to = acts[chapter.number - 1].emotional_shift_to
    beats = list(
        (
            await session.execute(
                select(Beat).where(Beat.story_id == story.id).order_by(Beat.sort_key)
            )
        ).scalars()
    )
    for beat, label, description in zip(
        beats,
        [
            "Expose the danger and the misbelief",
            "Replace solitary control with a request for help",
            "Demonstrate the change through action",
        ],
        [act.summary or "" for act in acts],
        strict=True,
    ):
        beat.label, beat.description = label, description
    practice = Scene(
        story_id=story.id,
        chapter_id=chapters[-1].id,
        title="Practice placeholder — outline your own coda",
        sort_key=700,
        summary="Optional exercise: add a goal, conflict, outcome and POV. "
        "Then choose a draft status separately.",
    )
    session.add(practice)
    await session.flush()
    await session.execute(insert(scene_beat).values(scene_id=practice.id, beat_id=beats[-1].id))
    return story
