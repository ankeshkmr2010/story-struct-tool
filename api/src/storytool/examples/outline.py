"""Build independent editable study examples from a small, explicit outline."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.cast.models import Character
from storytool.domain.narrative.models import (
    Chapter,
    Scene,
    SceneCharacterMention,
    chapter_beat,
    scene_beat,
    scene_thread,
)
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread, event_character
from storytool.domain.world.models import Location


@dataclass(frozen=True)
class Moment:
    title: str
    time: int
    when: str
    place: str
    cast: tuple[str, ...]
    chapter: int
    summary: str
    flashback: bool = False
    turning: bool = False


@dataclass(frozen=True)
class StudyOutline:
    title: str
    premise: str
    genre: str
    pov_style: str
    protagonist: str
    antagonists: tuple[str, ...]
    chapter_titles: tuple[str, ...]
    moments: tuple[Moment, ...]
    voice_notes: str
    protagonist_want: str
    protagonist_need: str
    extra_characters: tuple[str, ...] = ()
    pov_character: str | None = None


async def seed_outline(session: AsyncSession, owner_id: UUID, outline: StudyOutline) -> Story:
    existing = await session.scalar(
        select(Story)
        .where(Story.user_id == owner_id, Story.title == outline.title)
        .order_by(Story.created_at)
        .limit(1)
    )
    if existing is not None:
        return existing
    story = Story(
        user_id=owner_id,
        title=outline.title,
        premise=outline.premise,
        notes=outline.voice_notes,
        genre=outline.genre,
        pov_style=outline.pov_style,
        structure_framework="custom",
        authoring_mode="hybrid",
    )
    session.add(story)
    await session.flush()
    names = sorted(
        {name for moment in outline.moments for name in moment.cast} | set(outline.extra_characters)
    )
    characters = {}
    for name in names:
        character = Character(
            story_id=story.id,
            name=name,
            role="protagonist"
            if name == outline.protagonist
            else ("antagonist" if name in outline.antagonists else "supporting"),
            want=outline.protagonist_want if name == outline.protagonist else None,
            need=outline.protagonist_need if name == outline.protagonist else None,
        )
        session.add(character)
        characters[name] = character
    places = {}
    for name in sorted({moment.place for moment in outline.moments}):
        place = Location(
            story_id=story.id,
            name=name,
            description=f"A setting in the {outline.title} study outline.",
        )
        session.add(place)
        places[name] = place
    acts = []
    for index, title in enumerate(("Opening", "Development", "Resolution"), 1):
        act = Act(story_id=story.id, number=index, title=title, sort_key=index * 100)
        session.add(act)
        acts.append(act)
    await session.flush()
    thread = Thread(
        story_id=story.id,
        type="a_story",
        title="The central story",
        owner_character_id=characters[outline.protagonist].id,
    )
    session.add(thread)
    chapters = {}
    beats = {}
    for number, title in enumerate(outline.chapter_titles, 1):
        act_index = min(2, (number - 1) * 3 // len(outline.chapter_titles))
        beat = Beat(
            story_id=story.id,
            act_id=acts[act_index].id,
            label=title,
            description=f"Deliver the change in {title.lower()}.",
            sort_key=number * 100,
        )
        chapter = Chapter(
            story_id=story.id,
            act_id=acts[act_index].id,
            number=number,
            title=title,
            summary=title,
            sort_key=number * 100,
            status="outlined",
            pov_character_id=characters[outline.pov_character or outline.protagonist].id,
        )
        session.add_all([beat, chapter])
        beats[number], chapters[number] = beat, chapter
    await session.flush()
    await session.execute(
        insert(chapter_beat),
        [{"chapter_id": chapters[number].id, "beat_id": beats[number].id} for number in chapters],
    )
    for index, moment in enumerate(outline.moments, 1):
        preferred_pov = outline.pov_character or outline.protagonist
        pov = preferred_pov if preferred_pov in moment.cast else moment.cast[0]
        scene = Scene(
            story_id=story.id,
            chapter_id=chapters[moment.chapter].id,
            title=moment.title,
            summary=moment.summary,
            content=moment.summary,
            word_count=len(moment.summary.split()),
            status="outlined",
            sort_key=index * 100,
            location_id=places[moment.place].id,
            story_time_ordinal=moment.time,
            time_label=moment.when,
            is_flashback=moment.flashback,
            pov_character_id=characters[pov].id,
            goal=None,
            conflict=None,
            outcome=moment.summary,
        )
        session.add(scene)
        await session.flush()
        event = Event(
            story_id=story.id,
            label=moment.title,
            description=moment.summary,
            sort_ordinal=moment.time,
            display_label=moment.when,
            location_id=places[moment.place].id,
            scene_id=scene.id,
            is_on_page=True,
            is_turning_point=moment.turning,
        )
        session.add(event)
        await session.flush()
        session.add_all(
            [
                SceneCharacterMention(
                    scene_id=scene.id, character_id=characters[name].id, source="manual"
                )
                for name in moment.cast
            ]
        )
        await session.execute(
            insert(event_character),
            [{"event_id": event.id, "character_id": characters[name].id} for name in moment.cast],
        )
        await session.execute(
            insert(scene_thread).values(scene_id=scene.id, thread_id=thread.id, is_primary=True)
        )
        await session.execute(
            insert(scene_beat).values(scene_id=scene.id, beat_id=beats[moment.chapter].id)
        )
    await session.flush()
    from storytool.domain.story.authorship import record_changes
    from storytool.domain.versioning.service import full_state

    await record_changes(
        session,
        story.id,
        owner_id,
        {},
        await full_state(session, story.id),
        "system",
        "Sample study outline",
    )
    return story
