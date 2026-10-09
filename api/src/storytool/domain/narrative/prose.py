"""Prose handling: word counts, revision snapshots, annotation re-anchoring, compile.

The tool augments the writer rather than replacing their drafting environment, so two
things matter more than editor features: structure stays visible beside the words, and the
manuscript can always leave as plain Markdown.
"""

import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Annotation, Scene, SceneRevision

# Words for a manuscript count, not tokens for a parser: hyphens and apostrophes stay
# inside a word, so "well-meaning" and "don't" are one word each. Markdown punctuation
# (#, *, _) contains no word characters, so it never inflates the count.
_WORD = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*", re.UNICODE)  # noqa: RUF001


def count_words(content: str | None) -> int:
    if not content:
        return 0
    return len(_WORD.findall(content))


# ------------------------------------------------------------- anchoring


@dataclass(frozen=True, slots=True)
class Anchor:
    start: int
    end: int
    is_orphaned: bool


def reanchor(quoted_text: str, old_start: int, new_content: str | None) -> Anchor:
    """Re-locate an annotation's span after the prose changed.

    Finds every occurrence of the quoted text and picks the one closest to where the
    annotation used to be -- which handles the common cases (text moved up or down because
    paragraphs were inserted or deleted above it) without guessing between duplicates.

    If the quoted text is gone entirely the annotation is marked **orphaned** and keeps its
    old offsets. A visibly broken annotation is far better than one silently repointed at
    the wrong sentence.
    """
    if not quoted_text or not new_content:
        return Anchor(start=old_start, end=old_start + len(quoted_text), is_orphaned=True)

    positions: list[int] = []
    cursor = new_content.find(quoted_text)
    while cursor != -1:
        positions.append(cursor)
        cursor = new_content.find(quoted_text, cursor + 1)

    if not positions:
        return Anchor(start=old_start, end=old_start + len(quoted_text), is_orphaned=True)

    best = min(positions, key=lambda pos: abs(pos - old_start))
    return Anchor(start=best, end=best + len(quoted_text), is_orphaned=False)


# ----------------------------------------------------------- saving prose


@dataclass(frozen=True, slots=True)
class SaveResult:
    word_count: int
    revision_created: bool
    annotations_reanchored: int
    annotations_orphaned: int


async def save_scene_content(
    session: AsyncSession,
    scene: Scene,
    content: str | None,
    *,
    snapshot: bool = False,
    snapshot_label: str | None = None,
) -> SaveResult:
    """Write prose, recompute the word-count cache, and keep annotations anchored.

    `snapshot` captures the *previous* content, so a revision is what the scene looked like
    before this save -- which is what an author reaching for history actually wants.
    """
    previous = scene.content
    unchanged = previous == content

    revision_created = False
    if snapshot and not unchanged and previous:
        session.add(
            SceneRevision(
                scene_id=scene.id,
                content=previous,
                word_count=count_words(previous),
                label=snapshot_label,
            )
        )
        revision_created = True

    scene.content = content
    # Never trusted from the client: always recomputed from the prose we just stored.
    scene.word_count = count_words(content)

    reanchored = 0
    orphaned = 0
    if not unchanged:
        annotations = (
            (await session.execute(select(Annotation).where(Annotation.scene_id == scene.id)))
            .scalars()
            .all()
        )
        for annotation in annotations:
            anchor = reanchor(annotation.quoted_text, annotation.start_offset, content)
            moved = anchor.start != annotation.start_offset
            annotation.start_offset = anchor.start
            annotation.end_offset = anchor.end
            annotation.is_orphaned = anchor.is_orphaned
            if anchor.is_orphaned:
                orphaned += 1
            elif moved:
                reanchored += 1

    await session.flush()
    return SaveResult(
        word_count=scene.word_count,
        revision_created=revision_created,
        annotations_reanchored=reanchored,
        annotations_orphaned=orphaned,
    )


# --------------------------------------------------------------- progress


@dataclass(frozen=True, slots=True)
class ChapterProgress:
    chapter_id: UUID
    number: int
    title: str | None
    word_count: int
    scene_count: int
    drafted_scene_count: int


@dataclass(frozen=True, slots=True)
class StoryProgress:
    story_id: UUID
    word_count: int
    scene_count: int
    drafted_scene_count: int
    unplaced_scene_word_count: int
    chapters: tuple[ChapterProgress, ...]


def story_progress(graph: StoryGraph) -> StoryProgress:
    """Word counts rolled up the structure. Pure -- reads the cached counts, not the prose."""
    by_chapter = graph.scenes_by_chapter()

    chapters = tuple(
        ChapterProgress(
            chapter_id=chapter.id,
            number=chapter.number,
            title=chapter.title,
            word_count=sum(s.word_count for s in by_chapter.get(chapter.id, [])),
            scene_count=len(by_chapter.get(chapter.id, [])),
            drafted_scene_count=sum(
                1 for s in by_chapter.get(chapter.id, []) if (s.content or "").strip()
            ),
        )
        for chapter in sorted(graph.chapters, key=lambda c: c.sort_key)
    )

    return StoryProgress(
        story_id=graph.story.id,
        word_count=sum(s.word_count for s in graph.scenes),
        scene_count=len(graph.scenes),
        drafted_scene_count=sum(1 for s in graph.scenes if (s.content or "").strip()),
        unplaced_scene_word_count=sum(s.word_count for s in by_chapter.get(None, [])),
        chapters=chapters,
    )


# ---------------------------------------------------------------- compile


SCENE_SEPARATOR = "\n\n* * *\n\n"


def compile_manuscript(graph: StoryGraph, *, include_unplaced: bool = True) -> str:
    """Assemble the manuscript as Markdown, in reading order.

    Export is first-class precisely because this tool augments rather than replaces: the
    writer must always be able to take the words elsewhere.
    """
    by_chapter = graph.scenes_by_chapter()
    parts: list[str] = []

    title = graph.story.title or "Untitled"
    parts.append(f"# {title}\n")
    if graph.story.premise:
        parts.append(f"*{graph.story.premise}*\n")

    from storytool.domain.ordering import chapter_order_key, scene_order_key

    for chapter in sorted(graph.chapters, key=chapter_order_key):
        heading = f"## Chapter {chapter.number}"
        if chapter.title:
            heading += f" — {chapter.title}"
        parts.append(heading + "\n")

        scenes = sorted(by_chapter.get(chapter.id, []), key=scene_order_key)
        written = [s for s in scenes if (s.content or "").strip()]
        if not written:
            # Say so rather than emitting a silent gap, so the export doubles as a
            # to-do list.
            parts.append(f"*[{len(scenes)} scene(s) not yet drafted]*\n")
            continue
        parts.append(SCENE_SEPARATOR.join((s.content or "").strip() for s in written) + "\n")

    unplaced = [s for s in by_chapter.get(None, []) if (s.content or "").strip()]
    if include_unplaced and unplaced:
        parts.append("## Unplaced scenes\n")
        parts.append(SCENE_SEPARATOR.join((s.content or "").strip() for s in unplaced) + "\n")

    return "\n".join(parts)
