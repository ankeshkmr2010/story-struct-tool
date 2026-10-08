"""A global world-time view derived from the story's scenes, events and cast."""

from collections.abc import Mapping, Sequence
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from storytool.domain.graph import StoryGraph


class TimelineCharacterOut(BaseModel):
    id: UUID
    name: str
    role: str | None


class TimelineParticipantOut(BaseModel):
    character_id: UUID
    name: str
    source: str
    is_pov: bool


class TimelineEntryOut(BaseModel):
    id: UUID
    kind: Literal["scene", "event"]
    title: str
    ordinal: int | None
    time_label: str | None
    summary: str | None
    location_id: UUID | None = None
    location_name: str | None = None
    chapter_title: str | None = None
    scene_id: UUID | None = None
    is_turning_point: bool = False
    is_flashback: bool = False
    is_on_page: bool = False
    reading_order: int | None = None
    reading_label: str | None = None
    participants: list[TimelineParticipantOut] = []
    threads: list[str] = []
    beats: list[str] = []
    arc_stages: list[str] = []


class TimelineOut(BaseModel):
    story_id: UUID
    characters: list[TimelineCharacterOut]
    entries: list[TimelineEntryOut]


def build_timeline(
    graph: StoryGraph,
    mention_sources: Mapping[tuple[UUID, UUID], str],
    event_characters: Sequence[tuple[UUID, UUID]] = (),
) -> TimelineOut:
    """Keep missing times unplaced and inferred mentions distinct from authored presence.

    A POV assignment is shown even before the author records the rest of the cast.
    Events keep their own time: linking one to a flashback scene never moves it to
    manuscript order or silently copies the scene's location to a different time.
    """
    characters = graph.character_by_id()
    chapters = {chapter.id: chapter for chapter in graph.chapters}
    locations = graph.location_by_id()
    threads = graph.thread_by_id()
    beats = graph.beat_by_id()
    entries: list[TimelineEntryOut] = []
    reading_rank = {
        scene.id: index for index, scene in enumerate(graph.scenes_in_reading_order(), start=1)
    }
    scenes = {scene.id: scene for scene in graph.scenes}
    arcs = graph.arc_by_id()
    stages = graph.stage_by_id()
    scene_stages: dict[UUID, list[str]] = {}
    for scene_id, stage_id in graph.scene_arc_advances:
        stage = stages.get(stage_id)
        arc = arcs.get(stage.arc_id) if stage else None
        if not stage or not arc:
            continue
        owner = characters.get(arc.character_id) if arc.character_id else None
        owner_label = (
            owner.name if owner else "Relationship arc" if arc.relationship_id else "Storyline arc"
        )
        scene_stages.setdefault(scene_id, []).append(f"{owner_label}: {stage.label}")
    for scene in graph.scenes:
        sources = {
            character_id: source
            for (scene_id, character_id), source in mention_sources.items()
            if scene_id == scene.id and character_id in characters
        }
        if scene.pov_character_id in characters:
            sources.setdefault(scene.pov_character_id, "pov")
        participants = [
            TimelineParticipantOut(
                character_id=character_id,
                name=characters[character_id].name,
                source=source,
                is_pov=character_id == scene.pov_character_id,
            )
            for character_id, source in sorted(
                sources.items(), key=lambda pair: characters[pair[0]].name.casefold()
            )
        ]
        chapter = chapters.get(scene.chapter_id) if scene.chapter_id else None
        location = locations.get(scene.location_id) if scene.location_id else None
        entries.append(
            TimelineEntryOut(
                id=scene.id,
                kind="scene",
                title=scene.title or "Untitled scene",
                ordinal=scene.story_time_ordinal,
                time_label=scene.time_label,
                summary=scene.summary,
                location_id=scene.location_id,
                location_name=location.name if location else scene.location,
                chapter_title=(
                    f"{chapter.number}. {chapter.title or 'Untitled chapter'}" if chapter else None
                ),
                scene_id=scene.id,
                is_flashback=bool(scene.is_flashback),
                is_on_page=True,
                reading_order=reading_rank.get(scene.id),
                reading_label=(
                    f"Chapter {chapter.number} · scene {reading_rank[scene.id]}"
                    if chapter and scene.id in reading_rank
                    else None
                ),
                participants=participants,
                arc_stages=scene_stages.get(scene.id, []),
                threads=[
                    threads[thread_id].title or threads[thread_id].type
                    for scene_id, thread_id, _ in graph.scene_threads
                    if scene_id == scene.id and thread_id in threads
                ],
                beats=[
                    beats[beat_id].label
                    for scene_id, beat_id in graph.scene_beats
                    if scene_id == scene.id and beat_id in beats
                ],
            )
        )
    for event in graph.events:
        location = locations.get(event.location_id) if event.location_id else None
        participants = [
            TimelineParticipantOut(
                character_id=character_id,
                name=characters[character_id].name,
                source="manual",
                is_pov=False,
            )
            for event_id, character_id in event_characters
            if event_id == event.id and character_id in characters
        ]
        depicted = scenes.get(event.scene_id) if event.scene_id else None
        chapter = chapters.get(depicted.chapter_id) if depicted and depicted.chapter_id else None
        entries.append(
            TimelineEntryOut(
                id=event.id,
                kind="event",
                title=event.label,
                ordinal=event.sort_ordinal,
                time_label=event.display_label,
                summary=event.description,
                location_id=event.location_id,
                location_name=location.name if location else None,
                participants=sorted(participants, key=lambda person: person.name.casefold()),
                scene_id=event.scene_id,
                is_turning_point=bool(event.is_turning_point),
                is_on_page=bool(event.is_on_page),
                is_flashback=bool(depicted and depicted.is_flashback),
                arc_stages=(
                    scene_stages.get(depicted.id, [])
                    if depicted and depicted.story_time_ordinal == event.sort_ordinal
                    else []
                ),
                reading_order=reading_rank.get(event.scene_id) if event.scene_id else None,
                reading_label=(
                    f"Chapter {chapter.number} · scene {reading_rank[event.scene_id]}"
                    if chapter and event.scene_id in reading_rank
                    else None
                ),
            )
        )
    entries.sort(
        key=lambda entry: (
            entry.ordinal is None,
            entry.ordinal if entry.ordinal is not None else 0,
            entry.kind != "event",
            entry.title.casefold(),
            str(entry.id),
        )
    )
    return TimelineOut(
        story_id=graph.story.id,
        characters=[
            TimelineCharacterOut(id=character.id, name=character.name, role=character.role)
            for character in sorted(
                graph.characters, key=lambda character: character.name.casefold()
            )
        ],
        entries=entries,
    )
