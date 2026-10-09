"""Permanent deletion is explicit, owner-only, Trash-only, and physically removes database rows."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai.models import AgentToken, AIRun
from storytool.domain.narrative.models import Annotation, Scene, SceneRevision
from storytool.domain.story.models import Story
from storytool.domain.versioning.models import StoryVersion
from tests.test_ai import outline


async def test_permanent_delete_cascades_only_trashed_story_and_history(client, engine):
    story = (await client.post("/api/stories", json={"title": "Purge test"})).json()
    sid = story["id"]
    base = f"/api/stories/{sid}"
    data = {"confirmation": "DELETE", "expected_title": "Purge test"}
    assert (await client.post(base + "/purge", json=data)).status_code == 409
    run = (await client.post(base + "/ai/stage", json=outline())).json()
    await client.post(base + f"/ai/runs/{run['id']}/apply")
    scene = (await client.get(base + "/scenes")).json()[0]
    await client.put(base + f"/scenes/{scene['id']}/content", json={"content": "Maya waits."})
    await client.post(base + f"/scenes/{scene['id']}/revisions")
    await client.post(
        base + f"/scenes/{scene['id']}/annotations",
        json={"start_offset": 0, "end_offset": 4, "quoted_text": "Maya", "note": "Keep"},
    )
    token = (await client.post("/api/ai/agent-tokens", json={"story_id": sid})).json()
    other = (await client.post("/api/stories", json={"title": "Keep other story"})).json()
    await client.delete(base)
    assert (
        await client.post(base + "/purge", json={"expected_title": "Purge test"})
    ).status_code == 400
    assert (
        await client.post(
            base + "/purge", json={"confirmation": "DELETE", "expected_title": "Wrong story"}
        )
    ).status_code == 409
    assert (
        await client.post(
            base + "/purge", headers={"Authorization": "Bearer " + token["token"]}, json=data
        )
    ).status_code == 401
    assert (await client.post(base + "/purge", json=data)).status_code == 204
    async with AsyncSession(engine) as db:
        assert await db.get(Story, UUID(sid)) is None
        for model in [Scene, StoryVersion, AIRun, AgentToken]:
            assert await db.scalar(select(model.id).where(model.story_id == UUID(sid))) is None
        for model in [Annotation, SceneRevision]:
            assert (
                await db.scalar(select(model.id).where(model.scene_id == UUID(scene["id"]))) is None
            )
        assert await db.get(Story, UUID(other["id"])) is not None
    assert (await client.post(base + "/restore")).status_code == 404
