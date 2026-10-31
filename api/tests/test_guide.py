"""Usability phase 3: the first-hour checklist and first-use tips are remembered on the account."""


async def test_guide_starts_empty_and_merges_changes(client):
    assert (await client.get("/api/auth/me")).json()["guide"] == {
        "checklist_dismissed": False,
        "check_run": False,
        "tips_off": False,
        "tips_seen": [],
    }
    await client.patch("/api/auth/profile", json={"guide": {"tip_seen": "timeline"}})
    await client.patch("/api/auth/profile", json={"guide": {"tip_seen": "timeline"}})
    updated = await client.patch("/api/auth/profile", json={"guide": {"check_run": True}})
    guide = updated.json()["guide"]
    assert guide["tips_seen"] == ["timeline"] and guide["check_run"] is True
    assert guide["checklist_dismissed"] is False
    assert (await client.get("/api/auth/me")).json()["guide"] == guide
