"""Phase 4: noticing.

The important tests here are the ones proving the LLM *cannot* do what we promised it
wouldn't. They run against a stub client, so they cost nothing and need no API key -- which
also means they run in CI forever, rather than being a claim in a code comment.
"""

from types import SimpleNamespace
from uuid import UUID

import pytest
import uuid_utils
from litestar.testing import AsyncTestClient

from storytool.domain.noticing.claude import ClaudeNoticer, _SceneNoticeResponse
from storytool.domain.noticing.deterministic import DeterministicNoticer
from storytool.domain.noticing.suggestions import (
    NoticingState,
    propose_suggestions,
)
from storytool.domain.noticing.types import KnownBeat, KnownCharacter, verbatim_or_none

STORIES = "/api/stories"

PROSE = (
    "Maya walked the drowned causeway. The tide had taken the markers, and Kess was "
    "nowhere. She thought of Harbourmaster Enns and turned back."
)


def cid() -> UUID:
    return UUID(str(uuid_utils.uuid7()))


# --------------------------------------------------------- deterministic


async def test_deterministic_matches_known_names() -> None:
    maya = KnownCharacter(id=cid(), name="Maya Okonkwo")
    notices = await DeterministicNoticer().notice_scene(PROSE, (maya,))
    assert [n.character_id for n in notices.characters] == [maya.id]
    assert notices.noticed_by == "deterministic"


async def test_deterministic_matches_a_bare_first_name() -> None:
    """Prose says "Maya"; the cast list says "Maya Okonkwo"."""
    maya = KnownCharacter(id=cid(), name="Maya Okonkwo")
    assert maya.aliases == ("Maya Okonkwo", "Maya")
    notices = await DeterministicNoticer().notice_scene("Maya waited.", (maya,))
    assert len(notices.characters) == 1


async def test_deterministic_flags_names_it_does_not_know() -> None:
    maya = KnownCharacter(id=cid(), name="Maya")
    notices = await DeterministicNoticer().notice_scene(PROSE, (maya,))
    found = {n.name for n in notices.unknown_names}
    assert "Kess" in found
    assert "Maya" not in found, "a known character is not an unknown name"


async def test_deterministic_ignores_capitalised_non_names() -> None:
    prose = "The tide rose. She left on Monday. They waited."
    notices = await DeterministicNoticer().notice_scene(prose, ())
    assert {n.name for n in notices.unknown_names} == set()


async def test_deterministic_evidence_is_verbatim() -> None:
    maya = KnownCharacter(id=cid(), name="Maya")
    notices = await DeterministicNoticer().notice_scene(PROSE, (maya,))
    for notice in notices.characters:
        assert notice.evidence is not None
        assert notice.evidence in PROSE


async def test_deterministic_never_judges_structure() -> None:
    """String matching cannot honestly tell a turning point, so it reports nothing."""
    notices = await DeterministicNoticer().notice_scene(PROSE, ())
    assert notices.structure is None


async def test_empty_prose_notices_nothing() -> None:
    notices = await DeterministicNoticer().notice_scene("   \n ", (KnownCharacter(cid(), "Maya"),))
    assert notices.characters == ()
    assert notices.unknown_names == ()


# ------------------------------------------------- the verbatim guarantee


@pytest.mark.parametrize(
    ("evidence", "expected"),
    [
        ("Maya walked the drowned causeway.", "Maya walked the drowned causeway."),
        ("  Maya walked the drowned causeway.  ", "Maya walked the drowned causeway."),
        ("Maya strode confidently down the causeway.", None),  # paraphrase -> dropped
        ("Maya should confront Kess about the markers.", None),  # invention -> dropped
        ("", None),
        (None, None),
    ],
)
def test_only_verbatim_quotes_survive(evidence: str | None, expected: str | None) -> None:
    """The mechanism that makes the one free-text field safe: a noticer can quote the author
    back to themselves and can do nothing else with words."""
    assert verbatim_or_none(evidence, PROSE) == expected


# ------------------------------------- the Claude noticer's hard limits


class StubClient:
    """Stands in for AsyncAnthropic. Returns whatever the test tells it to."""

    def __init__(self, parsed: object | None, stop_reason: str = "end_turn") -> None:
        self.calls = 0
        self.messages = SimpleNamespace(parse=self._parse)
        self._parsed = parsed
        self._stop_reason = stop_reason

    async def _parse(self, **kwargs: object) -> object:
        self.calls += 1
        self.last_kwargs = kwargs
        return SimpleNamespace(
            parsed_output=self._parsed, stop_reason=self._stop_reason, stop_details=None
        )


