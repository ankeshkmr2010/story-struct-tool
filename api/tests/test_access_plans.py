"""Pure tests for access tiers: combining tiers and overrides, and which requests need what."""

import pytest

from storytool.domain.plans.catalogue import creates_story, feature_keys, features_for
from storytool.domain.plans.service import TierData, _set_keys, combine, granting_tiers

S = "/api/stories/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"


def tier(key: str, rank: int = 0, **kw: dict) -> TierData:
    return TierData(key, key.title(), rank, kw.get("features", {}), kw.get("limits", {}))


def test_no_tiers_means_everything_is_on_and_unlimited() -> None:
    access = combine([])
    assert all(access.features.values())
    assert access.limits["stories.max"] is None


def test_feature_on_if_any_tier_leaves_it_on_and_limits_most_generous() -> None:
    free = tier("free", 0, features={"mcp": False, "images": False}, limits={"stories.max": 2})
    pro = tier("pro", 10, features={"images": False}, limits={"stories.max": 20})
    access = combine([free, pro])
    assert access.allows("mcp") and not access.allows("images")
    assert access.limits["stories.max"] == 20
    assert [t.key for t in access.tiers] == ["pro", "free"]
    assert combine([free, tier("open")]).limits["stories.max"] is None


def test_overrides_win_and_unknown_keys_are_ignored() -> None:
    free = tier("free", features={"mcp": False}, limits={"stories.max": 2})
    access = combine([free], {"mcp": True, "nope": False}, {"stories.max": None})
    assert access.allows("mcp") and access.allows("nope")
    assert access.limits["stories.max"] is None
    assert not combine([], {"images": False}).allows("images")


def test_routes_name_their_features() -> None:
    assert features_for("GET", S + "/scenes", delegated=False) == []
    assert features_for("GET", S + "/scenes", delegated=True) == ["mcp"]
    assert features_for("POST", S + "/setups/marks", delegated=True) == ["mcp", "setups"]
    assert features_for("PATCH", S + "/setups/marks/x", delegated=False) == []
    assert features_for("PUT", S + "/shares", delegated=False) == ["sharing"]
    assert features_for("GET", S + "/manuscript.pdf", delegated=False) == ["export.formatted"]
    assert features_for("GET", S + "/manuscript.zip", delegated=False) == []
    assert features_for("POST", "/api/imports/docx/uploads", delegated=False) == ["import"]
    assert features_for("GET", S + "/evaluations/setup_marks", delegated=False) == [
        "check.setup_marks"
    ]
    assert features_for("GET", S + "/evaluations", delegated=False) == []
    assert "check.setup_marks" in feature_keys()


def test_story_creating_requests() -> None:
    assert creates_story("POST", "/api/stories")
    assert creates_story("POST", "/api/imports/docx")
    assert creates_story("POST", "/api/backups/import")
    assert not creates_story("POST", "/api/imports/docx/uploads")
    assert not creates_story("GET", "/api/stories")


@pytest.mark.parametrize("delegated", [False, True])
@pytest.mark.parametrize(
    "suffix",
    ["", "/shared-reader", "/scene-reader", "/ai-review", "/reader-verify", "/package", "/reports"],
)
def test_every_check_execution_path_requires_the_check(delegated: bool, suffix: str) -> None:
    method = "GET" if suffix in {"", "/package", "/reports"} else "POST"
    needed = features_for(method, S + "/evaluations/continuity" + suffix, delegated=delegated)
    assert "check.continuity" in needed
    assert ("mcp" in needed) == delegated
    if suffix in {"/scene-reader", "/shared-reader"}:
        assert "shared_reader" in needed


def test_batch_reader_cannot_bypass_individual_check_locks() -> None:
    from storytool.domain.evaluation.scene_reader import CHECKS

    needed = features_for("POST", S + "/evaluations/scene-reader", delegated=True)
    assert set(needed) == {"mcp", "shared_reader", *(f"check.{key}" for key in CHECKS)}


@pytest.mark.parametrize("delegated", [False, True])
async def test_locked_check_refused_before_execution(monkeypatch, delegated: bool) -> None:
    from contextlib import asynccontextmanager
    from types import SimpleNamespace

    from storytool.domain.plans import middleware

    class Session:
        async def scalars(self, query):
            return []

    @asynccontextmanager
    async def session():
        yield Session()

    async def restricted(db):
        return {"check.continuity"}

    async def access(db, user_id):
        return combine([], {"check.continuity": False})

    async def execution(scope, receive, send):
        pytest.fail("Locked check reached execution/provider")

    monkeypatch.setattr(middleware, "restricted_keys", restricted)
    monkeypatch.setattr(middleware, "resolve", access)
    guard = middleware.PlanAccessMiddleware(execution, SimpleNamespace(get_session=session))
    messages = []

    async def send(message):
        messages.append(message)

    for suffix in ["/continuity", "/continuity/scene-reader", "/scene-reader"]:
        messages.clear()
        await guard(
            {
                "type": "http",
                "method": "GET" if suffix == "/continuity" else "POST",
                "path": S + "/evaluations" + suffix,
                "state": {
                    "storytool_user_id": "qa",
                    "storytool_write_origin": "mcp" if delegated else "browser",
                },
            },
            None,
            send,
        )
        assert messages[0]["status"] == 403
        assert b'"feature": "check.continuity"' in messages[1]["body"]


def test_restricted_keys_and_granting_tiers() -> None:
    assert _set_keys({"mcp": False, "images": True}, {"stories.max": 3}) == {"mcp", "stories.max"}
    assert _set_keys({}, {"stories.max": None}) == set()
    tiers = [tier("pro", 10), tier("free", 0, features={"mcp": False})]
    assert granting_tiers(tiers, "mcp") == ["Pro"]
