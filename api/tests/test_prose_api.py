"""Phase 3: prose, revisions, annotation anchoring, progress, export.

Two claims under test. First, the author never owns `word_count` -- the server recomputes
it from the prose on every write. Second, an annotation whose text has gone is marked
orphaned rather than silently repointed at the wrong sentence.
"""

import pytest
from litestar.testing import AsyncTestClient

from storytool.domain.narrative.prose import count_words, reanchor

STORIES = "/api/stories"


# -------------------------------------------------------- pure functions


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (None, 0),
        ("", 0),
        ("   \n  ", 0),
        ("one two three", 3),
        ("don't", 1),
        ("don’t", 1),  # noqa: RUF001
        ("well-meaning", 1),
        # Markdown punctuation must not inflate a manuscript word count.
        ("## Heading\n\nSome *emphasised* text.", 4),
        ("- bullet one\n- bullet two", 4),
    ],
)
def test_count_words(text: str | None, expected: int) -> None:
    assert count_words(text) == expected


def test_reanchor_follows_text_that_moved_down() -> None:
    old = "Alpha beta. The causeway is gone. Omega."
    new = "A new opening paragraph.\n\n" + old
    anchor = reanchor("The causeway is gone.", old.find("The causeway"), new)
    assert anchor.is_orphaned is False
    assert new[anchor.start : anchor.end] == "The causeway is gone."


def test_reanchor_orphans_text_that_is_gone() -> None:
    anchor = reanchor("The causeway is gone.", 12, "Entirely different prose now.")
    assert anchor.is_orphaned is True
    assert anchor.start == 12, "keeps its old offsets rather than guessing"


def test_reanchor_picks_the_occurrence_nearest_the_old_position() -> None:
    content = "ping ... ping ... ping"
    assert reanchor("ping", 0, content).start == 0
    assert reanchor("ping", 18, content).start == 18


def test_reanchor_orphans_when_content_is_emptied() -> None:
    assert reanchor("anything", 5, None).is_orphaned is True
    assert reanchor("anything", 5, "").is_orphaned is True


def test_compile_manuscript_structure(client: AsyncTestClient) -> None:
    """Covered end to end below; this guards the pure assembly shape."""
    from storytool.domain.graph import StoryGraph
    from storytool.domain.narrative.models import Chapter, Scene
    from storytool.domain.narrative.prose import compile_manuscript
    from storytool.domain.story.models import Story

    chapter = Chapter(story_id=None, number=1, title="Landfall")
    chapter.id = __import__("uuid_utils").uuid7()  # type: ignore[assignment]
    scene_a = Scene(story_id=None, chapter_id=chapter.id, sort_key=1, content="First words.")
    scene_b = Scene(story_id=None, chapter_id=chapter.id, sort_key=2, content="Second words.")
    graph = StoryGraph(
        story=Story(title="The Cartographer", premise="Her maps rewrite the territory."),
        chapters=(chapter,),
        scenes=(scene_a, scene_b),
    )
    out = compile_manuscript(graph)
    assert "# The Cartographer" in out
    assert "## Chapter 1 — Landfall" in out
    assert out.index("First words.") < out.index("Second words."), "reading order"
    assert "* * *" in out, "scene break between scenes"


# --------------------------------------------------------------- fixtures


async def story_with_scene(client: AsyncTestClient) -> tuple[str, str, str]:
    """Returns (story_id, chapter_id, scene_id)."""
    story_id = (
        await client.post(STORIES, json={"title": "Prose Story", "premise": "A premise."})
    ).json()["id"]
    chapter_id = (
        await client.post(
            f"{STORIES}/{story_id}/chapters", json={"number": 1, "title": "Landfall"}
        )
    ).json()["id"]
    scene_id = (
        await client.post(
            f"{STORIES}/{story_id}/scenes",
            json={"title": "The causeway", "chapter_id": chapter_id, "sort_key": 1},
        )
    ).json()["id"]
    return story_id, chapter_id, scene_id


# ------------------------------------------------------------------ prose


