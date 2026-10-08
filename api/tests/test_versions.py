from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai.models import AIConnection, AIRun
from storytool.domain.narrative.models import Suggestion
from storytool.domain.versioning.models import StoryVersion
from storytool.domain.versioning.service import full_state, semantic
from tests.test_ai import outline


async def test_whole_story_restore_includes_prose_links_notes_and_deleted_entities(client, engine):
    story = (await client.post("/api/stories", json={"title": "Versioned story"})).json()
    sid = story["id"]
    base = f"/api/stories/{sid}"
    staged = (await client.post(base + "/ai/stage", json=outline())).json()
    assert (await client.post(base + f"/ai/runs/{staged['id']}/apply")).status_code == 201
    character = (await client.get(base + "/characters")).json()[0]
    scene = (await client.get(base + "/scenes")).json()[0]
    event = (await client.get(base + "/events")).json()[0]
    act = (await client.get(base + "/acts")).json()[0]
    second = (await client.post(base + "/characters", json={"name": "Finn"})).json()
    relationship = await client.post(
        base + "/relationships",
        json={
            "character_a_id": character["id"],
            "character_b_id": second["id"],
            "current_dynamic": "Trust is growing",
        },
    )
    assert relationship.status_code == 201, relationship.text
    assert (
        await client.patch(
            base + f"/acts/{act['id']}",
            json={
                "opening_turning_point_id": event["id"],
                "closing_turning_point_id": event["id"],
            },
        )
    ).status_code == 200
    prose = "Maya trusts Finn with the lantern."
    assert (
        await client.put(base + f"/scenes/{scene['id']}/content", json={"content": prose})
    ).status_code == 200
    note = await client.post(
        base + f"/scenes/{scene['id']}/annotations",
        json={
            "start_offset": 0,
            "end_offset": 4,
            "quoted_text": "Maya",
            "note": "Preserve this beat",
        },
    )
    assert note.status_code == 201, note.text
    await client.post(base + f"/scenes/{scene['id']}/revisions?label=First%20draft")
    async with AsyncSession(engine) as db:
        db.add(
            Suggestion(
                story_id=UUID(sid),
                scene_id=UUID(scene["id"]),
                code="test-gap",
                message="A dismissed note",
                is_dismissed=True,
            )
        )
        await db.commit()
    saved = (await client.post(base + "/versions", json={"label": "Before rewrite"})).json()
    async with AsyncSession(engine) as db:
        target = (
            await db.execute(select(StoryVersion).where(StoryVersion.id == UUID(saved["id"])))
        ).scalar_one()
        expected = target.state
        assert "user_id" not in expected["story"][0]
        assert "ai_connection" not in expected and "story_version" not in expected
    assert (await client.patch(base, json={"title": "Rewritten title"})).status_code == 200
    assert (await client.delete(base + f"/scenes/{scene['id']}")).status_code == 204
    assert (await client.delete(base + f"/characters/{character['id']}")).status_code == 204
    await client.post(base + "/locations", json={"name": "Temporary camp"})
    other = (await client.post("/api/stories", json={"title": "Other story stays"})).json()
    preview = (await client.get(base + f"/versions/{saved['id']}/preview")).json()
    assert preview["change_count"] > 0
    restored = await client.post(
        base + f"/versions/{saved['id']}/restore",
        json={
            "expected_fingerprint": preview["current_fingerprint"],
        },
    )
    assert restored.status_code == 201, restored.text
    assert restored.json()["recovery_version"]["source"] == "recovery"
    async with AsyncSession(engine) as db:
        actual = await full_state(db, UUID(sid))
        assert semantic(actual) == semantic(expected)
        run = await db.get(AIRun, UUID(staged["id"]))
        assert run.status == "superseded"
    assert (await client.get(base)).json()["title"] == "Versioned story"
    assert (await client.get(f"/api/stories/{other['id']}")).json()["title"] == "Other story stays"
    assert (await client.get(base + f"/scenes/{scene['id']}/content")).json()["content"] == prose
    assert (await client.post(base + f"/ai/runs/{staged['id']}/undo")).status_code == 409
    # The recovery checkpoint makes a whole-story restore itself reversible.
    recovery_id = restored.json()["recovery_version"]["id"]
    undo_preview = (await client.get(base + f"/versions/{recovery_id}/preview")).json()
    undo = await client.post(
        base + f"/versions/{recovery_id}/restore",
        json={
            "expected_fingerprint": undo_preview["current_fingerprint"],
        },
    )
    assert undo.status_code == 201, undo.text
    assert (await client.get(base)).json()["title"] == "Rewritten title"
    assert (await client.get(base + "/scenes")).json() == []


