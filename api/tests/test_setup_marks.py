"""Marked setups and payoffs: finding marks in the prose, and what the check flags.

Pure: graphs are built in memory, so these run without a database (pytest --noconftest).
"""

from uuid import UUID, uuid4

from storytool.domain.evaluation.setup_marks import _run, locate
from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.story.models import Story


def scenes(*texts: str) -> tuple[Story, Chapter, tuple[Scene, ...]]:
    story = Story(id=uuid4(), title="S")
    chapter = Chapter(id=uuid4(), story_id=story.id, number=1, sort_key=1)
    placed = tuple(
        Scene(id=uuid4(), story_id=story.id, chapter_id=chapter.id, sort_key=index, content=text)
        for index, text in enumerate(texts, start=1)
    )
    return story, chapter, placed


def mark(scene: Scene, kind: str, text: str, occurrence: int = 1, status: str = "active"):
    return (uuid4(), scene.id, kind, text, occurrence, None, status)


def codes(g: StoryGraph) -> list[str]:
    return [f.code for f in _run(g).findings]


def test_locate_finds_the_chosen_occurrence_within_one_paragraph() -> None:
    _, _, (scene,) = scenes("The gun hung there.\n\nLater the gun fired.")
    first = locate(scene, "gun", 1)
    second = locate(scene, "gun", 2)
    assert first and first.paragraph == 1 and first.start == 4
    assert second and second.paragraph == 2 and second.find == "gun"
    assert locate(scene, "gun", 3) is None
    assert locate(scene, "there.\n\nLater", 1) is None  # spans two paragraphs


def test_setup_without_payoff_and_payoff_without_setup_are_flagged() -> None:
    story, chapter, (one, two) = scenes("A gun on the wall.", "The gun fired.")
    g = StoryGraph(
        story=story,
        chapters=(chapter,),
        scenes=(one, two),
        setup_marks=(mark(one, "setup", "gun on the wall"), mark(two, "payoff", "gun fired")),
    )
    assert codes(g) == ["setup.unpaid", "setup.payoff_without_setup"]


def test_linked_pair_in_order_is_clean_and_reversed_order_is_flagged() -> None:
    story, chapter, (one, two) = scenes("A gun on the wall.", "The gun fired.")
    setup, payoff = mark(one, "setup", "gun on the wall"), mark(two, "payoff", "gun fired")
    g = StoryGraph(
        story=story,
        chapters=(chapter,),
        scenes=(one, two),
        setup_marks=(setup, payoff),
        setup_links=((setup[0], payoff[0], "active"),),
    )
    assert codes(g) == []
    early, late = mark(one, "payoff", "gun on the wall"), mark(two, "setup", "gun fired")
    g = StoryGraph(
        story=story,
        chapters=(chapter,),
        scenes=(one, two),
        setup_marks=(early, late),
        setup_links=((late[0], early[0], "active"),),
    )
    assert codes(g) == ["setup.payoff_first"]


def test_one_setup_can_have_several_payoffs() -> None:
    story, chapter, (one, two) = scenes("The key.", "The key turned. Then the key broke.")
    setup = mark(one, "setup", "The key")
    turns, breaks = mark(two, "payoff", "key turned"), mark(two, "payoff", "key broke")
    links: tuple[tuple[UUID, UUID, str], ...] = (
        (setup[0], turns[0], "active"),
        (setup[0], breaks[0], "active"),
    )
    g = StoryGraph(
        story=story,
        chapters=(chapter,),
        scenes=(one, two),
        setup_marks=(setup, turns, breaks),
        setup_links=links,
    )
    assert codes(g) == []
    assert _run(g).visual["links"] == 2


def test_suggestions_are_ignored_and_reworded_marks_are_lost() -> None:
    story, chapter, (one,) = scenes("A gun on the wall.")
    g = StoryGraph(
        story=story,
        chapters=(chapter,),
        scenes=(one,),
        setup_marks=(
            mark(one, "setup", "gun on the wall", status="suggested"),
            mark(one, "setup", "rifle on the wall"),
        ),
    )
    assert codes(g) == ["setup.lost"]
    assert _run(g).visual["suggested"] == 1
