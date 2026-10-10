"""Small edit safety checks, independent of the database."""

import hashlib

import pytest
from litestar.exceptions import ClientException

from storytool.domain.ai.patches import PatchConflict, field_hash, patch_list, patch_prose


def prose_data(content: str, edits: list[dict]) -> dict:
    return {"expected_content_hash": hashlib.sha256(content.encode()).hexdigest(), "edits": edits}


def test_prose_matches_original_and_preserves_untouched_text() -> None:
    text = "First. Middle. Last."
    result = patch_prose(
        text,
        prose_data(
            text,
            [
                {"find": "First.", "replace": "Opening."},
                {"find": "Middle. ", "replace": ""},
                {"find": "Last.", "replace": " Afterwards.", "action": "insert_after"},
            ],
        ),
    )
    assert result == "Opening. Last. Afterwards."


@pytest.mark.parametrize(
    "text,edits",
    [
        ("aaa", [{"find": "aa", "replace": "x"}]),  # Overlapping duplicate matches.
        ("Hello", [{"find": "missing", "replace": "x"}]),
        ("Hello", [{"find": "Hello", "replace": "x"}, {"find": "ell", "replace": "y"}]),
    ],
)
def test_ambiguous_missing_and_overlapping_edits_are_rejected(text: str, edits: list[dict]) -> None:
    with pytest.raises(ClientException):
        patch_prose(text, prose_data(text, edits))


def test_stale_prose_hash_is_rejected() -> None:
    with pytest.raises(PatchConflict):
        patch_prose("New text", prose_data("Old text", [{"find": "New", "replace": "Other"}]))


def test_list_edits_preserve_other_items_and_distinguish_null() -> None:
    original = ["a", "b", "b"]
    field, result = patch_list(
        original,
        {
            "field": "world_rules",
            "expected_field_hash": field_hash(original),
            "edits": [
                {"action": "replace", "index": 2, "expected_value": "b", "value": "c"},
                {"action": "move", "index": 0, "expected_value": "a", "to_index": 2},
            ],
        },
    )
    assert field == "world_rules" and result == ["b", "c", "a"]
    assert original == ["a", "b", "b"]
    assert field_hash(None) != field_hash([])


def test_failed_list_batch_does_not_mutate_original() -> None:
    original = ["a"]
    with pytest.raises(PatchConflict):
        patch_list(
            original,
            {
                "field": "aliases",
                "expected_field_hash": field_hash(original),
                "edits": [
                    {"action": "append", "value": "b"},
                    {"action": "remove", "index": 0, "expected_value": "wrong"},
                ],
            },
        )
    assert original == ["a"]


@pytest.mark.parametrize("find,reason", [("typo", "zero matches"), ("a", "multiple matches")])
def test_patch_error_identifies_edit_and_match_problem(find: str, reason: str) -> None:
    content = "First. a a"
    with pytest.raises(PatchConflict) as error:
        patch_prose(
            content,
            prose_data(
                content,
                [
                    {"find": "First.", "text": "Opening."},
                    {"find": find, "text": "replacement"},
                ],
            ),
        )
    assert "Edit 2:" in error.value.detail and reason in error.value.detail


def test_neutral_text_and_legacy_replace_cannot_both_be_sent() -> None:
    content = "Hello."
    assert (
        patch_prose(
            content,
            prose_data(
                content,
                [
                    {"find": "Hello.", "text": " More.", "action": "insert_after"},
                ],
            ),
        )
        == "Hello. More."
    )
    with pytest.raises(ClientException):
        patch_prose(
            content,
            prose_data(
                content,
                [
                    {"find": "Hello.", "text": "One", "replace": "Two"},
                ],
            ),
        )
