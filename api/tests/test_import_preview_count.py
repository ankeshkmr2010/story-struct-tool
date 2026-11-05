"""The import preview counts words the same way the saved story will (audit 2026-11-04)."""

from storytool.domain.narrative.prose import count_words
from storytool.domain.story.import_model import ImportedChapter, ImportedScene, ImportedStory
from storytool.domain.story.story_import import _preview


def test_preview_matches_saved_word_count() -> None:
    prose = "Maya waited — then ran.\n\n* * *\n\nThe lamp was empty."
    story = ImportedStory([ImportedChapter("One", [ImportedScene("Start", prose)])])
    preview = _preview(story)
    assert preview.word_count == count_words(prose)
    assert preview.chapters[0].scenes[0].words == count_words(prose)
    assert preview.word_count != len(prose.split())


def test_import_diagnostic_counts_like_the_saved_story() -> None:
    from storytool.domain.story.block_import import Block, inspect_blocks

    text = "Maya waited — then ran to the harbour. The lamp was empty."
    stats = inspect_blocks([Block(0, text, "Normal", False, False, False)])
    assert stats["stats"]["words"] == count_words(text) == 11
