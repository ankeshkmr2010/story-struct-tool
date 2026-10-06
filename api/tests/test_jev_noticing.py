"""Jev noticing.

Verified against a stub client, so every guarantee below is checked in CI with no API key
and no spend. One live test exists separately and is skipped without a key.
"""

import os
from types import SimpleNamespace
from uuid import UUID

import pytest
import uuid_utils

from storytool.domain.noticing.deterministic import DeterministicNoticer
from storytool.domain.noticing.jev import JevNoticer, _slug
from storytool.domain.noticing.types import KnownBeat, KnownCharacter

PROSE = "Maya burned the last chart. Kess did not stop her. She did not look back."


def cid() -> UUID:
    return UUID(str(uuid_utils.uuid7()))


class StubJev:
    """Returns a canned SystemOneResponse-shaped object."""

    def __init__(
        self,
        noul: float = 0.0,
        choice: str | None = None,
        confidence: float = 0.0,
        elements: dict[str, float] | None = None,
    ):
        self.calls = 0
        self.last: dict = {}
        self._noul = noul
        self._choice = choice
        self._confidence = confidence
        self._elements = elements or {}

    async def system_one(self, **kwargs):
        self.calls += 1
        self.last = kwargs
        choices = {}
        if self._choice is not None:
            choices["beat"] = SimpleNamespace(
                choice=self._choice, confidence=self._confidence, probabilities={}
            )
        nouls = {"turning_point": SimpleNamespace(noul=self._noul)}
        for name, value in self._elements.items():
            nouls[f"element_{name}"] = SimpleNamespace(noul=value)
        return SimpleNamespace(nouls=nouls, choices=choices, scores={}, model="jev-1.13.0")


class ExplodingJev:
    async def system_one(self, **kwargs):
        raise RuntimeError("529 overloaded")


def noticer(stub: object, **kw) -> JevNoticer:
    return JevNoticer(stub, "jev-latest", DeterministicNoticer(), **kw)


# ------------------------------------------------------- composition


async def test_presence_still_comes_from_the_deterministic_matcher() -> None:
    """Jev answers decisions, not extraction. Presence must keep working -- and keep its
    verbatim evidence, which Jev cannot supply because it returns no text."""
    maya = KnownCharacter(id=cid(), name="Maya")
    notices = await noticer(StubJev(noul=0.9)).notice_scene(PROSE, (maya,))

    assert [n.character_id for n in notices.characters] == [maya.id]
    assert notices.characters[0].evidence is not None
    assert notices.characters[0].evidence in PROSE
    assert "Kess" in {u.name for u in notices.unknown_names}
    assert notices.noticed_by == "jev"


# ---------------------------------------------------------- gating


async def test_a_weak_signal_stays_quiet() -> None:
    """The point of a graded answer: 0.3 is not worth telling the author about."""
    notices = await noticer(StubJev(noul=0.3)).notice_scene(PROSE, ())
    assert notices.structure is None


async def test_a_strong_signal_is_reported_with_its_probability() -> None:
    notices = await noticer(StubJev(noul=0.93)).notice_scene(PROSE, ())
    assert notices.structure is not None
    assert notices.structure.reads_like_turning_point is True
    assert notices.structure.probability == 0.93
    assert notices.structure.confidence == "high"


async def test_threshold_is_configurable() -> None:
    strict = noticer(StubJev(noul=0.7), turning_point_threshold=0.9)
    assert (await strict.notice_scene(PROSE, ())).structure is None


async def test_a_beat_is_not_pinned_on_a_guess() -> None:
    """A spread distribution means Jev is unsure; do not assert a beat from it."""
    beat = KnownBeat(id=cid(), label="All Is Lost")
    unsure = StubJev(noul=0.9, choice=_slug("All Is Lost", 0), confidence=0.2)
    notices = await noticer(unsure).notice_scene(PROSE, (), (beat,))
    assert notices.structure is not None
    assert notices.structure.resembles_beat_id is None


