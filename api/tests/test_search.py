"""Focused search contracts; these pure checks need no database/provider."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from litestar.exceptions import ClientException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from storytool.config import Settings
from storytool.domain.search.controller import LibrarySearchController, SearchController
from storytool.domain.search.semantic import chunks, embed, search_lifespan
from storytool.domain.search.service import allowed_fields, fields_query, literal_pattern


def test_special_characters_are_literals():
    assert literal_pattern(r"100%_\sale") == r"%100\%\_\\sale%"


def test_contexts_exclude_prose_and_private_timeline_notes():
    for context in ("scene", "character", "location", "glossary_entry", "timeline"):
        assert "content" not in allowed_fields(context)
    assert "notes" not in allowed_fields("timeline")
    query = str(select(fields_query(uuid4(), "timeline")).compile(dialect=postgresql.dialect()))
    assert "scene.content" not in query
    assert "scene.notes" not in query
    assert "event.story_id" in query and "scene.story_id" in query


def test_array_fields_use_authored_items_not_json_serialization():
    query = str(
        select(fields_query(uuid4(), "character", "aliases")).compile(dialect=postgresql.dialect())
    )
    assert "jsonb_array_elements_text" in query
    assert "string_agg" in query
    assert "jsonb_typeof" in query and "CASE WHEN" in query


@pytest.mark.asyncio
async def test_pending_index_returns_searchable_state_without_provider(monkeypatch):
    import storytool.domain.search.semantic as semantic

    class DB:
        async def scalar(self, statement):
            return None

    async def provider(values):
        pytest.fail("Pending index called the embedding provider")

    monkeypatch.setattr(semantic, "embed", provider)
    page = await semantic.semantic_search(DB(), uuid4(), "prose", "door", None, 0, 20)
    assert page.indexing and page.items == []


def test_global_scene_fields_share_the_same_untitled_label():
    sql = str(
        select(fields_query(uuid4(), "all")).compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "Untitled scene" in sql and "Untitled prose" not in sql


def test_chunking_preserves_boundaries_and_tail():
    assert len(chunks("a" * 1900)) == 1
    value = "a" * 1999 + "boundary" + "z" * 2500
    parts = chunks(value)
    assert all(len(part) <= 2000 for part in parts)
    assert parts[0][-200:] == parts[1][:200]
    assert parts[-1].endswith("z" * 10)


def test_cloudflare_chunks_respect_byte_limit_and_preserve_unicode():
    value = "".join(f"{index:04d} hidden door 漢字🙂 " for index in range(200))
    parts = chunks(value, max_bytes=480)
    assert all(len(part.encode("utf-8")) <= 480 for part in parts)
    rebuilt = parts[0]
    for part in parts[1:]:
        overlap = next(
            n for n in range(min(len(part), len(rebuilt)), -1, -1) if rebuilt.endswith(part[:n])
        )
        rebuilt += part[overlap:]
    assert rebuilt == value


def test_semantic_requires_explicit_enable_and_complete_configuration():
    fields = dict(
        search_embedding_url="https://example.invalid/embeddings",
        search_embedding_model="unselected-test-model",
        search_embedding_dimensions=3,
        search_embedding_api_key="synthetic-test-key",
    )
    assert not Settings(_env_file=None, **fields).semantic_search_available
    assert not Settings(_env_file=None, semantic_search_enabled=True).semantic_search_available
    assert Settings(
        _env_file=None, semantic_search_enabled=True, **fields
    ).semantic_search_available


@pytest.mark.asyncio
async def test_disabled_semantic_never_constructs_a_provider_client(monkeypatch):
    import storytool.domain.search.semantic as semantic

    monkeypatch.setattr(semantic, "get_settings", lambda: Settings(_env_file=None))
    monkeypatch.setattr(semantic.httpx, "AsyncClient", lambda **kw: pytest.fail("Provider called"))
    with pytest.raises(ClientException) as error:
        await embed(["private prose"])
    assert error.value.status_code == 503
    async with search_lifespan(None)(None):
        pass  # A disabled worker must not access a database either.


@pytest.mark.asyncio
async def test_controller_rejects_cross_context_filters_before_querying():
    with pytest.raises(ClientException):
        await SearchController.search.fn(None, None, uuid4(), "location", "name", field="content")
    with pytest.raises(ClientException):
        await SearchController.search.fn(None, None, uuid4(), "location", "name", entity="scene")


@pytest.mark.asyncio
async def test_library_search_filters_owner_and_trash_before_results():
    owner = uuid4()
    statements = []

    class DB:
        async def execute(self, statement):
            statements.append(statement)
            return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: []))

    request = SimpleNamespace(scope={"state": {"storytool_user_id": owner}})
    page = await LibrarySearchController.search.fn(None, DB(), request, "hidden door")
    assert not page.items
    sql = str(
        statements[0].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )
    assert str(owner).replace("-", "") in sql.replace("-", "")
    assert "story.user_id =" in sql and "story.deleted_at IS NULL" in sql
    assert "scene.content" in sql


@pytest.mark.asyncio
async def test_cloudflare_oversized_inputs_rejected_before_provider(monkeypatch):
    import storytool.domain.search.semantic as semantic

    settings = Settings(
        _env_file=None,
        semantic_search_enabled=True,
        search_embedding_url="https://example.invalid/embeddings",
        search_embedding_model="test",
        search_embedding_api_key="synthetic-key",
        search_embedding_dimensions=384,
        search_embedding_max_input_bytes=480,
    )
    monkeypatch.setattr(semantic, "get_settings", lambda: settings)
    monkeypatch.setattr(semantic.httpx, "AsyncClient", lambda **kw: pytest.fail("Provider called"))
    with pytest.raises(ClientException) as error:
        await semantic.embed(["漢" * 200])
    assert error.value.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query", [b"context=prose&q=private", b"context=scene&context=prose&q=private"]
)
async def test_agents_without_prose_scope_cannot_search_prose(monkeypatch, query):
    import storytool.domain.auth.access as access
    from storytool.domain.auth.oauth import Delegation

    user_id, story_id = uuid4(), uuid4()

    async def delegated(db, token):
        return Delegation(
            user_id, story_id, datetime.now(UTC) + timedelta(hours=1), ["story:read"], True
        )

    class DB:
        async def scalar(self, statement):
            return None

    @asynccontextmanager
    async def session():
        yield DB()

    async def app(*args):
        pytest.fail("Prose search reached the handler")

    async def receive():
        pytest.fail("GET attempted to read a body")

    messages = []

    async def send(message):
        messages.append(message)

    monkeypatch.setattr(access, "delegated_access", delegated)
    middleware = access.StoryAccessMiddleware(app, SimpleNamespace(get_session=session))
    await middleware(
        {
            "type": "http",
            "method": "GET",
            "path": f"/api/stories/{story_id}/search",
            "headers": [(b"authorization", b"Bearer synthetic-token")],
            "query_string": query,
        },
        receive,
        send,
    )
    assert messages[0]["status"] == 403
