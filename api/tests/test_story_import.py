"""Format-agnostic import: adapters (Word, Scrivener) parse; one importer saves the story."""

import io
import zipfile

import pytest

from storytool.domain.story.scrivener_import import read_scrivener, rtf_to_text

BS = chr(92)
RQUOTE = chr(0x2019)


def rtf(*paragraphs: str) -> str:
    body = (BS + "par ").join(paragraphs)
    return "{" + BS + "rtf1" + BS + "ansi{" + BS + "fonttbl" + BS + "f0 Helvetica;}" + body + "}"


def binder_item(uuid: str, kind: str, title: str, children: str = "", compile_: bool = True):
    meta = "" if compile_ else "<MetaData><IncludeInCompile>No</IncludeInCompile></MetaData>"
    inner = f"<Children>{children}</Children>" if children else ""
    return (
        f'<BinderItem UUID="{uuid}" Type="{kind}"><Title>{title}</Title>{meta}{inner}</BinderItem>'
    )


def scriv_zip() -> bytes:
    draft = binder_item(
        "D",
        "DraftFolder",
        "Manuscript",
        binder_item(
            "C1",
            "Folder",
            "Chapter One",
            binder_item("S1", "Text", "Arrival")
            + binder_item("S2", "Text", "Cut scene", compile_=False)
            + binder_item("SUB", "Folder", "Part", binder_item("S3", "Text", "Nested")),
        )
        + binder_item("L1", "Text", "Interlude"),
    )
    research = binder_item("R", "ResearchFolder", "Research", binder_item("R1", "Text", "Notes"))
    project = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<ScrivenerProject><Binder>{draft}{research}</Binder></ScrivenerProject>"
    )
    files = {
        "Novel.scriv/Novel.scrivx": project,
        "Novel.scriv/Files/Data/S1/content.rtf": rtf("Maya arrived" + BS + "'92s late.", "Rain."),
        "Novel.scriv/Files/Data/S1/synopsis.txt": "Maya reaches the harbour.",
        "Novel.scriv/Files/Data/S2/content.rtf": rtf("Never compiled."),
        "Novel.scriv/Files/Data/S3/content.rtf": rtf("Deep inside."),
        "Novel.scriv/Files/Data/L1/content.rtf": rtf("A quiet pause."),
        "Novel.scriv/Files/Data/R1/content.rtf": rtf("Research only."),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def test_rtf_to_text_keeps_prose_and_drops_formatting() -> None:
    source = (
        "{"
        + BS
        + "rtf1{"
        + BS
        + "colortbl;}Caf"
        + BS
        + "'e9 "
        + BS
        + "u8212"
        + BS
        + "'97 "
        + BS
        + "ldblquote hi"
        + BS
        + "rdblquote"
        + BS
        + "par{"
        + BS
        + "*"
        + BS
        + "annotation secret}End "
        + BS
        + "{x"
        + BS
        + "}}"
    )
    assert rtf_to_text(source) == "Café — “hi”\n\nEnd {x}"


def test_scrivener_draft_folders_become_chapters_and_scenes() -> None:
    story = read_scrivener(scriv_zip())
    assert [chapter.title for chapter in story.chapters] == ["Chapter One", "Interlude"]
    first = story.chapters[0]
    assert [scene.title for scene in first.scenes] == ["Arrival", "Nested"]
    assert first.scenes[0].prose == "Maya arrived" + RQUOTE + "s late.\n\nRain."
    assert first.scenes[0].summary == "Maya reaches the harbour."
    assert story.chapters[1].scenes[0].prose == "A quiet pause."
    assert "Research only." not in str(story) and "Never compiled." not in str(story)


@pytest.mark.parametrize(
    ("content", "message"),
    [(b"not a zip", "Choose a .zip"), (zipfile.ZipFile.__name__.encode(), "Choose a .zip")],
)
def test_scrivener_rejects_non_projects(content: bytes, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        read_scrivener(content)


async def test_import_endpoint_saves_any_adapter_output(client) -> None:
    response = await client.post(
        "/api/imports/scrivener?title=Imported%20novel",
        content=scriv_zip(),
        headers={"Content-Type": "application/zip"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["chapter_count"] == 2 and body["scene_count"] == 3
    sid = body["story"]["id"]
    scenes = (await client.get(f"/api/stories/{sid}/scenes")).json()
    arrival = next(scene for scene in scenes if scene["title"] == "Arrival")
    assert arrival["summary"] == "Maya reaches the harbour." and arrival["status"] == "drafted"
    unknown = await client.post(
        "/api/imports/pages?title=x", content=b"x", headers={"Content-Type": "application/zip"}
    )
    assert unknown.status_code == 404
