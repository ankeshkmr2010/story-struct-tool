from uuid import uuid4

from storytool.domain.cast.models import Character
from storytool.domain.completeness import evaluate
from storytool.domain.enums import Level
from storytool.domain.graph import StoryGraph
from storytool.domain.health import characters_need_want_and_need
from storytool.domain.readiness import StorySnapshot, readiness
from storytool.domain.story.models import Story
from tests.test_mcp import connect, tool


def test_character_requirements_match_role_and_arc_for_health_and_counts():
    for role, arc, required in [
        ("minor", None, False),
        ("supporting", "flat", False),
        ("supporting", "positive", True),
        ("protagonist", "flat", True),
        ("antagonist", None, True),
    ]:
        character = Character(name="A character", story_id=uuid4(), role=role, arc_type=arc)
        character.id = uuid4()
        assert ("need" in evaluate(character).required) == required
        assert evaluate(character).is_complete is not required
        graph = StoryGraph(story=Story(title="Draft"), characters=(character,))
        assert bool(tuple(characters_need_want_and_need(graph))) == required


def test_readiness_accepts_partial_act_and_never_skips_missing_prerequisites():
    snapshot = StorySnapshot(
        story_is_complete=True,
        turning_point_count=3,
        has_protagonist=True,
        complete_character_count=1,
        act_count=1,
    )
    assert readiness(Level.BEATS, snapshot).is_ready
    assert not readiness(Level.SCENES, StorySnapshot(chapter_count=1)).is_ready


async def test_plain_fields_authorship_and_lightweight_fingerprint(client):
    sid = (
        await client.post(
            "/api/stories",
            json={
                "title": "Plain fields",
                "world_rules": ["Magic costs memory"],
                "style_rules": ["Past tense"],
                "thematic_statement": "Trust has a cost",
                "motifs": ["keys"],
                "notes": "Private reference",
            },
        )
    ).json()["id"]
    base = "/api/stories/" + sid
    created = await client.post(
        base + "/characters",
        json={
            "name": "Mira",
            "role": "minor",
            "description": "An archivist",
            "aliases": ["The Keeper"],
            "relation_to_protagonist": "Neighbour",
            "notes": "Private character note",
        },
    )
    assert created.status_code == 201
    assert created.json()["completeness"]["is_complete"]
    assert created.json()["aliases"] == ["The Keeper"]
    await client.patch(
        base + "/characters/" + created.json()["id"], json={"description": "A skeptical archivist"}
    )
    provenance = (await client.get(base + "/authorship")).json()
    assert any(row["field"] == "description" and row["origin"] == "author" for row in provenance)
    assert "Private character note" not in str(provenance)
    guard = await client.get(base + "/ai/fingerprint")
    assert set(guard.json()) == {"base_fingerprint"}
    assert (
        guard.json()["base_fingerprint"]
        == (await client.get(base + "/ai/context")).json()["base_fingerprint"]
    )


async def test_mcp_delete_is_staged_recoverable_and_attributed(client):
    sid, _token, headers = await connect(client)
    base = "/api/stories/" + sid
    event = (await client.post(base + "/events", json={"label": "A discarded idea"})).json()
    guard = await tool(client, headers, "get_story_fingerprint")
    staged = await tool(
        client,
        headers,
        "stage_story_changes",
        {
            "proposal": {
                "summary": "Remove a discarded event",
                "base_fingerprint": guard["base_fingerprint"],
                "operations": [{"op": "delete", "entity": "event", "ref": event["id"], "data": {}}],
            }
        },
    )
    assert len((await client.get(base + "/events")).json()) == 1
    await tool(client, headers, "apply_story_changes", {"run_id": staged["id"]})
    assert (await client.get(base + "/events")).json() == []
    versions = (await client.get(base + "/versions")).json()
    assert any(
        row["source"] == "recovery" and row["label"] == "Before agent deletion" for row in versions
    )
    provenance = (await client.get(base + "/authorship")).json()
    assert any(row["origin"] == "mcp" and row["action"] == "delete" for row in provenance)
    await tool(client, headers, "undo_story_changes", {"run_id": staged["id"]})
    assert (await client.get(base + "/events")).json()[0]["id"] == event["id"]