async def test_saving_prose_computes_word_count_server_side(client: AsyncTestClient) -> None:
    story_id, _, scene_id = await story_with_scene(client)
    url = f"{STORIES}/{story_id}/scenes/{scene_id}/content"

    saved = (await client.put(url, json={"content": "She walked the drowned causeway."})).json()
    assert saved["word_count"] == 5
    assert saved["revision_created"] is False

    fetched = (await client.get(url)).json()
    assert fetched["word_count"] == 5
    assert fetched["content"] == "She walked the drowned causeway."


async def test_client_cannot_set_word_count(client: AsyncTestClient) -> None:
    """The author owns the prose; the server owns the count derived from it."""
    story_id, _, scene_id = await story_with_scene(client)
    url = f"{STORIES}/{story_id}/scenes/{scene_id}/content"

    saved = (await client.put(url, json={"content": "three words here", "word_count": 9999})).json()
    assert saved["word_count"] == 3, "a supplied word_count must be ignored"


async def test_scene_word_count_appears_on_the_scene_itself(client: AsyncTestClient) -> None:
    story_id, _, scene_id = await story_with_scene(client)
    await client.put(
        f"{STORIES}/{story_id}/scenes/{scene_id}/content", json={"content": "one two three four"}
    )
    scene = (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}")).json()
    assert scene["word_count"] == 4


async def test_prose_does_not_affect_structural_completeness(client: AsyncTestClient) -> None:
    """Writing words is not the same as knowing what the scene is for. A fully drafted
    scene with no goal/conflict/outcome is still structurally incomplete."""
    story_id, _, scene_id = await story_with_scene(client)
    await client.put(
        f"{STORIES}/{story_id}/scenes/{scene_id}/content",
        json={"content": "A great deal of beautiful prose indeed."},
    )
    scene = (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}")).json()
    assert scene["completeness"]["is_complete"] is False
    assert "goal" in scene["completeness"]["missing"]


# -------------------------------------------------------------- revisions