async def test_a_confident_choice_resolves_to_the_beat() -> None:
    beat = KnownBeat(id=cid(), label="All Is Lost")
    sure = StubJev(noul=0.9, choice=_slug("All Is Lost", 0), confidence=0.8)
    notices = await noticer(sure).notice_scene(PROSE, (), (beat,))
    assert notices.structure is not None
    assert notices.structure.resembles_beat_id == beat.id


async def test_an_option_key_jev_was_never_given_resolves_to_nothing() -> None:
    """Closed set enforced on the way back, exactly as with Claude."""
    beat = KnownBeat(id=cid(), label="All Is Lost")
    rogue = StubJev(noul=0.9, choice="99_the_drowning_of_hope", confidence=0.95)
    notices = await noticer(rogue).notice_scene(PROSE, (), (beat,))
    assert notices.structure is not None
    assert notices.structure.resembles_beat_id is None


async def test_structure_notices_carry_no_text() -> None:
    """Jev returns no free text, so there is nothing to validate as verbatim."""
    notices = await noticer(StubJev(noul=0.95)).notice_scene(PROSE, ())
    assert notices.structure is not None
    assert notices.structure.evidence is None


# ------------------------------------------------------ request shape


async def test_no_choice_question_when_the_story_has_no_beats() -> None:
    stub = StubJev(noul=0.9)
    await noticer(stub).notice_scene(PROSE, ())
    assert "beat" not in stub.last["questions"]


async def test_every_question_goes_in_one_call() -> None:
    """Speculative fan-out: questions evaluate in parallel, so asking five costs about what
    asking one costs. One request per scene, never one per question."""
    stub = StubJev(noul=0.9)
    beat = KnownBeat(id=cid(), label="All Is Lost", description="The lowest point.")
    await noticer(stub).notice_scene(PROSE, (), (beat,))

    assert stub.calls == 1
    assert set(stub.last["questions"]) == {
        "turning_point",
        "element_goal",
        "element_conflict",
        "element_outcome",
        "beat",
    }


async def test_every_question_states_its_boundary_cases() -> None:
    """Literal interpretation is Jev 1.13's first documented weakness, so the conditions live
    in `criteria` rather than only in the instruction."""
    stub = StubJev(noul=0.5)
    await noticer(stub).notice_scene(PROSE, ())
    for key, question in stub.last["questions"].items():
        criteria = question.criteria
        assert criteria is not None, f"{key} has no criteria"
        assert set(criteria) == {"true", "false"}


async def test_beat_options_use_the_framework_description_not_the_bare_label() -> None:
    """Jev reads option descriptions; the seeded beats already carry a good one."""
    stub = StubJev(noul=0.1)
    beat = KnownBeat(
        id=cid(), label="All Is Lost", description="The lowest point; the goal looks unreachable."
    )
    await noticer(stub).notice_scene(PROSE, (), (beat,))
    assert list(stub.last["questions"]["beat"].criteria.values()) == [
        "The lowest point; the goal looks unreachable."
    ]


async def test_a_beat_without_a_description_falls_back_to_its_label() -> None:
    stub = StubJev(noul=0.1)
    beat = KnownBeat(id=cid(), label="Hand-written beat", description=None)
    await noticer(stub).notice_scene(PROSE, (), (beat,))
    assert list(stub.last["questions"]["beat"].criteria.values()) == ["Hand-written beat"]


async def test_only_the_prose_is_sent_as_state() -> None:
    """Jev degrades on irrelevant context, so no other story state travels with the request."""
    stub = StubJev(noul=0.1)
    await noticer(stub).notice_scene(PROSE, (KnownCharacter(id=cid(), name="Maya"),))
    assert stub.last["state"] == {"scene": PROSE}


async def test_beats_become_choice_options_keyed_uniquely() -> None:
    """Two frameworks can both define a "Midpoint"; keys must still map back to one beat."""
    beats = (KnownBeat(id=cid(), label="Midpoint"), KnownBeat(id=cid(), label="Midpoint"))
    stub = StubJev(noul=0.1)
    await noticer(stub).notice_scene(PROSE, (), beats)

    criteria = stub.last["questions"]["beat"].criteria
    assert len(criteria) == 2, "duplicate labels must not collapse into one option"
    assert set(criteria.values()) == {"Midpoint"}


