"""The Chapter Context Brief.

The payoff of the whole design. Opening a chapter shows the author what it owes:

    Chapter 7
    Act: Two - Confrontation
    Beat to fulfil: "All Is Lost"
    Character arc advancing: Maya (denial -> acceptance)
    Thread: A-story
    Emotional shift: hope -> despair
    Scenes: 3 placeholders

Not one field of that is typed by the author at chapter level. It is all derived by
traversing upward references -- which is why a freshly created, entirely empty chapter
still opens with a brief rather than a blank form. Nothing is created cold.

A pure function of the graph, so it is testable without a database.
"""

from dataclasses import dataclass
from uuid import UUID

from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Chapter


@dataclass(frozen=True, slots=True)
class BeatObligation:
    beat_id: UUID
    label: str
    framework_position: str | None
    is_fulfilled: bool


@dataclass(frozen=True, slots=True)
class ArcAdvance:
    arc_id: UUID
    owner_name: str | None
    from_stage: str | None
    to_stage: str | None

    @property
    def summary(self) -> str:
        who = self.owner_name or "An arc"
        if self.from_stage and self.to_stage and self.from_stage != self.to_stage:
            return f"{who} ({self.from_stage} -> {self.to_stage})"
        if self.to_stage:
            return f"{who} ({self.to_stage})"
        return who


@dataclass(frozen=True, slots=True)
class SceneLine:
    scene_id: UUID
    title: str | None
    type: str
    status: str
    is_complete: bool


@dataclass(frozen=True, slots=True)
class ChapterBrief:
    chapter_id: UUID
    number: int
    title: str | None
    status: str

    act_number: int | None
    act_title: str | None

    beats: tuple[BeatObligation, ...]
    arcs_advancing: tuple[ArcAdvance, ...]
    threads: tuple[str, ...]

    emotional_shift_from: str | None
    emotional_shift_to: str | None
    emotional_shift_inherited: bool
    """True when the shift shown is the act's, because the chapter declares none of its own."""

    pov_character_name: str | None
    scenes: tuple[SceneLine, ...]

    @property
    def placeholder_scene_count(self) -> int:
        return sum(1 for s in self.scenes if not s.is_complete)

    @property
    def unfulfilled_beat_count(self) -> int:
        return sum(1 for b in self.beats if not b.is_fulfilled)


def build_chapter_brief(graph: StoryGraph, chapter: Chapter) -> ChapterBrief:
    acts = graph.act_by_id()
    beats = graph.beat_by_id()
    threads = graph.thread_by_id()
    characters = graph.character_by_id()
    stages = graph.stage_by_id()
    arcs = graph.arc_by_id()
    fulfilled = graph.fulfilled_beat_ids()

    act = acts.get(chapter.act_id) if chapter.act_id else None

    beat_obligations = tuple(
        BeatObligation(
            beat_id=beat_id,
            label=beats[beat_id].label,
            framework_position=beats[beat_id].framework_position,
            is_fulfilled=beat_id in fulfilled,
        )
        for beat_id in graph.beat_ids_for_chapter(chapter.id)
        if beat_id in beats
    )

    # Group the stages this chapter's scenes touch by arc, then report the span: the
    # earliest and latest stage by sort order, which is the "denial -> acceptance" line.
    stage_ids = graph.arc_stage_ids_for_chapter(chapter.id)
    by_arc: dict[UUID, list] = {}
    for stage_id in stage_ids:
        stage = stages.get(stage_id)
        if stage is not None:
            by_arc.setdefault(stage.arc_id, []).append(stage)

    arcs_advancing = []
    for arc_id, touched in by_arc.items():
        ordered = sorted(touched, key=lambda s: s.sort_key)
        arc = arcs.get(arc_id)
        owner = characters.get(arc.character_id) if arc and arc.character_id else None
        arcs_advancing.append(
            ArcAdvance(
                arc_id=arc_id,
                owner_name=owner.name if owner else None,
                from_stage=ordered[0].label,
                to_stage=ordered[-1].label,
            )
        )

    thread_labels = tuple(
        threads[thread_id].title or threads[thread_id].type.replace("_", "-")
        for thread_id in graph.thread_ids_for_chapter(chapter.id)
        if thread_id in threads
    )

    # A chapter with no declared shift inherits its act's, so the brief is never blank
    # where the structure above it has an answer.
    own_from = (chapter.emotional_shift_from or "").strip() or None
    own_to = (chapter.emotional_shift_to or "").strip() or None
    inherited = False
    if not (own_from or own_to) and act is not None:
        act_from = (act.emotional_shift_from or "").strip() or None
        act_to = (act.emotional_shift_to or "").strip() or None
        if act_from or act_to:
            own_from, own_to, inherited = act_from, act_to, True

    pov = characters.get(chapter.pov_character_id) if chapter.pov_character_id else None

    scenes = tuple(
        SceneLine(
            scene_id=scene.id,
            title=scene.title,
            type=scene.type,
            status=scene.status,
            is_complete=scene.is_complete,
        )
        for scene in graph.scenes_by_chapter().get(chapter.id, [])
    )

    return ChapterBrief(
        chapter_id=chapter.id,
        number=chapter.number,
        title=chapter.title,
        status=chapter.status,
        act_number=act.number if act else None,
        act_title=act.title if act else None,
        beats=beat_obligations,
        arcs_advancing=tuple(arcs_advancing),
        threads=thread_labels,
        emotional_shift_from=own_from,
        emotional_shift_to=own_to,
        emotional_shift_inherited=inherited,
        pov_character_name=pov.name if pov else None,
        scenes=scenes,
    )
