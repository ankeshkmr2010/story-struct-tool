"""Finding an old name's uses after a rename. Pure: no database."""

from uuid import UUID

import uuid_utils

from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.rename import name_uses, replacement_plan
from storytool.domain.story.models import Story


def with_id(entity):
    entity.id = UUID(str(uuid_utils.uuid7()))
    return entity


def graph(*contents: str) -> StoryGraph:
    chapter = with_id(Chapter(story_id=None, title="One", sort_key=1))
    scenes = tuple(
        with_id(Scene(story_id=None, chapter_id=chapter.id, title=f"S{i}", sort_key=i, content=c))
        for i, c in enumerate(contents, start=1)
    )
    return StoryGraph(story=Story(title="S"), chapters=(chapter,), scenes=scenes)


def found(g: StoryGraph, old: str, new: str) -> list[tuple[str, str, str]]:
    return [(u["passage"].find, u["replacement"], u["group"]) for u in name_uses(g, old, new)]


def test_whole_words_case_and_possessives() -> None:
    g = graph("Maya ran. Maya's lamp. MAYA! The Mayan coast. Amaya waved. maya-ish.")
    assert found(g, "Maya", "Kate") == [
        ("Maya", "Kate", "full"),
        ("Maya", "Kate", "full"),
        ("MAYA", "KATE", "full"),
    ]


def test_multi_word_names_offer_the_full_name_then_each_changed_word() -> None:
    g = graph("Maya Torres arrived.\n\nLater Maya left, and old Torres slept.")
    assert found(g, "Maya Torres", "Kate Torres") == [
        ("Maya Torres", "Kate Torres", "full"),
        ("Maya", "Kate", "part"),
    ]
    assert found(g, "Maya Torres", "Kate Lee") == [
        ("Maya Torres", "Kate Lee", "full"),
        ("Maya", "Kate", "part"),
        ("Torres", "Lee", "part"),
    ]


def test_passages_index_the_scene_content() -> None:
    g = graph("First paragraph.\n\nThe Elowen Harbour was quiet.")
    [use] = name_uses(g, "Elowen Harbour", "Greyhaven")
    passage = use["passage"]
    assert passage.paragraph == 2
    assert g.scenes[0].content[passage.start : passage.end] == "Elowen Harbour"


def test_nothing_to_do_for_blank_or_unchanged_names() -> None:
    assert replacement_plan("Maya", "Maya") == []
    assert replacement_plan("", "Kate") == []
    assert replacement_plan("Dr. Watson", "Dr. Holmes")[-1][0] != "Dr."
