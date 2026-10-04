"""Integration tests for the computed layer: scaffold, ladder, health."""

from litestar.testing import AsyncTestClient

STORIES = "/api/stories"


async def make_story(client: AsyncTestClient, **fields: object) -> dict:
    payload = {"title": "The Cartographer", **fields}
    response = await client.post(STORIES, json=payload)
    assert response.status_code == 201
    return response.json()


# ------------------------------------------------------------------ scaffold


async def test_scaffold_seeds_the_three_act_framework(client: AsyncTestClient) -> None:
    story = await make_story(client)
    result = (await client.post(f"{STORIES}/{story['id']}/scaffold")).json()
    assert result["framework"] == "three_act"
    assert result["acts_created"] == 3
    assert result["beats_created"] == 7
    assert result["changed"] is True


async def test_seeded_beats_are_attached_to_their_acts(client: AsyncTestClient) -> None:
    """Guards a real bug: primary keys are None until flush, so seeding acts and beats in
    one pass without an intermediate flush silently orphans every beat."""
    story = await make_story(client)
    await client.post(f"{STORIES}/{story['id']}/scaffold")

    health = (await client.get(f"{STORIES}/{story['id']}/health")).json()
    codes = {f["code"] for f in health["findings"]}
    assert "beat.unassigned_to_act" not in codes, "seeded beats lost their act link"
    assert "act.no_beats" not in codes, "a seeded act ended up with no beats"


async def test_scaffold_is_idempotent(client: AsyncTestClient) -> None:
    story = await make_story(client)
    await client.post(f"{STORIES}/{story['id']}/scaffold")
    second = (await client.post(f"{STORIES}/{story['id']}/scaffold")).json()
    assert second["acts_created"] == 0
    assert second["beats_created"] == 0
    assert second["changed"] is False


async def test_save_the_cat_seeds_fifteen_beats(client: AsyncTestClient) -> None:
    story = await make_story(client, structure_framework="save_the_cat")
    result = (await client.post(f"{STORIES}/{story['id']}/scaffold")).json()
    assert result["beats_created"] == 15


async def test_custom_framework_seeds_nothing(client: AsyncTestClient) -> None:
    story = await make_story(client, structure_framework="custom")
    result = (await client.post(f"{STORIES}/{story['id']}/scaffold")).json()
    assert (result["acts_created"], result["beats_created"]) == (0, 0)
    assert result["changed"] is False


async def test_switching_framework_is_additive_and_keeps_existing_beats(
    client: AsyncTestClient,
) -> None:
    story = await make_story(client)
    await client.post(f"{STORIES}/{story['id']}/scaffold")  # three_act: 7 beats

    switched = (
        await client.post(f"{STORIES}/{story['id']}/scaffold?framework=save_the_cat")
    ).json()
    assert switched["beats_created"] == 15, "should seed all 15 without touching the 7"
    assert switched["acts_created"] == 0, "act numbers 1-3 already exist"

    ladder = (await client.get(f"{STORIES}/{story['id']}/ladder")).json()
    assert ladder["snapshot"]["beat_count"] == 22, "nothing may be deleted on a switch"


async def test_scaffold_on_unknown_story_is_404(client: AsyncTestClient) -> None:
    missing = "00000000-0000-7000-8000-000000000000"
    assert (await client.post(f"{STORIES}/{missing}/scaffold")).status_code == 404


# -------------------------------------------------------------------- ladder


async def test_blank_story_has_only_premise_unlocked(client: AsyncTestClient) -> None:
    story = await make_story(client)
    ladder = (await client.get(f"{STORIES}/{story['id']}/ladder")).json()

    assert len(ladder["levels"]) == 8
    assert ladder["furthest_ready_level"] == 1
    assert ladder["levels"][0]["is_ready"] is True
    assert all(rung["is_ready"] is False for rung in ladder["levels"][1:])


async def test_writing_a_premise_unlocks_the_arc_skeleton(client: AsyncTestClient) -> None:
    story = await make_story(client, premise="Her maps rewrite the territory.")
    ladder = (await client.get(f"{STORIES}/{story['id']}/ladder")).json()
    assert ladder["furthest_ready_level"] == 2
    assert ladder["levels"][1]["is_ready"] is True


