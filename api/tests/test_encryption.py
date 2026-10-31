"""Story text encrypted at rest (db/encryption.py): ciphertext in Postgres, plain in the API."""

import base64
import os

import pytest
from litestar.testing import AsyncTestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from storytool.config import get_settings
from storytool.db import encryption

STORIES = "/api/stories"


def use_key(monkeypatch: pytest.MonkeyPatch, spec: str) -> None:
    monkeypatch.setenv("STORYTOOL_DATA_KEYS", spec)
    get_settings.cache_clear()
    encryption._keyring.cache_clear()


def new_key(key_id: str) -> str:
    return f"{key_id}:{base64.urlsafe_b64encode(os.urandom(32)).decode()}"


@pytest.fixture
def data_key(monkeypatch: pytest.MonkeyPatch):
    use_key(monkeypatch, new_key("t1"))
    yield
    get_settings.cache_clear()
    encryption._keyring.cache_clear()


async def raw(engine: AsyncEngine, sql: str, **params: object) -> dict:
    async with engine.connect() as conn:
        return dict((await conn.execute(text(sql), params)).mappings().one())


async def test_story_text_is_ciphertext_in_postgres_and_plain_through_the_api(
    client: AsyncTestClient, engine: AsyncEngine, data_key: None
) -> None:
    story = (
        await client.post(STORIES, json={"title": "The Secret Garden", "premise": "A hidden door."})
    ).json()
    base = f"{STORIES}/{story['id']}"
    scene = (await client.post(f"{base}/scenes", json={"title": "The harbour"})).json()
    await client.put(
        f"{base}/scenes/{scene['id']}/content", json={"content": "Maya left the harbour. [TK]"}
    )
    await client.post(f"{base}/characters", json={"name": "Maya", "aliases": ["Mai"]})

    stored = await raw(engine, "select title, premise from story where id = :id", id=story["id"])
    assert all(value.startswith("enc:v1:t1:") for value in stored.values())
    assert "Secret" not in stored["title"] and "hidden" not in stored["premise"]
    prose = await raw(engine, "select content, title from scene where id = :id", id=scene["id"])
    assert prose["content"].startswith("enc:v1:") and "harbour" not in prose["content"]
    cast = await raw(
        engine,
        "select name, aliases::text as aliases from character where story_id = :id",
        id=story["id"],
    )
    assert cast["name"].startswith("enc:v1:") and "Mai" not in cast["aliases"]

    assert (await client.get(base)).json()["title"] == "The Secret Garden"
    content = (await client.get(f"{base}/scenes/{scene['id']}/content")).json()["content"]
    assert content == "Maya left the harbour. [TK]"
    characters = (await client.get(f"{base}/characters")).json()
    assert characters[0]["name"] == "Maya" and characters[0]["aliases"] == ["Mai"]

    # Search, the TK count and name ordering now run in Python over decrypted text.
    hits = (await client.get(f"{base}/search", params={"q": "HARBOUR", "context": "prose"})).json()
    assert [hit["id"] for hit in hits["items"]] == [scene["id"]]
    alias = (await client.get(f"{base}/search", params={"q": "mai", "context": "character"})).json()
    assert alias["items"][0]["title"] == "Maya"
    cards = (await client.get("/api/library/overview")).json()["cards"]
    assert next(card for card in cards if card["story_id"] == story["id"])["tk_count"] == 1


async def test_plain_rows_written_before_a_key_still_read_and_reencrypt_on_save(
    client: AsyncTestClient, engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_key(monkeypatch, "")
    story = (await client.post(STORIES, json={"title": "Plain Title"})).json()
    assert (await raw(engine, "select title from story where id = :id", id=story["id"]))[
        "title"
    ] == "Plain Title"

    use_key(monkeypatch, new_key("t1"))
    base = f"{STORIES}/{story['id']}"
    assert (await client.get(base)).json()["title"] == "Plain Title"
    await client.patch(base, json={"title": "Now Secret"})
    stored = await raw(engine, "select title from story where id = :id", id=story["id"])
    assert stored["title"].startswith("enc:v1:t1:")
    assert (await client.get(base)).json()["title"] == "Now Secret"
    get_settings.cache_clear()
    encryption._keyring.cache_clear()


async def test_duplicate_location_names_are_still_refused(
    client: AsyncTestClient, data_key: None
) -> None:
    story = (await client.post(STORIES, json={"title": "Places"})).json()
    base = f"{STORIES}/{story['id']}/locations"
    first = await client.post(base, json={"name": "The Tower"})
    assert first.status_code == 201
    assert (await client.post(base, json={"name": "The Tower"})).status_code == 409
    other = (await client.post(base, json={"name": "The Harbour"})).json()
    renamed = await client.patch(f"{base}/{other['id']}", json={"name": "The Tower"})
    assert renamed.status_code == 409
    names = [place["name"] for place in (await client.get(base)).json()]
    assert names == ["The Harbour", "The Tower"]


async def test_existing_plain_rows_are_encrypted_in_place_without_touching_updated_at(
    client: AsyncTestClient, engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    from storytool.db.encrypt_existing import encrypt_existing

    use_key(monkeypatch, "")
    story = (
        await client.post(STORIES, json={"title": "Old Plain", "premise": "Before keys."})
    ).json()
    await client.post(f"{STORIES}/{story['id']}/characters", json={"name": "Ada", "aliases": ["A"]})
    before = await raw(engine, "select updated_at from story where id = :id", id=story["id"])
    assert await encrypt_existing(engine) == {}  # No key: nothing happens.

    use_key(monkeypatch, new_key("t1"))
    # The account's seeded example stories are encrypted too, so counts are at least ours.
    counts = await encrypt_existing(engine)
    assert counts["story"] >= 1 and counts["character"] >= 1
    stored = await raw(
        engine, "select title, premise, updated_at from story where id = :id", id=story["id"]
    )
    assert stored["title"].startswith("enc:v1:t1:") and stored["premise"].startswith("enc:v1:")
    assert stored["updated_at"] == before["updated_at"]
    cast = await raw(
        engine,
        "select aliases::text as aliases from character where story_id = :id",
        id=story["id"],
    )
    assert cast["aliases"].startswith('"enc:v1:')
    assert (await encrypt_existing(engine))["story"] == 0  # Already done: idempotent.
    assert (await client.get(f"{STORIES}/{story['id']}")).json()["title"] == "Old Plain"
    get_settings.cache_clear()
    encryption._keyring.cache_clear()


async def test_rollback_mode_decrypts_every_row_and_writes_plain(
    client: AsyncTestClient, engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    from storytool.db.encrypt_existing import encrypt_existing

    use_key(monkeypatch, new_key("t1"))
    story = (await client.post(STORIES, json={"title": "Going Back", "motifs": ["rain"]})).json()
    before = await raw(engine, "select title, updated_at from story where id = :id", id=story["id"])
    assert before["title"].startswith("enc:v1:")

    monkeypatch.setenv("STORYTOOL_DATA_ENCRYPT_WRITES", "false")
    get_settings.cache_clear()
    assert (await encrypt_existing(engine))["story"] >= 1
    after = await raw(
        engine,
        "select title, motifs::text as motifs, updated_at from story where id = :id",
        id=story["id"],
    )
    assert after["title"] == "Going Back" and after["motifs"] == '["rain"]'
    assert after["updated_at"] == before["updated_at"]
    await client.patch(f"{STORIES}/{story['id']}", json={"title": "Still Plain"})
    assert (await raw(engine, "select title from story where id = :id", id=story["id"]))[
        "title"
    ] == "Still Plain"
    get_settings.cache_clear()
    encryption._keyring.cache_clear()
