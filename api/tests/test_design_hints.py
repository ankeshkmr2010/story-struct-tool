"""Live design hints: which fields are read and which questions apply (no reader, no database).

Pure: run with pytest --noconftest.
"""

from datetime import UTC, datetime
from uuid import uuid4

from storytool.domain.cast.models import Character
from storytool.domain.decisions.design_hints import (
    CHECKS,
    LEVELS,
    applicable,
    custom_applies,
    fields_of,
)
from storytool.domain.decisions.validators import ValidatorDefinition, ValidatorOut
from storytool.domain.narrative.models import Scene


def test_fields_of_reads_planning_text_but_never_prose_or_ids() -> None:
    scene = Scene(
        id=uuid4(),
        story_id=uuid4(),
        chapter_id=uuid4(),
        title="Harbour",
        goal="Reach the boat",
        content="The full prose of the scene.",
        summary="  ",
    )
    fields = fields_of(scene)
    assert fields["title"] == "Harbour" and fields["goal"] == "Reach the boat"
    assert "content" not in fields and "summary" not in fields
    assert not any(key.endswith("_id") or key == "id" for key in fields)


def test_checks_need_their_fields_filled() -> None:
    hero = Character(id=uuid4(), story_id=uuid4(), name="Maya", want="The prize")
    state = {"level": "character", "item": fields_of(hero)}
    assert applicable("character", state) == []
    state["item"]["need"] = "Forgiveness"
    assert [c.key for c in applicable("character", state)] == ["want_need"]


def test_context_requirements_use_parent_and_story() -> None:
    state = {"level": "beat", "item": {"description": "She lies."}}
    assert [c.key for c in applicable("beat", state)] == ["beat_turn"]
    state["parent"] = {"summary": "Act one"}
    assert [c.key for c in applicable("beat", state)] == ["beat_turn", "beat_act"]
    place = {"level": "location", "item": {"description": "A city"}, "story": {}}
    assert applicable("location", place) == []
    place["story"] = {"world_rules": ["No magic"]}
    assert [c.key for c in applicable("location", place)] == ["place_rules"]


def test_every_level_has_checks_naming_real_fields() -> None:
    for level, checks in CHECKS.items():
        columns = {column.key for column in LEVELS[level].__table__.columns}
        for check in checks:
            assert check.field in columns, (level, check.key)


def _validator(**definition: object) -> ValidatorOut:
    now = datetime.now(UTC)
    return ValidatorOut(
        id=uuid4(),
        definition=ValidatorDefinition.model_validate(
            {
                "name": "Stakes named",
                "question": {"type": "noul", "instructions": "Is anything at stake?"},
                "trigger": {"type": "noul", "expected": False},
                "advice": "Name what could be lost.",
                **definition,
            }
        ),
        enabled=True,
        version=1,
        definition_hash="h",
        created_at=now,
        updated_at=now,
    )


def test_custom_checks_run_only_on_their_design_levels() -> None:
    prose = _validator()
    every = _validator(input_scope="design")
    scenes = _validator(input_scope="design", design_levels=["scene"])
    assert not custom_applies(prose, "scene")
    assert custom_applies(every, "character") and custom_applies(every, "scene")
    assert custom_applies(scenes, "scene") and not custom_applies(scenes, "character")


def test_design_hints_are_a_lockable_feature() -> None:
    from storytool.domain.plans.catalogue import feature_keys, features_for

    story = "/api/stories/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
    assert "design_hints" in feature_keys()
    assert features_for("POST", story + "/design-hints", delegated=False) == ["design_hints"]


def test_want_and_need_with_the_same_words_are_caught_without_the_reader() -> None:
    from storytool.domain.decisions.design_hints import same_text

    same = {"item": {"want": "To win the harbour race", "need": "to win the Harbour race."}}
    different = {"item": {"want": "To win the harbour race", "need": "Forgive her father"}}
    assert same_text(same, "want", "need")
    assert not same_text(different, "want", "need")
    assert not same_text({"item": {"want": "x"}}, "want", "need")