async def test_snapshot_captures_the_previous_content_not_the_new_one(
    client: AsyncTestClient,
) -> None:
    """What an author reaching for history wants is what it looked like *before*."""
    story_id, _, scene_id = await story_with_scene(client)
    url = f"{STORIES}/{story_id}/scenes/{scene_id}/content"

    await client.put(url, json={"content": "First draft."})
    result = (await client.put(url, json={"content": "Second draft.", "snapshot": True})).json()
    assert result["revision_created"] is True

    revisions = (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/revisions")).json()
    assert len(revisions) == 1
    assert revisions[0]["content"] == "First draft."


async def test_no_revision_when_content_is_unchanged(client: AsyncTestClient) -> None:
    story_id, _, scene_id = await story_with_scene(client)
    url = f"{STORIES}/{story_id}/scenes/{scene_id}/content"

    await client.put(url, json={"content": "Same words."})
    result = (await client.put(url, json={"content": "Same words.", "snapshot": True})).json()
    assert result["revision_created"] is False, "autosave must not spam revisions"


async def test_revisions_are_newest_first(client: AsyncTestClient) -> None:
    story_id, _, scene_id = await story_with_scene(client)
    url = f"{STORIES}/{story_id}/scenes/{scene_id}/content"
    for text in ("one.", "two.", "three."):
        await client.put(url, json={"content": text, "snapshot": True})

    revisions = (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/revisions")).json()
    assert [r["content"] for r in revisions] == ["two.", "one."]


async def test_restoring_a_revision_is_itself_undoable(client: AsyncTestClient) -> None:
    """Recovering old text must never destroy the version being replaced."""
    story_id, _, scene_id = await story_with_scene(client)
    url = f"{STORIES}/{story_id}/scenes/{scene_id}/content"

    await client.put(url, json={"content": "The original."})
    await client.put(url, json={"content": "The rewrite.", "snapshot": True})

    revisions = (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/revisions")).json()
    original = next(r for r in revisions if r["content"] == "The original.")

    await client.post(
        f"{STORIES}/{story_id}/scenes/{scene_id}/revisions/{original['id']}/restore"
    )

    assert (await client.get(url)).json()["content"] == "The original."
    after = (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/revisions")).json()
    assert "The rewrite." in [r["content"] for r in after], "the replaced version was kept"


async def test_explicit_snapshot_with_a_label(client: AsyncTestClient) -> None:
    story_id, _, scene_id = await story_with_scene(client)
    await client.put(
        f"{STORIES}/{story_id}/scenes/{scene_id}/content", json={"content": "Act two as written."}
    )
    created = await client.post(
        f"{STORIES}/{story_id}/scenes/{scene_id}/revisions?label=before rewriting Act 2"
    )
    assert created.status_code == 201
    assert created.json()["label"] == "before rewriting Act 2"


# ------------------------------------------------------------ annotations


async def test_annotation_follows_prose_that_moved(client: AsyncTestClient) -> None:
    story_id, _, scene_id = await story_with_scene(client)
    content_url = f"{STORIES}/{story_id}/scenes/{scene_id}/content"
    original = "Alpha beta. The causeway is gone. Omega."
    await client.put(content_url, json={"content": original})

    annotation = (
        await client.post(
            f"{STORIES}/{story_id}/scenes/{scene_id}/annotations",
            json={
                "start_offset": original.find("The causeway"),
                "end_offset": original.find("The causeway") + len("The causeway is gone."),
                "quoted_text": "The causeway is gone.",
                "note": "Is this too early?",
            },
        )
    ).json()
    assert annotation["is_orphaned"] is False

    # Insert a paragraph above it.
    moved = "A new opening paragraph.\n\n" + original
    result = (await client.put(content_url, json={"content": moved})).json()
    assert result["annotations_reanchored"] == 1
    assert result["annotations_orphaned"] == 0

    updated = (
        await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/annotations")
    ).json()[0]
    assert updated["is_orphaned"] is False
    assert moved[updated["start_offset"] : updated["end_offset"]] == "The causeway is gone."


async def test_annotation_is_orphaned_not_relocated_when_its_text_is_deleted(
    client: AsyncTestClient,
) -> None:
    story_id, _, scene_id = await story_with_scene(client)
    content_url = f"{STORIES}/{story_id}/scenes/{scene_id}/content"
    await client.put(content_url, json={"content": "The causeway is gone. Omega."})

    await client.post(
        f"{STORIES}/{story_id}/scenes/{scene_id}/annotations",
        json={
            "start_offset": 0,
            "end_offset": 21,
            "quoted_text": "The causeway is gone.",
            "note": "check this",
        },
    )

    result = (await client.put(content_url, json={"content": "Something else entirely."})).json()
    assert result["annotations_orphaned"] == 1

    annotation = (
        await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/annotations")
    ).json()[0]
    assert annotation["is_orphaned"] is True
    assert annotation["note"] == "check this", "the note survives so the author can act on it"


async def test_annotation_can_be_resolved_and_deleted(client: AsyncTestClient) -> None:
    story_id, _, scene_id = await story_with_scene(client)
    await client.put(
        f"{STORIES}/{story_id}/scenes/{scene_id}/content", json={"content": "Some prose here."}
    )
    annotation = (
        await client.post(
            f"{STORIES}/{story_id}/scenes/{scene_id}/annotations",
            json={"start_offset": 0, "end_offset": 4, "quoted_text": "Some", "note": "n"},
        )
    ).json()

    resolved = (
        await client.patch(
            f"{STORIES}/{story_id}/scenes/{scene_id}/annotations/{annotation['id']}",
            json={"resolved": True},
        )
    ).json()
    assert resolved["resolved"] is True

    assert (
        await client.delete(
            f"{STORIES}/{story_id}/scenes/{scene_id}/annotations/{annotation['id']}"
        )
    ).status_code == 204
    assert (await client.get(f"{STORIES}/{story_id}/scenes/{scene_id}/annotations")).json() == []


# --------------------------------------------------------------- progress


async def test_progress_rolls_word_counts_up_the_structure(client: AsyncTestClient) -> None:
    story_id, chapter_id, scene_id = await story_with_scene(client)
    await client.put(
        f"{STORIES}/{story_id}/scenes/{scene_id}/content", json={"content": "one two three"}
    )

    second = (
        await client.post(
            f"{STORIES}/{story_id}/scenes",
            json={"title": "Second", "chapter_id": chapter_id, "sort_key": 2},
        )
    ).json()
    await client.put(
        f"{STORIES}/{story_id}/scenes/{second['id']}/content", json={"content": "four five"}
    )

    # An unplaced scene, counted separately so it cannot hide in a chapter total.
    unplaced = (
        await client.post(f"{STORIES}/{story_id}/scenes", json={"title": "Floating"})
    ).json()
    await client.put(
        f"{STORIES}/{story_id}/scenes/{unplaced['id']}/content", json={"content": "six"}
    )

    progress = (await client.get(f"{STORIES}/{story_id}/progress")).json()
    assert progress["word_count"] == 6
    assert progress["scene_count"] == 3
    assert progress["drafted_scene_count"] == 3
    assert progress["unplaced_scene_word_count"] == 1
    assert len(progress["chapters"]) == 1
    assert progress["chapters"][0]["word_count"] == 5


async def test_undrafted_scenes_count_as_scenes_but_not_as_drafted(
    client: AsyncTestClient,
) -> None:
    story_id, _, _ = await story_with_scene(client)
    progress = (await client.get(f"{STORIES}/{story_id}/progress")).json()
    assert progress["scene_count"] == 1
    assert progress["drafted_scene_count"] == 0
    assert progress["word_count"] == 0


# ----------------------------------------------------------------- export


async def test_manuscript_compiles_in_reading_order(client: AsyncTestClient) -> None:
    story_id, chapter_id, scene_id = await story_with_scene(client)
    await client.put(
        f"{STORIES}/{story_id}/scenes/{scene_id}/content", json={"content": "First words."}
    )
    second = (
        await client.post(
            f"{STORIES}/{story_id}/scenes",
            json={"title": "Second", "chapter_id": chapter_id, "sort_key": 2},
        )
    ).json()
    await client.put(
        f"{STORIES}/{story_id}/scenes/{second['id']}/content", json={"content": "Second words."}
    )

    response = await client.get(f"{STORIES}/{story_id}/manuscript")
    assert response.status_code == 200
    assert "markdown" in response.headers["content-type"]
    assert "attachment" in response.headers["content-disposition"]

    text = response.text
    assert "# Prose Story" in text
    assert "## Chapter 1 — Landfall" in text
    assert text.index("First words.") < text.index("Second words.")
    assert "* * *" in text


async def test_undrafted_chapter_is_marked_not_silently_skipped(
    client: AsyncTestClient,
) -> None:
    """The export doubles as a to-do list, which only works if gaps are visible."""
    story_id, _, _ = await story_with_scene(client)
    text = (await client.get(f"{STORIES}/{story_id}/manuscript")).text
    assert "not yet drafted" in text


async def test_unplaced_scenes_can_be_excluded_from_export(client: AsyncTestClient) -> None:
    story_id, _, _ = await story_with_scene(client)
    unplaced = (
        await client.post(f"{STORIES}/{story_id}/scenes", json={"title": "Floating"})
    ).json()
    await client.put(
        f"{STORIES}/{story_id}/scenes/{unplaced['id']}/content",
        json={"content": "Orphan prose."},
    )

    included = (await client.get(f"{STORIES}/{story_id}/manuscript")).text
    excluded = (
        await client.get(f"{STORIES}/{story_id}/manuscript?include_unplaced=false")
    ).text
    assert "Orphan prose." in included
    assert "Orphan prose." not in excluded


async def test_prose_endpoints_are_story_scoped(client: AsyncTestClient) -> None:
    _, _, scene_id = await story_with_scene(client)
    other = (await client.post(STORIES, json={"title": "Other"})).json()["id"]

    assert (
        await client.get(f"{STORIES}/{other}/scenes/{scene_id}/content")
    ).status_code == 404
    assert (
        await client.put(
            f"{STORIES}/{other}/scenes/{scene_id}/content", json={"content": "hijack"}
        )
    ).status_code == 404
