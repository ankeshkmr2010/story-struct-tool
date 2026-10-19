"""Deterministic prose scanning and the Evaluate checks built on it. Pure: no database."""

from uuid import UUID

import uuid_utils

from storytool.domain.cast.models import Character
from storytool.domain.evaluation import get_evaluator, reads_prose
from storytool.domain.glossary import GlossaryEntry
from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.prose_scan import markers, paragraphs, scan
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


def test_tk_check_lists_placed_scenes_only_with_passages() -> None:
    g = graph("Quiet.\n\nThe [TK: inn] was full.", "Nothing here.", unplaced="[TK] loose")
    evaluator = get_evaluator("tk_placeholders")
    assert evaluator is not None and evaluator.missing(g) == []
    result = evaluator.run(g)
    assert [f.message for f in result.findings] == ["TK in 'S1': inn"]
    passage = result.findings[0].passage
    assert passage is not None and (passage.paragraph, passage.find) == (2, "[TK: inn]")
    assert g.scenes[0].content[passage.start : passage.end] == "[TK: inn]", (
        "offsets index the content"
    )
    assert passage.excerpt == "The [TK: inn] was full."
    assert result.visual == {"count": 1, "scenes": 1}


def test_tk_check_needs_placed_prose() -> None:
    assert get_evaluator("tk_placeholders").missing(graph(None, unplaced="text")) != []


def consistency(g: StoryGraph):
    return get_evaluator("consistency").run(g).findings


def repeated(text: str, times: int) -> str:
    return "\n\n".join([text] * times)


def test_a_rare_misspelling_beside_a_common_name_is_a_likely_typo() -> None:
    maya = with_id(Character(story_id=None, name="Maya Torres", aliases=["Mags"]))
    g = graph(
        repeated("Maya ran to the light. Mags laughed.", 6) + "\n\nMaia stopped.",
        characters=(maya,),
    )
    [finding] = [f for f in consistency(g) if f.code.startswith("names.")]
    assert finding.code == "names.likely_typo" and not finding.uncertain
    assert "'Maia' (once) is probably Maya (6×)" in finding.message
    assert "Maya Torres is in that scene" in finding.message
    assert (finding.entity_type, finding.entity_id) == ("character", maya.id)
    kinds = [a.kind for a in finding.actions]
    assert kinds == ["replace", "add_alias", "keep"]
    replace = finding.actions[0]
    assert [(e.passage.find, e.replacement) for e in replace.edits] == [("Maia", "Maya")]
    content = g.scenes[0].content
    edit = replace.edits[0].passage
    assert content[edit.start : edit.end] == "Maia"


def test_two_spellings_in_steady_use_where_the_name_is_absent_may_be_two_people() -> None:
    maya = with_id(Character(story_id=None, name="Maya"))
    g = graph(*["Maya waved."] * 4, *["Maia smiled."] * 4, characters=(maya,))
    [finding] = [f for f in consistency(g) if f.code.startswith("names.")]
    assert finding.code == "names.similar_names" and finding.uncertain
    assert "Maya is in 0 of the 4 scenes" in finding.message
    assert "add_character" in [a.kind for a in finding.actions]


def test_two_spellings_in_the_same_scenes_are_a_possible_typo() -> None:
    maya = with_id(Character(story_id=None, name="Maya"))
    g = graph(repeated("Maya waved. Maia waved back.", 4), characters=(maya,))
    [finding] = [f for f in consistency(g) if f.code.startswith("names.")]
    assert finding.code == "names.possible_typo" and finding.uncertain


def test_ordinary_words_aliases_and_kept_pairs_are_not_flagged() -> None:
    maya = with_id(Character(story_id=None, name="Mary", aliases=["Maia"]))
    story = Story(title="S", consistency_exceptions=["name:mara~mary"])
    chapter = with_id(Chapter(story_id=None, title="One", sort_key=1))
    scene = with_id(
        Scene(
            story_id=None,
            chapter_id=chapter.id,
            title="A",
            sort_key=1,
            content="Many boats. There were many. Maia ran. Mara came. Mary followed.",
        )
    )
    g = StoryGraph(story=story, chapters=(chapter,), scenes=(scene,), characters=(maya,))
    assert [f for f in consistency(g) if f.code.startswith("names.")] == []