async def test_the_configured_model_is_sent() -> None:
    stub = StubJev(noul=0.1)
    await noticer(stub).notice_scene(PROSE, ())
    assert stub.last["model"] == "jev-latest"


async def test_no_call_is_made_for_empty_prose() -> None:
    stub = StubJev(noul=0.9)
    notices = await noticer(stub).notice_scene("   ", ())
    assert stub.calls == 0, "do not spend money reading an empty scene"
    assert notices.noticed_by == "jev"


# --------------------------------------------------------- degrading


async def test_an_api_failure_keeps_the_deterministic_findings() -> None:
    """A 529 must cost the author the judgement, not the whole pass."""
    maya = KnownCharacter(id=cid(), name="Maya")
    notices = await noticer(ExplodingJev()).notice_scene(PROSE, (maya,))
    assert [n.character_id for n in notices.characters] == [maya.id]
    assert notices.structure is None
    assert notices.noticed_by == "deterministic"


@pytest.mark.parametrize(
    ("label", "index", "expected"),
    [
        ("All Is Lost", 0, "0_all_is_lost"),
        ("Fun and Games", 3, "3_fun_and_games"),
        ("  Break Into Two  ", 1, "1_break_into_two"),
        ("!!!", 2, "2_beat"),
    ],
)
def test_slug_is_readable_and_unique(label: str, index: int, expected: str) -> None:
    assert _slug(label, index) == expected


@pytest.mark.skipif(
    not os.getenv("TYPESAFE_API_KEY"),
    reason="live Jev test; set TYPESAFE_API_KEY to run (costs a request)",
)
async def test_live_jev_reads_a_turning_point() -> None:
    """The one test that spends money. Opt-in, so CI stays free and key-less.

    Asserts the contract rather than an exact number -- a probability is a judgement, and
    pinning it to 0.93 would make this test fail on every model revision.
    """
    from typesafe_sdk import AsyncTypeSafeClient

    beat = KnownBeat(id=cid(), label="All Is Lost")
    turning = (
        "Maya carried the last chart to the cliff and let it go. The wind took it over the "
        "water. She had spent eleven years drawing that coast, and she did not reach after it."
    )

    async with AsyncTypeSafeClient() as client:
        result = await JevNoticer(client, "jev-latest", DeterministicNoticer()).notice_scene(
            turning, (KnownCharacter(id=cid(), name="Maya"),), (beat,)
        )

    assert result.noticed_by == "jev", "a live failure would have degraded to deterministic"
    assert result.structure is not None, "an irreversible choice should register as a turn"
    assert result.structure.probability is not None
    assert 0.0 <= result.structure.probability <= 1.0
    # Presence still comes from the deterministic half, with its verbatim quote.
    assert len(result.characters) == 1
    assert result.characters[0].evidence in turning


# ------------------------------------------------ prose structure (elements)


async def test_elements_are_reported_as_probabilities() -> None:
    stub = StubJev(noul=0.2, elements={"goal": 0.9, "conflict": 0.8, "outcome": 0.1})
    notices = await noticer(stub).notice_scene(PROSE, ())

    assert notices.structure is not None
    elements = notices.structure.elements
    assert elements is not None
    assert (elements.goal, elements.conflict, elements.outcome) == (0.9, 0.8, 0.1)


async def test_only_clearly_absent_elements_count_as_missing() -> None:
    """Between the thresholds we say nothing: a nudge built on a coin flip is worse than
    silence."""
    from storytool.domain.noticing.jev import ELEMENT_ABSENT_BELOW
    from storytool.domain.noticing.types import SceneElements

    elements = SceneElements(goal=0.9, conflict=0.5, outcome=0.1)
    assert elements.missing(ELEMENT_ABSENT_BELOW) == ("outcome",)


async def test_a_scene_whose_prose_shows_everything_reports_no_gap() -> None:
    from storytool.domain.noticing.jev import ELEMENT_ABSENT_BELOW

    stub = StubJev(noul=0.2, elements={"goal": 0.9, "conflict": 0.85, "outcome": 0.8})
    notices = await noticer(stub).notice_scene(PROSE, ())
    assert notices.structure is not None
    assert notices.structure.elements is not None
    assert notices.structure.elements.missing(ELEMENT_ABSENT_BELOW) == ()


