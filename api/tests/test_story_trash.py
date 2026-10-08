"""Deletion preserves the full story graph, checkpoints, and private recovery."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.story.models import Story
from storytool.domain.versioning.models import StoryVersion
from tests.test_ai import outline


async def test_trash_preserves_graph_prose_versions_and_restores(client, engine):
    story = (await client.post("/api/stories", json={"title": "Keep my draft"})).json()
    base = f"/api/stories/{story['id']}"
    proposal = (await client.post(base + "/ai/stage", json=outline())).json()
    await client.post(base + f"/ai/runs/{proposal['id']}/apply")
    scene = (await client.get(base + "/scenes")).json()[0]
    await client.put(base + f"/scenes/{scene['id']}/content", json={"content": "Maya trusts Eli."})
    versions = (await client.get(base + "/versions")).json()
    token = (await client.post("/api/ai/agent-tokens", json={"story_id": story["id"]})).json()
    headers = {"Authorization": "Bearer " + token["token"]}
    assert (await client.delete(base)).status_code == 204
    assert (await client.get("/api/stories")).json() == []
    trash = (await client.get("/api/stories?trashed=true")).json()
    assert trash[0]["id"] == story["id"] and trash[0]["deleted_at"]
    assert (await client.get(base)).status_code == 410
    assert (await client.patch(base, json={"title": "Lost"})).status_code == 410
    assert (
        await client.put(base + f"/scenes/{scene['id']}/content", json={"content": "Lost"})
    ).status_code == 410
    assert (await client.get(base + "/ai/context", headers=headers)).status_code == 410
    assert (await client.post("/mcp", headers=headers, json={})).status_code == 401
    async with AsyncSession(engine) as db:
        row = await db.get(Story, UUID(story["id"]))
        assert row.deleted_at is not None
        saved = list(
            (await db.scalars(select(StoryVersion).where(StoryVersion.story_id == row.id))).all()
        )
        assert len(saved) == len(versions) + 1
        assert saved[-1].story_id == row.id
    assert (await client.delete(base)).status_code == 204
    restored = await client.post(base + "/restore")
    assert restored.status_code == 201 and restored.json()["deleted_at"] is None
    assert (await client.get("/api/stories?trashed=true")).json() == []
    assert (await client.get(base + f"/scenes/{scene['id']}/content")).json()[
        "content"
    ] == "Maya trusts Eli."
    assert len((await client.get(base + "/versions")).json()) == len(versions) + 1
    assert (await client.get(base + "/ai/context", headers=headers)).status_code == 200
    assert (await client.post(base + "/restore")).status_code == 201


async def test_trash_recovery_is_private_and_version_restore_cannot_change_deletion_state(
    client, engine
):
    story = (await client.post("/api/stories", json={"title": "Private draft"})).json()
    base = f"/api/stories/{story['id']}"
    version = (await client.post(base + "/versions", json={"label": "Keep"})).json()
    await client.delete(base)
    assert (
        await client.post(
            base + f"/versions/{version['id']}/restore", json={"expected_fingerprint": "a" * 64}
        )
    ).status_code == 410
    # A different authenticated principal cannot list or restore this account's Trash.
    import hashlib
    from datetime import UTC, datetime, timedelta

    from storytool.domain.auth.models import User, UserSession

    async with AsyncSession(engine) as db:
        intruder = User(google_sub="trash-intruder", email="other@example.invalid")
        db.add(intruder)
        await db.flush()
        db.add(
            UserSession(
                user_id=intruder.id,
                token_hash=hashlib.sha256(b"trash-other-session").hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await db.commit()
    client.cookies.set("storytool_session", "trash-other-session", path="/api")
    assert (await client.get("/api/stories?trashed=true")).json() == []
    assert (await client.post(base + "/restore")).status_code == 404
    client.cookies.set("storytool_session", "test-session", path="/api")
    await client.post(base + "/restore")
    read = (await client.get(base + f"/versions/{version['id']}")).json()
    assert "deleted_at" not in read["state"]["story"][0]


async def test_failed_delete_checkpoint_keeps_story_in_library(client, monkeypatch):
    story = (await client.post("/api/stories", json={"title": "Safe"})).json()
    from storytool.domain.versioning import service

    async def fail(*args, **kwargs):
        raise RuntimeError("Checkpoint unavailable")

    monkeypatch.setattr(service, "checkpoint", fail)
    assert (await client.delete(f"/api/stories/{story['id']}")).status_code == 500
    assert (await client.get("/api/stories")).json()[0]["id"] == story["id"]
    assert (await client.get("/api/stories?trashed=true")).json() == []