def test_a_variant_of_a_place_name_counts_the_scene_setting() -> None:
    harbour = with_id(Location(story_id=None, name="Elowen"))
    chapter = with_id(Chapter(story_id=None, title="One", sort_key=1))
    scenes = tuple(
        with_id(
            Scene(
                story_id=None,
                chapter_id=chapter.id,
                title=f"S{i}",
                sort_key=i,
                location_id=harbour.id,
                content=text,
            )
        )
        for i, text in enumerate(["Elowen slept. " * 5, "They reached Ellowen at dusk."])
    )
    g = StoryGraph(story=Story(title="S"), chapters=(chapter,), scenes=scenes, locations=(harbour,))
    [finding] = [f for f in consistency(g) if f.code.startswith("names.")]
    assert "Elowen is in that scene" in finding.message
    assert [a.kind for a in finding.actions] == ["replace", "keep"], "places have no aliases"


def test_spelling_follows_the_story_language() -> None:
    text = "The grey sky had no colour. Mr Grey said colour twice: colour."
    us = consistency(graph(text))
    spelling = {f.passage.find: f for f in us if f.code == "spelling.language"}
    assert set(spelling) == {"grey", "colour"}, "Grey mid-sentence is a name"
    assert [e.replacement for e in spelling["colour"].actions[0].edits] == ["color"] * 3

    british = graph("She would realize the color was gray.", language="en-GB")
    found = {f.passage.find for f in consistency(british) if f.code == "spelling.language"}
    assert found == {"color", "gray"}, "British English accepts -ize"


def test_many_foreign_spellings_suggest_switching_the_story_language() -> None:
    text = "colour flavour honour humour neighbour favour behaviour harbour centre theatre"
    findings = [f for f in consistency(graph(text)) if f.code.startswith("spelling.")]
    assert findings[0].code == "spelling.language_setting", "the suggestion leads the section"
    action = findings[0].actions[0]
    assert (action.kind, action.value) == ("set_language", "en-GB")


def test_one_term_written_three_ways_uses_the_glossary_form() -> None:
    term = with_id(GlossaryEntry(story_id=None, term="lantern-keeper", definition="d"))
    g = graph(
        "The lanternkeeper woke. A lantern keeper slept. The lantern-keeper sang.",
        glossary_entries=(term,),
    )
    [finding] = [f for f in consistency(g) if f.code == "variants.hyphenation"]
    assert "'lantern-keeper' is the glossary spelling" in finding.message
    edits = finding.actions[0].edits
    assert sorted(e.passage.find for e in edits) == ["lantern keeper", "lanternkeeper"]
    assert {e.replacement for e in edits} == {"lantern-keeper"}


def test_closed_words_that_differ_in_meaning_are_not_grouped() -> None:
    g = graph("Everyone came. Every one of them was late. Maybe it may be fine.")
    assert [f for f in consistency(g) if f.code == "variants.hyphenation"] == []


def test_capitalisation_ignores_sentence_starts_and_longer_names() -> None:
    harbour = with_id(Location(story_id=None, name="Elowen Harbour"))
    g = graph(
        "They saw the Keep. Then the keep. Near the Keep again. Keep calm. "
        "Elowen Harbour was quiet and the harbour was empty.",
        locations=(harbour,),
    )
    found = [f for f in consistency(g) if f.code == "variants.capitalisation"]
    assert len(found) == 1 and "'Keep' 2× and 'keep' once" in found[0].message
    assert found[0].uncertain
    assert [e.replacement for e in found[0].actions[0].edits] == ["Keep"]


def test_prose_checks_require_prose_read() -> None:
    assert reads_prose("tk_placeholders") and reads_prose("consistency")
    assert not reads_prose("scene_rhythm") and not reads_prose("missing")
