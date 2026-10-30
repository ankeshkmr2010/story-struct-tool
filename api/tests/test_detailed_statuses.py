"""Scene statuses per account: new accounts start with Draft and Done only."""


async def test_new_account_starts_simple_and_can_turn_on_detailed_statuses(client):
    assert (await client.get("/api/auth/me")).json()["detailed_statuses"] is False
    updated = await client.patch("/api/auth/profile", json={"detailed_statuses": True})
    assert updated.status_code == 200 and updated.json()["detailed_statuses"] is True
    # Other profile edits leave the choice alone.
    await client.patch("/api/auth/profile", json={"author_name": "Ankesh"})
    assert (await client.get("/api/auth/me")).json()["detailed_statuses"] is True