class ExplodingClient:
    def __init__(self) -> None:
        self.messages = SimpleNamespace(parse=self._parse)

    async def _parse(self, **kwargs: object) -> object:
        raise RuntimeError("network down")


def noticer(parsed: object | None, stop_reason: str = "end_turn") -> ClaudeNoticer:
    return ClaudeNoticer(
        client=StubClient(parsed, stop_reason),
        model="claude-sonnet-5-5",
        fallback=DeterministicNoticer(),
    )


async def test_claude_resolves_names_to_existing_characters() -> None:
    maya = KnownCharacter(id=cid(), name="Maya")
    parsed = _SceneNoticeResponse(
        characters=[{"name": "Maya", "evidence": "Maya walked the drowned causeway."}],  # type: ignore[list-item]
    )
    notices = await noticer(parsed).notice_scene(PROSE, (maya,))
    assert [n.character_id for n in notices.characters] == [maya.id]
    assert notices.noticed_by == "claude"


async def test_claude_cannot_invent_a_character() -> None:
    """A hallucinated name resolves to nothing and is silently discarded.

    This is the closed-set guarantee: the model can only point at people the author created.
    """
    maya = KnownCharacter(id=cid(), name="Maya")
    parsed = _SceneNoticeResponse(
        characters=[
            {"name": "Maya", "evidence": "Maya walked the drowned causeway."},  # type: ignore[list-item]
            {"name": "Lord Vanholt", "evidence": "Lord Vanholt arrived."},  # type: ignore[list-item]
        ],
    )
    notices = await noticer(parsed).notice_scene(PROSE, (maya,))
    assert [n.character_id for n in notices.characters] == [maya.id]
    assert len(notices.characters) == 1, "an invented character must not survive"


async def test_claude_cannot_invent_a_beat() -> None:
    """`resembles_beat_label` is matched against existing beats; anything else is dropped."""
    real = KnownBeat(id=cid(), label="All Is Lost")
    parsed = _SceneNoticeResponse(
        reads_like_turning_point=True,
        resembles_beat_label="The Drowning Of Hope",  # not a beat in this story
        confidence="high",
    )
    notices = await noticer(parsed).notice_scene(PROSE, (), (real,))
    assert notices.structure is not None
    assert notices.structure.reads_like_turning_point is True
    assert notices.structure.resembles_beat_id is None, "an invented beat must not survive"


async def test_claude_can_recognise_an_existing_beat() -> None:
    real = KnownBeat(id=cid(), label="All Is Lost")
    parsed = _SceneNoticeResponse(
        reads_like_turning_point=True, resembles_beat_label="all is lost", confidence="medium"
    )
    notices = await noticer(parsed).notice_scene(PROSE, (), (real,))
    assert notices.structure is not None
    assert notices.structure.resembles_beat_id == real.id


async def test_claude_evidence_must_be_verbatim() -> None:
    """A paraphrase or an invented line is stripped, leaving the observation without a quote
    rather than letting generated text through."""
    maya = KnownCharacter(id=cid(), name="Maya")
    parsed = _SceneNoticeResponse(
        characters=[{"name": "Maya", "evidence": "Maya felt a deep and abiding sorrow."}],  # type: ignore[list-item]
    )
    notices = await noticer(parsed).notice_scene(PROSE, (maya,))
    assert notices.characters[0].evidence is None


async def test_claude_response_schema_has_no_generative_field() -> None:
    """The structural guarantee, asserted directly: there is nowhere for proposed prose or
    plot to go, so 'never writes for you' is a property of the type, not of the prompt."""
    fields = set(_SceneNoticeResponse.model_fields)
    assert fields == {
        "characters",
        "unknown_names",
        "reads_like_turning_point",
        "resembles_beat_label",
        "confidence",
        "turning_point_evidence",
    }
    forbidden = {"suggestion", "summary", "continuation", "rewrite", "proposal", "next_scene"}
    assert fields.isdisjoint(forbidden)


async def test_refusal_degrades_to_deterministic_instead_of_failing() -> None:
    """Fiction contains violence; a safety decline must never cost the author their save."""
    maya = KnownCharacter(id=cid(), name="Maya")
    notices = await noticer(None, stop_reason="refusal").notice_scene(PROSE, (maya,))
    assert notices.noticed_by == "deterministic"
    assert [n.character_id for n in notices.characters] == [maya.id]


