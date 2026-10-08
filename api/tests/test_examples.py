"""Starter examples are independent per account and provisioned only once."""

import asyncio
from uuid import UUID

from litestar.testing import AsyncTestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from storytool.domain.auth.models import User
from storytool.domain.story.models import Story
from storytool.examples.provision import ensure_starter_examples
from storytool.examples.tutorial import TITLE as TUTORIAL_TITLE

TITLES = {"The Blue Carbuncle", "The Red-Headed League", "The Hobbit", TUTORIAL_TITLE}


async def provision(engine: AsyncEngine, user_id: UUID) -> None:
    async with AsyncSession(engine) as session:
        await ensure_starter_examples(session, user_id)
        await session.commit()


async def test_examples_have_private_entities_and_preserve_edits_and_deletions(
    client: AsyncTestClient,
    engine: AsyncEngine,
) -> None:
    user_id = UUID((await client.get("/api/auth/me")).json()["id"])
    async with AsyncSession(engine) as session:
        other = User(google_sub="examples-other", email="other@example.com")
        session.add(other)
        await session.flush()
        other_id = other.id
        await session.commit()
    await provision(engine, user_id)
    await provision(engine, other_id)
    stories = (await client.get("/api/stories")).json()
    assert {story["title"] for story in stories} == TITLES
    async with AsyncSession(engine) as session:
        other_stories = list(
            (await session.execute(select(Story).where(Story.user_id == other_id))).scalars()
        )
        assert {story.title for story in other_stories} == TITLES
        assert not {str(story.id) for story in other_stories} & {story["id"] for story in stories}
        assert (await client.get(f"/api/stories/{other_stories[0].id}/timeline")).status_code == 404
    for story in stories:
        report = (await client.get(f"/api/stories/{story['id']}/timeline")).json()
        assert report["characters"]
        assert report["entries"]
        assert all(
            entry["location_name"] and entry["participants"]
            for entry in report["entries"]
            if entry["ordinal"] is not None
        )
    blue = next(story for story in stories if story["title"] == "The Blue Carbuncle")
    hobbit = next(story for story in stories if story["title"] == "The Hobbit")
    await client.patch(f"/api/stories/{hobbit['id']}", json={"title": "My edited study"})
    await client.delete(f"/api/stories/{blue['id']}")
    await provision(engine, user_id)
    assert {story["title"] for story in (await client.get("/api/stories")).json()} == {
        "My edited study",
        "The Red-Headed League",
        TUTORIAL_TITLE,
    }
    async with AsyncSession(engine) as session:
        assert {
            story.title
            for story in (
                await session.execute(select(Story).where(Story.user_id == other_id))
            ).scalars()
        } == TITLES


async def test_concurrent_provisioning_creates_one_set_of_examples(
    client: AsyncTestClient,
    engine: AsyncEngine,
) -> None:
    user_id = UUID((await client.get("/api/auth/me")).json()["id"])
    await asyncio.gather(provision(engine, user_id), provision(engine, user_id))
    stories = (await client.get("/api/stories")).json()
    assert len(stories) == 4
    assert {story["title"] for story in stories} == TITLES


async def test_existing_example_is_adopted_without_replacing_user_content(
    client: AsyncTestClient,
    engine: AsyncEngine,
) -> None:
    user_id = UUID((await client.get("/api/auth/me")).json()["id"])
    existing = (
        await client.post(
            "/api/stories",
            json={
                "title": "The Red-Headed League",
                "premise": "My annotated version",
            },
        )
    ).json()
    await provision(engine, user_id)
    stories = (await client.get("/api/stories")).json()
    assert len(stories) == 4
    red = next(story for story in stories if story["title"] == "The Red-Headed League")
    assert red["id"] == existing["id"]
    assert red["premise"] == "My annotated version"


async def test_tutorial_explains_world_time_arcs_and_independent_draft_status(
    client: AsyncTestClient,
    engine: AsyncEngine,
) -> None:
    user_id = UUID((await client.get("/api/auth/me")).json()["id"])
    await provision(engine, user_id)
    tutorial = next(
        item
        for item in (await client.get("/api/stories")).json()
        if item["title"] == TUTORIAL_TITLE
    )
    base = f"/api/stories/{tutorial['id']}"
    report = (await client.get(f"{base}/timeline")).json()
    events = [entry for entry in report["entries"] if entry["kind"] == "event"]
    assert [entry["ordinal"] for entry in events] == [10, 30, 40, 50, 60, 70]
    reading = sorted(events, key=lambda entry: entry["reading_order"])
    assert [entry["ordinal"] for entry in reading] == [30, 10, 40, 50, 60, 70]
    assert events[0]["is_flashback"] is True
    assert all(entry["arc_stages"] for entry in events)
    assert "We share responsibility" in events[-1]["arc_stages"][0]
    scenes = (await client.get(f"{base}/scenes")).json()
    practice = next(item for item in scenes if item["title"].startswith("Practice placeholder"))
    assert set(practice["completeness"]["missing"]) == {
        "goal",
        "conflict",
        "outcome",
        "pov_character_id",
    }
    mara = next(
        item for item in (await client.get(f"{base}/characters")).json() if item["name"] == "Mara"
    )
    updated = (
        await client.patch(
            f"{base}/scenes/{practice['id']}",
            json={
                "goal": "Plan a new coda",
                "conflict": "A different storm tests the habit",
                "outcome": "Mara asks for help immediately",
                "pov_character_id": mara["id"],
            },
        )
    ).json()
    assert updated["completeness"]["is_complete"] is True
    assert updated["status"] == "placeholder", (
        "Completeness does not change the author-selected draft status"
    )
    drafted = (
        await client.patch(f"{base}/scenes/{practice['id']}", json={"status": "outlined"})
    ).json()
    assert drafted["status"] == "outlined"


async def test_version_two_adds_only_the_tutorial_without_resurrecting_deleted_examples(
    client: AsyncTestClient,
    engine: AsyncEngine,
) -> None:
    user_id = UUID((await client.get("/api/auth/me")).json()["id"])
    custom = (await client.post("/api/stories", json={"title": "My renamed Hobbit"})).json()
    async with AsyncSession(engine) as session:
        user = await session.get(User, user_id)
        user.examples_seed_version = 1
        await session.commit()
    await provision(engine, user_id)
    stories = (await client.get("/api/stories")).json()
    assert {item["title"] for item in stories} == {"My renamed Hobbit", TUTORIAL_TITLE}
    assert (
        next(item for item in stories if item["title"] == "My renamed Hobbit")["id"] == custom["id"]
    )