async def test_elements_alone_are_enough_to_report_a_structure_notice() -> None:
    """Even with no turning point and no beat, the element judgements are worth returning."""
    stub = StubJev(noul=0.1, elements={"goal": 0.9, "conflict": 0.2, "outcome": 0.2})
    notices = await noticer(stub).notice_scene(PROSE, ())
    assert notices.structure is not None
    assert notices.structure.reads_like_turning_point is False
    assert notices.structure.resembles_beat_id is None


# ------------------------------------------------------- confidence bands


async def test_a_noul_probability_is_not_treated_as_a_confidence() -> None:
    """Jev returns no confidence for a noul; the documented equivalent is |2p - 1|.

    A noul of 0.7 means "probably yes", which is middling *certainty* -- reporting it as
    confidence 0.7 would overstate it.
    """
    from storytool.domain.noticing.jev import _noul_certainty

    assert _noul_certainty(0.7) == pytest.approx(0.4)
    assert _noul_certainty(0.5) == pytest.approx(0.0)
    assert _noul_certainty(0.95) == pytest.approx(0.9)

    stub = StubJev(noul=0.7)
    notices = await noticer(stub, turning_point_threshold=0.65).notice_scene(PROSE, ())
    assert notices.structure is not None
    assert notices.structure.reads_like_turning_point is True
    assert notices.structure.probability == 0.7
    assert notices.structure.confidence == "low", "0.7 yes-probability is weak certainty"


async def test_a_near_certain_noul_bands_as_high() -> None:
    stub = StubJev(noul=0.97)
    notices = await noticer(stub).notice_scene(PROSE, ())
    assert notices.structure is not None
    assert notices.structure.confidence == "high"


async def test_the_documented_confidence_floor_is_respected_for_beats() -> None:
    """The docs put 0.6 as the floor for acting on a choice at all."""
    from storytool.domain.noticing.jev import BEAT_MIN_CONFIDENCE

    assert BEAT_MIN_CONFIDENCE >= 0.6

    beat = KnownBeat(id=cid(), label="All Is Lost", description="The lowest point.")
    just_under = StubJev(noul=0.9, choice=_slug("All Is Lost", 0), confidence=0.59)
    notices = await noticer(just_under).notice_scene(PROSE, (), (beat,))
    assert notices.structure is not None
    assert notices.structure.resembles_beat_id is None


# ------------------------------------------------------- suggestion rule


def test_missing_prose_elements_become_an_observation() -> None:
    """Structural, not evaluative: it reports which element is absent from the page, never
    whether the writing is good."""
    from storytool.domain.graph import StoryGraph
    from storytool.domain.narrative.models import Scene
    from storytool.domain.noticing.suggestions import (
        NoticingState,
        scene_prose_missing_a_structural_element,
    )
    from storytool.domain.story.models import Story

    scene = Scene(story_id=None, title="Quiet morning")
    scene.id = cid()
    graph = StoryGraph(story=Story(title="S"), scenes=(scene,))
    state = NoticingState(prose_element_gaps={scene.id: ("conflict", "outcome")})

    proposals = scene_prose_missing_a_structural_element(graph, state)
    assert len(proposals) == 1
    assert proposals[0].message == "Quiet morning: the prose shows no conflict or outcome."
    assert proposals[0].scene_id == scene.id
    # Keyed on which elements are absent, so a changed gap raises a fresh observation.
    assert proposals[0].subject_key == "conflict,outcome"
    lowered = proposals[0].message.lower()
    assert "should" not in lowered and "try " not in lowered


def test_no_observation_when_the_prose_shows_everything() -> None:
    from storytool.domain.graph import StoryGraph
    from storytool.domain.noticing.suggestions import (
        NoticingState,
        scene_prose_missing_a_structural_element,
    )
    from storytool.domain.story.models import Story

    graph = StoryGraph(story=Story(title="S"))
    assert scene_prose_missing_a_structural_element(graph, NoticingState()) == []
