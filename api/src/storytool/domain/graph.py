"""The loaded story graph: one container every pure consumer reads from.

Lives apart from `health` because the Chapter Context Brief needs the same structure, and
both must stay free of database access. `load_graph` in `analysis` is the single place
that touches the session.

The derived properties here are the payoff of the upward-reference design: `is_fulfilled`,
the threads a chapter advances and the arcs it moves are all *computed* by traversal, so
they cannot disagree with the data.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from uuid import UUID

from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.ordering import chapter_order_key, scene_order_key
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread
from storytool.domain.world.models import Location


@dataclass(frozen=True, slots=True)
class StoryGraph:
    """Everything belonging to one story, loaded once."""

    story: Story
    events: tuple[Event, ...] = field(default_factory=tuple)
    acts: tuple[Act, ...] = field(default_factory=tuple)
    beats: tuple[Beat, ...] = field(default_factory=tuple)
    threads: tuple[Thread, ...] = field(default_factory=tuple)
    characters: tuple[Character, ...] = field(default_factory=tuple)
    relationships: tuple[Relationship, ...] = field(default_factory=tuple)
    arcs: tuple[Arc, ...] = field(default_factory=tuple)
    arc_stages: tuple[ArcStage, ...] = field(default_factory=tuple)
    chapters: tuple[Chapter, ...] = field(default_factory=tuple)
    scenes: tuple[Scene, ...] = field(default_factory=tuple)
    locations: tuple[Location, ...] = field(default_factory=tuple)

    # Association rows, as plain tuples -- these are edges, not entities.
    chapter_beats: tuple[tuple[UUID, UUID], ...] = field(default_factory=tuple)
    """(chapter_id, beat_id)"""
    scene_beats: tuple[tuple[UUID, UUID], ...] = field(default_factory=tuple)
    """(scene_id, beat_id)"""
    scene_threads: tuple[tuple[UUID, UUID, bool], ...] = field(default_factory=tuple)
    """(scene_id, thread_id, is_primary)"""
    scene_arc_advances: tuple[tuple[UUID, UUID], ...] = field(default_factory=tuple)
    """(scene_id, arc_stage_id)"""
    character_mentions: tuple[tuple[UUID, UUID], ...] = field(default_factory=tuple)
    """(scene_id, character_id) for mentions the author has not rejected. Continuity rules
    need to know who was where, which only this can tell them."""

    # ------------------------------------------------------------- lookups

    @property
    def turning_points(self) -> tuple[Event, ...]:
        return tuple(e for e in self.events if e.is_turning_point)

    def character_by_id(self) -> dict[UUID, Character]:
        return {c.id: c for c in self.characters}

    def act_by_id(self) -> dict[UUID, Act]:
        return {a.id: a for a in self.acts}

    def beat_by_id(self) -> dict[UUID, Beat]:
        return {b.id: b for b in self.beats}

    def thread_by_id(self) -> dict[UUID, Thread]:
        return {t.id: t for t in self.threads}

    def arc_by_id(self) -> dict[UUID, Arc]:
        return {a.id: a for a in self.arcs}

    def location_by_id(self) -> dict[UUID, Location]:
        return {location.id: location for location in self.locations}

    def characters_in_scene(self) -> dict[UUID, set[UUID]]:
        grouped: dict[UUID, set[UUID]] = defaultdict(set)
        for scene_id, character_id in self.character_mentions:
            grouped[scene_id].add(character_id)
        return grouped

    def scenes_in_reading_order(self) -> tuple[Scene, ...]:
        """Chapter order, then scene order within the chapter.

        Reading order, not story-time order -- the difference between the two is where
        continuity problems live.
        """
        chapter_rank: dict[UUID | None, int] = {
            chapter.id: index
            for index, chapter in enumerate(sorted(self.chapters, key=chapter_order_key))
        }
        placed = [
            s for s in self.scenes if s.chapter_id is not None and s.chapter_id in chapter_rank
        ]
        return tuple(
            sorted(placed, key=lambda s: (chapter_rank[s.chapter_id], *scene_order_key(s)))
        )

    def stage_by_id(self) -> dict[UUID, ArcStage]:
        return {s.id: s for s in self.arc_stages}

    def stages_by_arc(self) -> dict[UUID, list[ArcStage]]:
        grouped: dict[UUID, list[ArcStage]] = defaultdict(list)
        for stage in self.arc_stages:
            grouped[stage.arc_id].append(stage)
        return grouped

    def beats_by_act(self) -> dict[UUID | None, list[Beat]]:
        grouped: dict[UUID | None, list[Beat]] = defaultdict(list)
        for beat in self.beats:
            grouped[beat.act_id].append(beat)
        return grouped

    def scenes_by_chapter(self) -> dict[UUID | None, list[Scene]]:
        grouped: dict[UUID | None, list[Scene]] = defaultdict(list)
        for scene in sorted(self.scenes, key=scene_order_key):
            grouped[scene.chapter_id].append(scene)
        return grouped

    def chapters_by_act(self) -> dict[UUID | None, list[Chapter]]:
        grouped: dict[UUID | None, list[Chapter]] = defaultdict(list)
        for chapter in sorted(self.chapters, key=chapter_order_key):
            grouped[chapter.act_id].append(chapter)
        return grouped

    # -------------------------------------------------- derived fulfilment

    def fulfilled_beat_ids(self) -> frozenset[UUID]:
        """Beats fulfilled by *either* a chapter or a scene.

        This is `is_fulfilled`, computed. Nothing stores it, so it can never go stale when
        a scene moves or a chapter is deleted.
        """
        return frozenset(
            [beat_id for _, beat_id in self.chapter_beats]
            + [beat_id for _, beat_id in self.scene_beats]
        )

    def beat_ids_for_chapter(self, chapter_id: UUID) -> tuple[UUID, ...]:
        """Beats this chapter owes, directly or through one of its scenes."""
        direct = [b for c, b in self.chapter_beats if c == chapter_id]
        scene_ids = {s.id for s in self.scenes_by_chapter().get(chapter_id, [])}
        via_scenes = [b for s, b in self.scene_beats if s in scene_ids]
        # dict.fromkeys preserves order while de-duplicating.
        return tuple(dict.fromkeys(direct + via_scenes))

    def thread_ids_for_chapter(self, chapter_id: UUID) -> tuple[UUID, ...]:
        scene_ids = {s.id for s in self.scenes_by_chapter().get(chapter_id, [])}
        primary_first = sorted(
            (row for row in self.scene_threads if row[0] in scene_ids),
            key=lambda row: not row[2],
        )
        return tuple(dict.fromkeys(thread_id for _, thread_id, _ in primary_first))

    def arc_stage_ids_for_chapter(self, chapter_id: UUID) -> tuple[UUID, ...]:
        scene_ids = {s.id for s in self.scenes_by_chapter().get(chapter_id, [])}
        return tuple(
            dict.fromkeys(stage_id for s, stage_id in self.scene_arc_advances if s in scene_ids)
        )

    def advanced_arc_ids(self) -> frozenset[UUID]:
        """Arcs that at least one scene actually moves."""
        stages = self.stage_by_id()
        return frozenset(
            stages[stage_id].arc_id for _, stage_id in self.scene_arc_advances if stage_id in stages
        )
