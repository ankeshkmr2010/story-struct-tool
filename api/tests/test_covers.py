"""Book covers and jackets: one of each per story, shown on cards and in exports."""

import base64
import io
import zipfile
from uuid import uuid4

import pytest
from PIL import Image

from storytool.domain.story import images as image_module

STORE: dict[str, bytes] = {}


@pytest.fixture(autouse=True)
def _memory_storage(monkeypatch):
    async def put(key, data, mime):
        STORE[key] = data

    async def get(key):
        return STORE[key]

    monkeypatch.setattr(image_module, "put_image", put)
    monkeypatch.setattr(image_module, "get_image", get)


def _png(color: str) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (200, 300), color).save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode()


async def _upload(client, story_id: str, name: str, color: str) -> dict:
    response = await client.post(
        f"/api/stories/{story_id}/images",
        json={"upload_id": str(uuid4()), "data": _png(color), "name": name},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_cover_and_jacket_roles_cards_and_exports(client):
    story = (await client.post("/api/stories", json={"title": "Covered"})).json()
    base = f"/api/stories/{story['id']}/images"
    first = await _upload(client, story["id"], "First", "teal")
    second = await _upload(client, story["id"], "Second", "navy")

    set_first = await client.put(base + "/cover", json={"image_id": first["id"], "focus_y": 0.2})
    assert set_first.status_code == 200 and set_first.json()["role"] == "cover"
    card = next(
        c
        for c in (await client.get("/api/library/overview")).json()["cards"]
        if c["story_id"] == story["id"]
    )
    assert card["cover_url"].endswith(f"/{first['id']}/file") and card["cover_focus_y"] == 0.2

    # One cover per story: choosing another frees the first.
    await client.put(base + "/cover", json={"image_id": second["id"]})
    roles = {image["id"]: image["role"] for image in (await client.get(base)).json()["images"]}
    assert roles == {first["id"]: None, second["id"]: "cover"}
    # The same image cannot be both cover and jacket.
    clash = await client.put(base + "/cover", json={"role": "jacket", "image_id": second["id"]})
    assert clash.status_code == 400
    jacket = await client.put(base + "/cover", json={"role": "jacket", "image_id": first["id"]})
    assert jacket.json()["role"] == "jacket"

    epub = await client.get(f"/api/stories/{story['id']}/manuscript.epub")
    book = zipfile.ZipFile(io.BytesIO(epub.content))
    assert "OEBPS/cover.xhtml" in book.namelist()
    assert 'properties="cover-image"' in book.read("OEBPS/content.opf").decode()
    plain = await client.get(f"/api/stories/{story['id']}/manuscript.docx")
    covered = await client.get(f"/api/stories/{story['id']}/manuscript.docx?cover_page=true")
    assert len(covered.content) > len(plain.content)

    # Removing the cover, or deleting its image, clears the role.
    assert (await client.put(base + "/cover", json={"image_id": None})).status_code == 200
    card = next(
        c
        for c in (await client.get("/api/library/overview")).json()["cards"]
        if c["story_id"] == story["id"]
    )
    assert card["cover_url"] is None
    await client.delete(f"{base}/{first['id']}")
    roles = {image["id"]: image["role"] for image in (await client.get(base)).json()["images"]}
    assert roles[first["id"]] is None
