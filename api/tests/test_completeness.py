"""Tests for the mechanism the whole design rests on.

No database involved -- completeness is a pure function, which is the point.
"""

import pytest

from storytool.domain.completeness import Completeness, evaluate, is_blank
from storytool.domain.story.models import Story


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, True),
        ("", True),
        ("   ", True),
        ([], True),
        ({}, True),
        ("premise", False),
        # 0 and False are real answers, not absences -- a beat at position 0 is filled.
        (0, False),
        (False, False),
    ],
)
def test_is_blank(value: object, expected: bool) -> None:
    assert is_blank(value) is expected


def test_story_with_only_title_is_an_incomplete_placeholder() -> None:
    story = Story(title="Untitled")
    result = story.completeness
    assert result.is_complete is False
    assert result.missing == ("premise",)
    assert result.ratio == pytest.approx(0.5)


def test_story_becomes_complete_once_premise_is_set() -> None:
    story = Story(title="The Cartographer", premise="Her maps rewrite the territory.")
    assert story.is_complete is True
    assert story.completeness.missing == ()
    assert story.completeness.ratio == pytest.approx(1.0)


def test_whitespace_premise_does_not_count_as_filled() -> None:
    story = Story(title="Draft", premise="   \n  ")
    assert story.is_complete is False
    assert story.completeness.missing == ("premise",)


def test_entity_with_no_requirements_is_trivially_complete() -> None:
    class Freeform:
        pass

    result = evaluate(Freeform())
    assert result == Completeness(is_complete=True, missing=(), required=())
    assert result.ratio == 1.0
