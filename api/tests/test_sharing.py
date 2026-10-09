import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai.commands import ENTITIES, LINKS
from storytool.domain.auth.models import User, UserSession
from storytool.domain.versioning.service import full_state
from tests.test_ai import outline


async def reader_headers(engine, email="reader@example.com"):
    async with AsyncSession(engine) as db:
        user = User(google_sub=email, email=email, name="Reader")
        db.add(user)
        await db.flush()
        db.add(
            UserSession(
                user_id=user.id,
                token_hash=hashlib.sha256(email.encode()).hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await db.commit()
    return {"Cookie": "storytool_session=" + email}


async def source_story(client):
    story = (await client.post("/api/stories", json={"title": "Shared draft"})).json()
    base = "/api/stories/" + story["id"]
    staged = await client.post(base + "/ai/stage", json=outline())
    assert staged.status_code == 201, staged.text
    applied = await client.post(base + "/ai/runs/" + staged.json()["id"] + "/apply")
    assert applied.status_code == 201, applied.text
    scene = (await client.get(base + "/scenes")).json()[0]
    await client.put(base + "/scenes/" + scene["id"] + "/content", json={"content": "Maya waits."})
    await client.post(
        base + "/scenes/" + scene["id"] + "/annotations",
        json={"start_offset": 0, "end_offset": 4, "quoted_text": "Maya", "note": "Private note"},
    )
    return story["id"]


async def test_sharing_is_readonly_email_scoped_and_import_requires_permission(client, engine):
    sid = await source_story(client)
    reader = await reader_headers(engine)
    stranger = await reader_headers(engine, "stranger@example.com")
    base = "/api/stories/" + sid
    grant = await client.put(base + "/shares", json={"recipient_email": " READER@example.com "})
    assert grant.status_code == 200, grant.text
    assert grant.json()["recipient_email"] == "reader@example.com"
    shared = await client.get("/api/shared-stories/" + sid, headers=reader)
    assert shared.status_code == 200, shared.text
    assert "Maya waits." in shared.json()["manuscript"]
    assert "Private note" not in shared.text
    assert (
        not {"annotation", "scene_revision", "suggestion", "ai_run"}
        & shared.json()["structure"].keys()
    )
    assert "user_id" not in shared.json()["structure"]["story"][0]
    assert len((await client.get("/api/shared-stories", headers=reader)).json()) == 1
    assert (await client.get("/api/shared-stories", headers=stranger)).json() == []
    assert (await client.get("/api/shared-stories/" + sid, headers=stranger)).status_code == 404
    assert (await client.get(base, headers=reader)).status_code == 404
    assert (await client.patch(base, headers=reader, json={"title": "Hijacked"})).status_code == 404
    assert (await client.delete(base, headers=reader)).status_code == 404
    assert (await client.get(base + "/shares", headers=reader)).status_code == 404
    assert (
        await client.post("/api/ai/agent-tokens", headers=reader, json={"story_id": sid})
    ).status_code == 404
    copied = await client.post(
        "/api/shared-stories/" + sid + "/import",
        headers=reader,
        json={"expected_fingerprint": shared.json()["base_fingerprint"]},
    )
    assert copied.status_code == 403
    token = (await client.post("/api/ai/agent-tokens", json={"story_id": sid})).json()["token"]
    assert (
        await client.get(base + "/shares", headers={"Authorization": "Bearer " + token})
    ).status_code == 403
    assert (
        await client.get("/api/shared-stories", headers={"Authorization": "Bearer " + token})
    ).status_code == 401
    await client.delete(base + "/shares/" + grant.json()["id"])
    assert (await client.get("/api/shared-stories/" + sid, headers=reader)).status_code == 404
    client.cookies.clear()
    assert (await client.get("/api/shared-stories/" + sid)).status_code == 401


async def test_import_remaps_graph_links_preserves_source_and_survives_revocation_and_purge(
    client, engine
):
    sid = await source_story(client)
    reader = await reader_headers(engine)
    base = "/api/stories/" + sid
    chapter_id = (await client.get(base + "/chapters")).json()[0]["id"]
    for title in ("Second passage", "Third passage"):
        await client.post(base + "/scenes", json={"title": title, "chapter_id": chapter_id})
    await client.put(
        base + "/shares", json={"recipient_email": "reader@example.com", "allow_import": True}
    )
    shared = (await client.get("/api/shared-stories/" + sid, headers=reader)).json()
    copied = await client.post(
        "/api/shared-stories/" + sid + "/import",
        headers=reader,
        json={"expected_fingerprint": shared["base_fingerprint"]},
    )
    assert copied.status_code == 201, copied.text
    copy_id = copied.json()["id"]
    assert copy_id != sid and copied.json()["parent_story_id"] == sid
    async with AsyncSession(engine) as db:
        original = await full_state(db, UUID(sid))
        imported = await full_state(db, UUID(copy_id))
    for kind in (*ENTITIES, *LINKS):
        assert len(original[kind]) == len(imported[kind]), kind
    assert [row["title"] for row in original["scene"]] == [
        row["title"] for row in imported["scene"]
    ]
    original_ids = {row["id"] for kind in ENTITIES for row in original[kind]}
    imported_ids = {row["id"] for kind in ENTITIES for row in imported[kind]}
    assert not original_ids & imported_ids
    for kind, (model, _, _) in ENTITIES.items():
        for row in imported[kind]:
            for column in model.__table__.c:
                if column.foreign_keys and column.name in row and row[column.name] is not None:
                    assert row[column.name] in imported_ids, (kind, column.name)
    for kind, (table, _, _, _, _) in LINKS.items():
        for row in imported[kind]:
            for column in table.c:
                if column.foreign_keys:
                    assert row[column.name] in imported_ids
    assert original["annotation"] and imported["annotation"] == []
    assert imported["scene_revision"] == []
    copy_base = "/api/stories/" + copy_id
    versions = (await client.get(copy_base + "/versions", headers=reader)).json()
    assert len(versions) == 1 and versions[0]["source"] == "initial"
    assert (await client.get(copy_base + "/ai/runs", headers=reader)).json() == []
    assert (
        await client.patch(copy_base, headers=reader, json={"title": "My independent draft"})
    ).status_code == 200
    assert (await client.get(base)).json()["title"] == "Shared draft"
    await client.delete(base)
    assert (await client.get("/api/shared-stories/" + sid, headers=reader)).status_code == 404
    await client.post(
        base + "/purge", json={"confirmation": "DELETE", "expected_title": "Shared draft"}
    )
    surviving = await client.get(copy_base, headers=reader)
    assert surviving.status_code == 200
    assert surviving.json()["parent_story_id"] is None
    assert surviving.json()["title"] == "My independent draft"


async def test_import_rechecks_permission_and_current_story_and_share_upserts(client, engine):
    sid = await source_story(client)
    reader = await reader_headers(engine)
    base = "/api/stories/" + sid
    first = (
        await client.put(
            base + "/shares", json={"recipient_email": "reader@example.com", "allow_import": True}
        )
    ).json()
    shared = (await client.get("/api/shared-stories/" + sid, headers=reader)).json()
    await client.patch(base, json={"title": "Changed while reading"})
    result = await client.post(
        "/api/shared-stories/" + sid + "/import",
        headers=reader,
        json={"expected_fingerprint": shared["base_fingerprint"]},
    )
    assert result.status_code == 409
    second = (
        await client.put(
            base + "/shares", json={"recipient_email": "READER@example.com", "allow_import": False}
        )
    ).json()
    assert first["id"] == second["id"]
    assert len((await client.get(base + "/shares")).json()) == 1
    current = (await client.get("/api/shared-stories/" + sid, headers=reader)).json()
    denied = await client.post(
        "/api/shared-stories/" + sid + "/import",
        headers=reader,
        json={"expected_fingerprint": current["base_fingerprint"]},
    )
    assert denied.status_code == 403
    await client.delete(base + "/shares/" + first["id"])
    denied = await client.post(
        "/api/shared-stories/" + sid + "/import",
        headers=reader,
        json={"expected_fingerprint": current["base_fingerprint"]},
    )
    assert denied.status_code == 404
    assert (await client.get("/api/stories", headers=reader)).json() == []
