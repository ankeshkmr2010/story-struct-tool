"""Character arcs: what the check flags from per-scene misbelief stages.

Pure: graphs are built in memory, so these run without a database (pytest --noconftest).
"""

from uuid import uuid4

from storytool.domain.cast.models import Character
from storytool.domain.evaluation.character_arcs import _needs_states, _run
from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.story.models import Story


def graph(stages: list[str | None], role: str | None = "protagonist", status: str = "active"):
    story = Story(id=uuid4(), title="S")
    chapter = Chapter(id=uuid4(), story_id=story.id, number=1, sort_key=1)
    scenes = tuple(
        Scene(id=uuid4(), story_id=story.id, chapter_id=chapter.id, sort_key=i, title=f"S{i}")
        for i in range(1, len(stages) + 1)
    )
    hero = Character(id=uuid4(), story_id=story.id, name="Maya", role=role)
    states = tuple(
        (scene.id, hero.id, stage, None, status)
        for scene, stage in zip(scenes, stages, strict=True)
        if stage
    )
    return StoryGraph(
        story=story,
        chapters=(chapter,),
        scenes=scenes,
        characters=(hero,),
        character_states=states,
    )


def codes(g: StoryGraph) -> list[str]:
    return [f.code for f in _run(g).findings]


def test_a_full_arc_is_clean() -> None:
    assert codes(graph(["holds", "doubts", "tested", "lets_go"])) == []


def test_four_scenes_on_one_stage_is_a_stall() -> None:
    assert codes(graph(["holds", "holds", "holds", "holds", "tested", "lets_go"])) == ["arc.stall"]
    assert codes(graph(["holds", "holds", "holds", "tested", "lets_go"])) == []


def test_letting_go_without_a_test_happens_off_the_page() -> None:
    assert codes(graph(["holds", "lets_go"])) == ["arc.off_page"]


def test_major_character_left_open_is_unresolved_but_minor_is_not() -> None:
    assert codes(graph(["holds", "tested"])) == ["arc.unresolved"]
    assert codes(graph(["holds", "tested"], role="minor")) == []


def test_suggestions_are_ignored_until_accepted() -> None:
    g = graph(["holds", "lets_go"], status="suggested")
    assert codes(g) == []
    assert _needs_states(g)
    assert _run(g).visual["suggested"] == 2
