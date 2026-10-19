"""Deterministic prose scanning and the Evaluate checks built on it. Pure: no database."""

from uuid import UUID

import uuid_utils

from storytool.domain.cast.models import Character
from storytool.domain.evaluation import get_evaluator, reads_prose
from storytool.domain.glossary import GlossaryEntry
from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.prose_scan import edit_distance, markers, paragraphs, scan
from storytool.domain.story.models import Story
from storytool.domain.world.models import Location


def nid() -> UUID:
    return UUID(str(uuid_utils.uuid7()))


def with_id(entity):
    entity.id = nid()
    return entity


def graph(*contents: str | None, unplaced: str | None = None, **extra) -> StoryGraph:
    chapter = with_id(Chapter(story_id=None, title="One", sort_key=1))
    scenes = [
        with_id(
            Scene(story_id=None, chapter_id=chapter.id, title=f"S{i}", sort_key=i, content=text)
        )
        for i, text in enumerate(contents, start=1)
    ]
    if unplaced is not None:
        scenes.append(
            with_id(Scene(story_id=None, chapter_id=None, title="Loose", content=unplaced))
        )
    return StoryGraph(story=Story(title="S"), chapters=(chapter,), scenes=tuple(scenes), **extra)


def test_paragraphs_follow_the_writer_numbering() -> None:
    assert paragraphs("One.\n\n  \n\nTwo.\n  \nThree.") == ["One.", "Two.", "Three."]
    assert paragraphs(None) == []


def test_markers_need_brackets_and_carry_notes() -> None:
    scene = with_id(
        Scene(
            story_id=None,
            title="A",
            content="Intro.\n\nAt [TK: name of the inn] they ate. TK alone.\n\n[tk] and [NOTE: x]",
        )
    )
    found = list(scan([scene], markers("TK")))
    assert [(m.paragraph, m.text, m.details["note"]) for m in found] == [
        (2, "[TK: name of the inn]", "name of the inn"),
        (3, "[tk]", ""),
    ]
    assert found[0].passage.find == "[TK: name of the inn]"


def test_image_markup_is_never_matched() -> None:
    scene = with_id(
        Scene(story_id=None, title="A", content="![the inn](images/[TK].png) then [TK]")
    )
    found = list(scan([scene], markers("TK")))
    assert len(found) == 1
    assert found[0].start > len("![the inn](images/[TK].png)")


def test_edit_distance_counts_a_swap_as_one_edit() -> None:
    assert edit_distance("maia", "maya", 1) == 1
    assert edit_distance("myaa", "maya", 1) == 1
    assert edit_distance("ellowen", "elowen", 2) == 1
    assert edit_distance("thomas", "maya", 1) == 2


def test_tk_check_lists_placed_scenes_only_with_passages() -> None:
    g = graph("Quiet.\n\nThe [TK: inn] was full.", "Nothing here.", unplaced="[TK] loose")
    evaluator = get_evaluator("tk_placeholders")
    assert evaluator is not None and evaluator.missing(g) == []
    result = evaluator.run(g)
    assert [f.message for f in result.findings] == ["TK in 'S1': inn"]
    passage = result.findings[0].passage
    assert passage is not None and (passage.paragraph, passage.find) == (2, "[TK: inn]")
    assert result.visual == {"count": 1, "scenes": 1}


def test_tk_check_needs_placed_prose() -> None:
    assert get_evaluator("tk_placeholders").missing(graph(None, unplaced="text")) != []


def test_name_check_flags_near_misses_once_per_spelling_with_alias_action() -> None:
    maya = with_id(Character(story_id=None, name="Maya Torres", aliases=["Mags"]))
    harbour = with_id(Location(story_id=None, name="Elowen Harbour"))
    term = with_id(GlossaryEntry(story_id=None, term="Lanternkeeper", definition="d"))
    g = graph(
        "Maia ran. Maya followed. Mags laughed.",
        "Many boats sailed. There were many.\n\nMaia again, near Ellowen and the Lanternkeper.",
        characters=(maya,),
        locations=(harbour,),
        glossary_entries=(term,),
    )
    result = get_evaluator("name_consistency").run(g)
    by_variant = {f.passage.find: f for f in result.findings}
    assert set(by_variant) == {"Maia", "Ellowen", "Lanternkeper"}, "Many appears in lower case too"

    maia = by_variant["Maia"]
    assert "appears 2 times, first in 'S1'" in maia.message
    assert (maia.entity_type, maia.entity_id) == ("character", maya.id)
    assert maia.action is not None and (maia.action.kind, maia.action.value) == (
        "add_alias",
        "Maia",
    )

    ellowen = by_variant["Ellowen"]
    assert ellowen.entity_type == "location" and ellowen.action is None, "places have no aliases"
    assert ellowen.passage.paragraph == 2

    assert by_variant["Lanternkeper"].action.entity_type == "glossary_entry"


def test_name_check_respects_aliases() -> None:
    maya = with_id(Character(story_id=None, name="Maya", aliases=["Maia"]))
    result = get_evaluator("name_consistency").run(graph("Maia ran.", characters=(maya,)))
    assert result.findings == ()


def test_prose_checks_require_prose_read() -> None:
    assert reads_prose("tk_placeholders") and reads_prose("name_consistency")
    assert not reads_prose("scene_rhythm") and not reads_prose("missing")
