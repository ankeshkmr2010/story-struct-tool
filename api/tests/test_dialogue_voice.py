"""Dialogue voice check: attribution from the text, and like voices flagged, distinct ones not.

Pure: graphs are built in memory, so these run without a database (pytest --noconftest).
"""

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

from storytool.domain.cast.models import Character
from storytool.domain.evaluation.dialogue_voice import (
    extract,
    prepare,
    refine_with_reader,
    run_check,
)
from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.story.models import Story


def graph(*paragraphs: str, names: tuple[str, ...] = ("Maya", "Finn")) -> StoryGraph:
    story = Story(id=uuid4(), title="S")
    chapter = Chapter(id=uuid4(), story_id=story.id, number=1, sort_key=1)
    scene = Scene(
        id=uuid4(),
        story_id=story.id,
        chapter_id=chapter.id,
        sort_key=1,
        content="\n\n".join(paragraphs),
    )
    cast = tuple(Character(id=uuid4(), story_id=story.id, name=name, aliases=[]) for name in names)
    return StoryGraph(story=story, chapters=(chapter,), scenes=(scene,), characters=cast)


def test_speakers_come_from_tags_and_named_subjects_and_are_never_guessed() -> None:
    g = graph(
        "'Bring the rope,' she said.",
        "'Go now,' said Maya.",
        "Finn shrugged. “I don’t know.”",  # noqa: RUF001
        "“Then we wait,” Maya told Finn.",
        "“That is a pity. I am fond of the flute.” He put his hand on Finn's head.",
        "“Look,” whispered Finn to Maya.",
        "Maya's brother laughed. “Not again.”",
    )
    by_name = {c.id: c.name for c in g.characters}
    lines = [(line.text, by_name.get(line.speaker)) for line in extract(g)]
    assert lines == [
        ("Bring the rope,", None),
        ("Go now,", "Maya"),
        ("I don’t know.", "Finn"),  # noqa: RUF001
        ("Then we wait,", "Maya"),
        ("That is a pity. I am fond of the flute.", None),
        ("Look,", "Finn"),
        ("Not again.", None),
    ]


MAYA = [
    "Do you ever wonder why the light keeps turning, even when nobody is watching the sea?",
    "I suppose the island remembers every storm, doesn't it, the way old houses remember us?",
    "Would you walk with me to the cliffs before the tide comes in this evening?",
    "There is something patient about the dark water tonight, something almost kind.",
    "Have you noticed how the gulls go quiet before the weather changes?",
    "My grandmother believed the lantern kept the drowned from wandering too far inland.",
    "Isn't it strange how a single flame can make an entire harbour feel inhabited?",
    "I would rather be honest with you than comfortable with myself, if that makes sense.",
    "Could we read the old logbook together, slowly, the way it deserves to be read?",
    "Perhaps the keeper before us simply grew tired of waiting for an answer.",
    "What do you imagine the ships thought of us, watching from out there in the black?",
]
FINN = [
    "No!",
    "Get the rope.",
    "Now!",
    "Move it!",
    "Tide's up.",
    "Shut the door!",
    "Can't.",
    "Light's out!",
    "Run!",
    "Hold this.",
    "Done.",
]


def tagged(name: str, lines: list[str]) -> list[str]:
    return [f"“{line}” said {name}." for line in lines]


def test_distinct_voices_are_not_flagged() -> None:
    g = graph(*tagged("Maya", MAYA), *tagged("Finn", FINN))
    result = run_check(g)
    assert not [f for f in result.findings if f.code == "dialogue.similar_voices"]
    assert {row["name"]: row["lines"] for row in result.visual["characters"]} == {
        "Maya": 11,
        "Finn": 11,
    }


def test_alike_voices_are_flagged_with_both_characters_lines_as_evidence() -> None:
    same = [f"Well, I just think we should go now, number {n}." for n in range(12)]
    g = graph(*tagged("Maya", same), *tagged("Finn", same))
    flagged = [f for f in run_check(g).findings if f.code == "dialogue.similar_voices"]
    assert len(flagged) == 1 and not flagged[0].uncertain
    assert "Maya and Finn sound alike" in flagged[0].message and "“Well" in flagged[0].message
    assert flagged[0].passage is not None


def test_too_few_lines_says_so_instead_of_comparing() -> None:
    result = run_check(graph(*tagged("Maya", MAYA[:3]), "'Hm,' he said."))
    assert [f.code for f in result.findings] == ["dialogue.too_few_lines"]
    assert "1 of 4 lines have no clear speaker" in result.findings[0].message


def test_reader_attributes_untagged_lines_and_can_soften_a_pair() -> None:
    same = [f"Well, I just think we should go now, number {n}." for n in range(12)]
    g = graph(*tagged("Maya", same), *[f"“{line}”" for line in same])
    finn = next(c for c in g.characters if c.name == "Finn")
    # Both characters are in the scene, so the reader may pick either.
    g = replace(g, character_mentions=tuple((g.scenes[0].id, c.id) for c in g.characters))

    class Reader:
        async def evaluate(self, *, model, state, questions):
            if "distinct" in questions:
                answer = SimpleNamespace(noul=0.9, choice=None, confidence=None)
                return SimpleNamespace(answers={"distinct": answer})
            answer = SimpleNamespace(choice=str(finn.id), confidence=0.8, noul=None)
            return SimpleNamespace(answers={key: answer for key in questions})

    result = asyncio.run(refine_with_reader(prepare(g), Reader(), "jev", 0.6))
    assert result.visual["by_reader"] == 12
    flagged = [f for f in result.findings if f.code == "dialogue.similar_voices"]
    assert len(flagged) == 1 and flagged[0].uncertain
    assert "two distinct voices" in flagged[0].message


def test_a_stored_speaker_wins_over_the_rule_and_is_keyed_by_text_and_occurrence() -> None:
    g = graph("“Go.” said Maya.", "“Go.” said Maya.")
    maya, finn = (c.id for c in g.characters)
    scene = g.scenes[0].id
    g = replace(g, dialogue_speakers=((scene, "Go.", 2, finn, "agent"),))
    lines = extract(g)
    assert [(line.speaker, line.source, line.occurrence) for line in lines] == [
        (maya, None, 1),
        (finn, "agent", 2),
    ]
