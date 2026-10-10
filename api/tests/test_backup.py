import io
import zipfile

from tests.test_sharing import reader_headers, source_story


async def test_backup_round_trips_as_an_independent_copy(client, engine):
    sid = await source_story(client)
    backup = await client.get("/api/stories/" + sid + "/backup")
    assert backup.status_code == 200, backup.text
    assert ".storytool.json" in backup.headers["content-disposition"]
    payload = backup.json()
    assert payload["format"] == "storytool-backup"
    assert payload["state"]["annotation"], "private notes and annotations belong in a backup"

    restored = await client.post("/api/backups/import", json=payload)
    assert restored.status_code == 201, restored.text
    new_id = restored.json()["id"]
    assert new_id != sid
    copy = (await client.get("/api/stories/" + new_id + "/backup")).json()["state"]
    original = payload["state"]
    for kind in ("scene", "chapter", "character", "annotation", "scene_presence"):
        assert len(copy[kind]) == len(original[kind]), kind
    assert {row["id"] for row in copy["scene"]}.isdisjoint(row["id"] for row in original["scene"])
    assert any(row.get("content") == "Maya waits." for row in copy["scene"])
    versions = (await client.get("/api/stories/" + new_id + "/versions")).json()
    assert versions, "a restored story starts with an initial version"

    # The copy belongs to the importer only.
    stranger = await reader_headers(engine, "stranger@example.com")
    assert (await client.get("/api/stories/" + new_id, headers=stranger)).status_code == 404


async def test_backup_import_rejects_foreign_references_and_junk(client, engine):
    sid = await source_story(client)
    payload = (await client.get("/api/stories/" + sid + "/backup")).json()
    before = len((await client.get("/api/stories")).json())

    foreign = {**payload, "state": {**payload["state"]}}
    scene = dict(foreign["state"]["scene"][0])
    scene["chapter_id"] = "0190a0a0-0000-7000-8000-000000000000"
    foreign["state"]["scene"] = [scene, *foreign["state"]["scene"][1:]]
    response = await client.post("/api/backups/import", json=foreign)
    assert response.status_code == 400, response.text
    assert "outside this backup" in response.text

    for junk in (
        {"format": "other"},
        {**payload, "version": 9},
        {**payload, "state": {**payload["state"], "app_user": []}},
        {**payload, "state": {**payload["state"], "scene": [{"id": "x", "evil": 1}]}},
    ):
        assert (await client.post("/api/backups/import", json=junk)).status_code == 400
    assert len((await client.get("/api/stories")).json()) == before


async def test_manuscript_docx_contains_the_prose(client):
    sid = await source_story(client)
    response = await client.get("/api/stories/" + sid + "/manuscript.docx")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/vnd.openxmlformats")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "Maya waits." in archive.read("word/document.xml").decode()