async def test_automatic_versions_coalesce_and_restore_rejects_stale_preview(client):
    sid = (await client.post("/api/stories", json={"title": "Start"})).json()["id"]
    base = f"/api/stories/{sid}"
    assert len((await client.get(base + "/versions")).json()) == 1
    await client.patch(base, json={"premise": "A lantern goes out."})
    await client.patch(base, json={"genre": "Mystery"})
    versions = (await client.get(base + "/versions")).json()
    assert len(versions) == 2
    assert versions[0]["source"] == "automatic"
    original = versions[-1]
    preview = (await client.get(base + f"/versions/{original['id']}/preview")).json()
    await client.patch(base, json={"title": "A later edit"})
    result = await client.post(
        base + f"/versions/{original['id']}/restore",
        json={
            "expected_fingerprint": preview["current_fingerprint"],
        },
    )
    assert result.status_code == 409
    assert (await client.get(base)).json()["title"] == "A later edit"
    assert len((await client.get(base + "/versions")).json()) == 2
    # Whole-story deletion must not deadlock with checkpoint foreign keys.
    assert (await client.delete(base)).status_code == 204


async def test_versions_are_private_and_credentials_are_outside_snapshots(client, engine):
    sid = (await client.post("/api/stories", json={"title": "Private"})).json()["id"]
    base = f"/api/stories/{sid}"
    version = (await client.post(base + "/versions", json={"label": "Private checkpoint"})).json()
    other = (await client.post("/api/stories", json={"title": "Another"})).json()["id"]
    assert (
        await client.get(f"/api/stories/{other}/versions/{version['id']}/preview")
    ).status_code == 404
    conn = (
        await client.put(
            "/api/ai/connections",
            json={
                "provider": "openrouter",
                "model": "test-model",
                "api_key": "private-test-key",
            },
        )
    ).json()
    await client.patch(base, json={"premise": "Changed"})
    preview = (await client.get(base + f"/versions/{version['id']}/preview")).json()
    assert (
        await client.post(
            base + f"/versions/{version['id']}/restore",
            json={
                "expected_fingerprint": preview["current_fingerprint"],
            },
        )
    ).status_code == 201
    async with AsyncSession(engine) as db:
        assert await db.get(AIConnection, UUID(conn["id"])) is not None
    client.cookies.clear()
    assert (await client.get(base + "/versions")).status_code == 401


async def test_checkpoint_failure_rolls_back_the_edit(client, monkeypatch):
    sid = (await client.post("/api/stories", json={"title": "Keep this title"})).json()["id"]
    base = f"/api/stories/{sid}"

    async def fail(*args, **kwargs):
        raise RuntimeError("Simulated checkpoint failure")

    monkeypatch.setattr("storytool.domain.versioning.service.automatic_checkpoint", fail)
    response = await client.patch(base, json={"title": "Must not be saved"})
    assert response.status_code == 503
    assert (await client.get(base)).json()["title"] == "Keep this title"
    assert len((await client.get(base + "/versions")).json()) == 1


async def test_restore_failure_rolls_back_graph_and_recovery_version(client, engine, monkeypatch):
    from storytool.domain.versioning import service

    sid = (await client.post("/api/stories", json={"title": "Original"})).json()["id"]
    base = f"/api/stories/{sid}"
    named = (await client.post(base + "/versions", json={"label": "Original"})).json()
    await client.patch(base, json={"title": "Keep the working draft"})
    await client.post(base + "/scenes", json={"title": "Keep this scene"})
    async with AsyncSession(engine) as db:
        before = await full_state(db, UUID(sid))
    count = len((await client.get(base + "/versions")).json())
    preview = (await client.get(base + f"/versions/{named['id']}/preview")).json()
    original = service.restore_state

    async def fail(*args):
        await original(*args)
        raise RuntimeError("Simulated failure after replacing the graph")

    monkeypatch.setattr(service, "restore_state", fail)
    response = await client.post(
        base + f"/versions/{named['id']}/restore",
        json={
            "expected_fingerprint": preview["current_fingerprint"],
        },
    )
    assert response.status_code == 500
    async with AsyncSession(engine) as db:
        assert semantic(await full_state(db, UUID(sid))) == semantic(before)
    assert len((await client.get(base + "/versions")).json()) == count


async def test_existing_story_gets_a_pre_edit_baseline(client, engine):
    from storytool.domain.story.models import Story

    user_id = UUID((await client.get("/api/auth/me")).json()["id"])
    async with AsyncSession(engine) as db:
        legacy = Story(user_id=user_id, title="Existing before versioning")
        db.add(legacy)
        await db.flush()
        sid = str(legacy.id)
        await db.commit()
    base = f"/api/stories/{sid}"
    assert (await client.get(base + "/versions")).json() == []
    await client.patch(base, json={"title": "The first versioned edit"})
    versions = (await client.get(base + "/versions")).json()
    assert [v["source"] for v in versions] == ["automatic", "initial"]
    async with AsyncSession(engine) as db:
        original = await db.get(StoryVersion, UUID(versions[-1]["id"]))
        assert original.state["story"][0]["title"] == "Existing before versioning"
