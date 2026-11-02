"""Pure tests for access tiers: combining tiers and overrides, and which requests need what."""

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


def test_restricted_keys_and_granting_tiers() -> None:
    assert _set_keys({"mcp": False, "images": True}, {"stories.max": 3}) == {"mcp", "stories.max"}
    assert _set_keys({}, {"stories.max": None}) == set()
    tiers = [tier("pro", 10), tier("free", 0, features={"mcp": False})]
    assert granting_tiers(tiers, "mcp") == ["Pro"]