async def test_ladder_blockers_explain_what_is_missing(client: AsyncTestClient) -> None:
    story = await make_story(client)
    ladder = (await client.get(f"{STORIES}/{story['id']}/ladder")).json()
    assert ladder["levels"][1]["blocked_by"] == ["The story needs a premise."]


async def test_ladder_snapshot_reflects_scaffolded_counts(client: AsyncTestClient) -> None:
    story = await make_story(client, premise="A premise.")
    await client.post(f"{STORIES}/{story['id']}/scaffold")

    snapshot = (await client.get(f"{STORIES}/{story['id']}/ladder")).json()["snapshot"]
    assert snapshot["act_count"] == 3
    assert snapshot["beat_count"] == 7
    assert snapshot["story_is_complete"] is True
    assert snapshot["character_count"] == 0


async def test_scaffolding_alone_does_not_unlock_character_dependent_levels(
    client: AsyncTestClient,
) -> None:
    """Seeding structure is not the same as doing the work -- Level 4 still needs a
    protagonist, which no framework can invent for you."""
    story = await make_story(client, premise="A premise.")
    await client.post(f"{STORIES}/{story['id']}/scaffold")

    ladder = (await client.get(f"{STORIES}/{story['id']}/ladder")).json()
    acts_rung = next(r for r in ladder["levels"] if r["level"] == 4)
    assert acts_rung["is_ready"] is False
    assert any("protagonist" in reason for reason in acts_rung["blocked_by"])


async def test_ladder_on_unknown_story_is_404(client: AsyncTestClient) -> None:
    missing = "00000000-0000-7000-8000-000000000000"
    assert (await client.get(f"{STORIES}/{missing}/ladder")).status_code == 404


# -------------------------------------------------------------------- health


async def test_bare_story_health_is_signal_not_noise(client: AsyncTestClient) -> None:
    story = await make_story(client)
    health = (await client.get(f"{STORIES}/{story['id']}/health")).json()
    assert {f["code"] for f in health["findings"]} == {
        "story.no_premise",
        "arc.too_few_turning_points",
    }
    assert health["warning_count"] == 2
    assert health["info_count"] == 0


async def test_premise_finding_clears_once_written(client: AsyncTestClient) -> None:
    story = await make_story(client, premise="Her maps rewrite the territory.")
    health = (await client.get(f"{STORIES}/{story['id']}/health")).json()
    assert "story.no_premise" not in {f["code"] for f in health["findings"]}


async def test_max_level_scopes_which_rules_run(client: AsyncTestClient) -> None:
    """The point of level scoping: early-phase stories are not buried in findings about
    structure that does not exist yet."""
    story = await make_story(client, premise="A premise.")
    await client.post(f"{STORIES}/{story['id']}/scaffold")

    at_level_1 = (await client.get(f"{STORIES}/{story['id']}/health?max_level=1")).json()
    at_level_8 = (await client.get(f"{STORIES}/{story['id']}/health?max_level=8")).json()

    assert at_level_1["findings"] == []
    assert len(at_level_8["findings"]) > 0
    assert all(f["level"] <= 8 for f in at_level_8["findings"])


async def test_scaffolded_acts_are_flagged_for_missing_emotional_shift(
    client: AsyncTestClient,
) -> None:
    """A framework can seed structure but not meaning -- the author still owes the shift."""
    story = await make_story(client, premise="A premise.")
    await client.post(f"{STORIES}/{story['id']}/scaffold")

    health = (await client.get(f"{STORIES}/{story['id']}/health")).json()
    shift_findings = [f for f in health["findings"] if f["code"] == "act.no_emotional_shift"]
    assert len(shift_findings) == 3, "one per seeded act"


async def test_findings_are_ordered_by_level(client: AsyncTestClient) -> None:
    story = await make_story(client)
    await client.post(f"{STORIES}/{story['id']}/scaffold")
    levels = [
        f["level"] for f in (await client.get(f"{STORIES}/{story['id']}/health")).json()["findings"]
    ]
    assert levels == sorted(levels)


async def test_invalid_max_level_is_rejected(client: AsyncTestClient) -> None:
    story = await make_story(client)
    assert (await client.get(f"{STORIES}/{story['id']}/health?max_level=99")).status_code == 400


async def test_health_on_unknown_story_is_404(client: AsyncTestClient) -> None:
    missing = "00000000-0000-7000-8000-000000000000"
    assert (await client.get(f"{STORIES}/{missing}/health")).status_code == 404