async def test_api_error_degrades_to_deterministic() -> None:
    maya = KnownCharacter(id=cid(), name="Maya")
    broken = ClaudeNoticer(
        client=ExplodingClient(), model="claude-sonnet-5-5", fallback=DeterministicNoticer()
    )
    notices = await broken.notice_scene(PROSE, (maya,))
    assert notices.noticed_by == "deterministic"
    assert len(notices.characters) == 1


async def test_claude_is_called_with_low_effort_and_the_configured_model() -> None:
    """Noticing is extraction, not reasoning -- it should not be billed as the latter."""
    stub = StubClient(_SceneNoticeResponse())
    await ClaudeNoticer(stub, "claude-sonnet-5-5", DeterministicNoticer()).notice_scene(
        PROSE, ()
    )
    assert stub.last_kwargs["model"] == "claude-sonnet-5-5"
    assert stub.last_kwargs["output_config"] == {"effort": "low"}
    assert stub.last_kwargs["output_format"] is _SceneNoticeResponse


async def test_claude_is_not_called_for_empty_prose() -> None:
    stub = StubClient(_SceneNoticeResponse())
    await ClaudeNoticer(stub, "claude-sonnet-5-5", DeterministicNoticer()).notice_scene("  ", ())
    assert stub.calls == 0, "do not spend money reading an empty scene"


# ----------------------------------------------------- suggestion rules


def test_suggestion_rules_are_observations_not_instructions() -> None:
    """Every message describes the current draft. None tells the author what to write."""
    from storytool.domain.graph import StoryGraph
    from storytool.domain.story.models import Story

    graph = StoryGraph(story=Story(title="S"))
    proposals = propose_suggestions(graph, NoticingState())
    for proposal in proposals:
        lowered = proposal.message.lower()
        assert "should" not in lowered
        assert "try " not in lowered


# --------------------------------------------------------- integration


async def story_with_prose(client: AsyncTestClient) -> dict:
    story_id = (
        await client.post(STORIES, json={"title": "Noticing", "premise": "A premise."})
    ).json()["id"]
    maya = (
        await client.post(f"{STORIES}/{story_id}/characters", json={"name": "Maya"})
    ).json()
    chapter = (
        await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})
    ).json()

    scene_ids = []
    for index in range(3):
        scene = (
            await client.post(
                f"{STORIES}/{story_id}/scenes",
                json={"title": f"Scene {index}", "chapter_id": chapter["id"], "sort_key": index},
            )
        ).json()
        await client.put(
            f"{STORIES}/{story_id}/scenes/{scene['id']}/content",
            json={"content": f"Maya walked the causeway. Kess was not there. ({index})"},
        )
        scene_ids.append(scene["id"])

    return {"story_id": story_id, "maya": maya, "scene_ids": scene_ids}


async def test_noticer_info_reports_what_is_reading(client: AsyncTestClient) -> None:
    info = (await client.get("/api/noticing")).json()
    assert info["noticer"] in {"deterministic", "claude"}
    assert "claude_available" in info


async def test_pass_records_mentions_and_suggests_an_arc(client: AsyncTestClient) -> None:
    """The brief's example, end to end: a character in several scenes with no arc."""
    setup = await story_with_prose(client)
    story_id = setup["story_id"]

    result = (await client.post(f"{STORIES}/{story_id}/notice")).json()
    assert result["scenes_read"] == 3
    assert result["mentions_added"] == 3

    mentions = (
        await client.get(f"{STORIES}/{story_id}/scenes/{setup['scene_ids'][0]}/mentions")
    ).json()
    assert [m["character_id"] for m in mentions] == [setup["maya"]["id"]]
    assert mentions[0]["source"] == "inferred"

    suggestions = (await client.get(f"{STORIES}/{story_id}/suggestions")).json()
    codes = {s["code"] for s in suggestions}
    assert "character.presence_without_arc" in codes
    arc_nudge = next(s for s in suggestions if s["code"] == "character.presence_without_arc")
    assert "Maya appears in 3 scenes" in arc_nudge["message"]
    assert "character.recurring_unknown_name" in codes, "Kess recurs but is not a character"


async def test_pass_is_idempotent(client: AsyncTestClient) -> None:
    setup = await story_with_prose(client)
    story_id = setup["story_id"]
    await client.post(f"{STORIES}/{story_id}/notice")
    again = (await client.post(f"{STORIES}/{story_id}/notice")).json()
    assert again["mentions_added"] == 0
    assert again["suggestions_added"] == 0


