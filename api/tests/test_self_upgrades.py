"""Self-serve upgrades: dates, what a plan adds or removes, who can buy, who can call.

Pure: run with pytest --noconftest.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from litestar.exceptions import PermissionDeniedException

from storytool.domain.plans.models import AccessTier
from storytool.domain.plans.service import Held, TierData, combine
from storytool.domain.plans.upgrades import (
    _signed_in_person,
    add_months,
    can_buy,
    gains,
    have_through,
    payment_provider,
)


def test_months_are_calendar_months_kept_inside_the_month() -> None:
    jan31 = datetime(2027, 1, 31, 9, tzinfo=UTC)
    assert add_months(jan31, 1) == datetime(2027, 2, 28, 9, tzinfo=UTC)
    assert add_months(datetime(2028, 1, 31, tzinfo=UTC), 1).day == 29  # Leap year.
    assert add_months(jan31, 12) == datetime(2028, 1, 31, 9, tzinfo=UTC)
    assert add_months(datetime(2027, 11, 30, tzinfo=UTC), 3) == datetime(2028, 2, 29, tzinfo=UTC)


def _tier(key: str, rank: int, **features: bool) -> AccessTier:
    return AccessTier(
        id=uuid4(), key=key, name=key.title(), rank=rank, features=features, limits={}
    )


def _access(tiers: list[AccessTier], sources: list[str], overrides: dict | None = None):
    from dataclasses import replace

    access = combine([TierData.of(t) for t in tiers], overrides)
    held = tuple(Held(t.id, s) for t, s in zip(tiers, sources, strict=True))
    off = frozenset(k for k, v in (overrides or {}).items() if v is False)
    return replace(access, held=held, overridden=off)


def test_a_plan_shows_what_it_adds_and_what_it_would_drop() -> None:
    free = _tier("free", 0, images=False, design_hints=True)
    pro = _tier("pro", 10, images=True, design_hints=False)
    access = _access([free], ["default"])
    adds, _, loses = gains(access, pro)
    assert [a.key for a in adds] == ["images"]
    # The default plan stops applying once another applies, so its features can be lost.
    assert [lost.key for lost in loses] == ["design_hints"]


def test_an_account_override_keeps_a_feature_off_whatever_the_plan() -> None:
    free = _tier("free", 0, images=False)
    pro = _tier("pro", 10, images=True)
    access = _access([free], ["default"], {"images": False})
    adds, _, _ = gains(access, pro)
    assert adds == []


def test_admin_and_group_tiers_cannot_be_bought_but_subscriptions_extend() -> None:
    pro = _tier("pro", 10)
    for source, allowed in (
        ("account", False),
        ("group", False),
        ("subscription", True),
        ("default", True),
    ):
        access = _access([pro], [source])
        assert have_through(access, pro.id) == source
        assert can_buy(access, pro.id) is allowed
    assert can_buy(_access([], []), pro.id)


def test_upgrades_are_off_unless_the_stub_is_switched_on(monkeypatch: pytest.MonkeyPatch) -> None:
    from storytool import config

    monkeypatch.setattr(config.get_settings(), "self_upgrade", "off")
    assert payment_provider() is None
    monkeypatch.setattr(config.get_settings(), "self_upgrade", "stub")
    provider = payment_provider()
    assert provider is not None and provider.name == "stub"


def test_ai_connections_cannot_change_plans() -> None:
    user = uuid4()
    person = SimpleNamespace(scope={"state": {"storytool_user_id": user}})
    assert _signed_in_person(person) == user  # type: ignore[arg-type]
    agent = SimpleNamespace(
        scope={"state": {"storytool_user_id": user, "storytool_write_origin": "mcp"}}
    )
    with pytest.raises(PermissionDeniedException):
        _signed_in_person(agent)  # type: ignore[arg-type]


def test_plan_routes_are_not_lockable_and_plans_list_is_public() -> None:
    from storytool.domain.auth.access import _PUBLIC_PATHS
    from storytool.domain.plans.catalogue import features_for

    assert "/api/plans" in _PUBLIC_PATHS
    for path in ("/api/me/plan", "/api/me/upgrade", f"/api/me/upgrade/{uuid4()}/confirm"):
        assert features_for("POST", path, delegated=False) == []
