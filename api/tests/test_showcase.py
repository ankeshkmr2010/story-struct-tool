from tests.test_sharing import source_story

ANON = {"Cookie": "storytool_session=not-a-session"}


async def test_showcase_is_opt_in_public_readonly_and_revocable(client):
    sid = await source_story(client)
    base = "/api/stories/" + sid
    off = await client.get(base + "/showcase")
    assert off.json() == {"enabled": False, "token": None}

    on = await client.put(base + "/showcase", json={"enabled": True})
    assert on.status_code == 200, on.text
    token = on.json()["token"]
    assert token and sid not in token

    page = await client.get("/api/showcase/" + token, headers=ANON)
    assert page.status_code == 200, page.text
    body = page.json()
    assert "Maya waits." in body["manuscript"]
    assert body["versions"] and body["changes"]
    assert "entries" in body["timeline"]
    assert "Private note" not in page.text
    assert not {"annotation", "scene_revision", "suggestion"} & body["structure"].keys()
    assert all("notes" not in row for rows in body["structure"].values() for row in rows)
    assert set(body["changes"][0]) == {"summary", "status", "created_at"}

    assert (await client.post("/api/showcase/" + token, headers=ANON)).status_code in {404, 405}

    rotated = (await client.post(base + "/showcase/rotate")).json()["token"]
    assert rotated != token
    assert (await client.get("/api/showcase/" + token, headers=ANON)).status_code == 404
    assert (await client.get("/api/showcase/" + rotated, headers=ANON)).status_code == 200

    await client.put(base + "/showcase", json={"enabled": False})
    assert (await client.get("/api/showcase/" + rotated, headers=ANON)).status_code == 404