async def test_a_rejected_mention_is_never_resurrected(client: AsyncTestClient) -> None:
    """The author's curation must survive re-running the pass, or the feature is a nuisance."""
    setup = await story_with_prose(client)
    story_id, scene_id = setup["story_id"], setup["scene_ids"][0]
    await client.post(f"{STORIES}/{story_id}/notice")

    rejected = (
        await client.patch(
            f"{STORIES}/{story_id}/scenes/{scene_id}/mentions/{setup['maya']['id']}",
            json={"is_rejected": True},
        )
    ).json()
    assert rejected["is_rejected"] is True

    await client.post(f"{STORIES}/{story_id}/notice")
    mentions = (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/mentions")).json()
    assert mentions[0]["is_rejected"] is True, "the pass undid the author's decision"


async def test_confirming_a_mention_survives_a_later_pass(client: AsyncTestClient) -> None:
    setup = await story_with_prose(client)
    story_id, scene_id = setup["story_id"], setup["scene_ids"][0]
    await client.post(f"{STORIES}/{story_id}/notice")

    await client.patch(
        f"{STORIES}/{story_id}/scenes/{scene_id}/mentions/{setup['maya']['id']}",
        json={"source": "confirmed"},
    )
    await client.post(f"{STORIES}/{story_id}/notice")

    mentions = (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/mentions")).json()
    assert mentions[0]["source"] == "confirmed", "a pass must not downgrade a confirmation"


async def test_a_dismissed_suggestion_stays_dismissed(client: AsyncTestClient) -> None:
    setup = await story_with_prose(client)
    story_id = setup["story_id"]
    await client.post(f"{STORIES}/{story_id}/notice")

    suggestions = (await client.get(f"{STORIES}/{story_id}/suggestions")).json()
    target = suggestions[0]
    await client.patch(
        f"{STORIES}/{story_id}/suggestions/{target['id']}", json={"is_dismissed": True}
    )

    await client.post(f"{STORIES}/{story_id}/notice")
    visible = (await client.get(f"{STORIES}/{story_id}/suggestions")).json()
    assert target["id"] not in {s["id"] for s in visible}

    with_dismissed = (
        await client.get(f"{STORIES}/{story_id}/suggestions?include_dismissed=true")
    ).json()
    assert target["id"] in {s["id"] for s in with_dismissed}


async def test_defining_an_arc_stops_the_nudge(client: AsyncTestClient) -> None:
    """Acting on the observation resolves it, because the rule reads live state."""
    setup = await story_with_prose(client)
    story_id = setup["story_id"]
    await client.post(f"{STORIES}/{story_id}/arcs", json={"character_id": setup["maya"]["id"]})

    await client.post(f"{STORIES}/{story_id}/notice")
    codes = {s["code"] for s in (await client.get(f"{STORIES}/{story_id}/suggestions")).json()}
    assert "character.presence_without_arc" not in codes


async def test_a_pass_never_changes_structure(client: AsyncTestClient) -> None:
    """Noticing is advisory. It must not create entities or alter the ladder."""
    setup = await story_with_prose(client)
    story_id = setup["story_id"]
    before = (await client.get(f"{STORIES}/{story_id}/ladder")).json()["snapshot"]

    await client.post(f"{STORIES}/{story_id}/notice")

    after = (await client.get(f"{STORIES}/{story_id}/ladder")).json()["snapshot"]
    assert before == after, "a noticing pass must leave the story's structure untouched"


async def test_notice_on_unknown_story_is_404(client: AsyncTestClient) -> None:
    missing = "00000000-0000-7000-8000-000000000000"
    assert (await client.post(f"{STORIES}/{missing}/notice")).status_code == 404


async def test_each_unrecognised_name_gets_its_own_suggestion(client: AsyncTestClient) -> None:
    """Regression: suggestions with no entity subject once shared a dedup key, so several
    distinct unknown names collapsed into one row and the author heard about only the first.
    """
    story_id = (await client.post(STORIES, json={"title": "Names"})).json()["id"]
    chapter = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})).json()
    for index in range(2):
        scene = (
            await client.post(
                f"{STORIES}/{story_id}/scenes",
                json={"title": f"S{index}", "chapter_id": chapter["id"], "sort_key": index},
            )
        ).json()
        await client.put(
            f"{STORIES}/{story_id}/scenes/{scene['id']}/content",
            json={"content": "Kess waited. Brannoch argued. Ilsabet said nothing."},
        )

    await client.post(f"{STORIES}/{story_id}/notice")
    suggestions = (await client.get(f"{STORIES}/{story_id}/suggestions")).json()
    unknown = [s for s in suggestions if s["code"] == "character.recurring_unknown_name"]

    assert {s["subject_key"] for s in unknown} == {"Kess", "Brannoch", "Ilsabet"}
