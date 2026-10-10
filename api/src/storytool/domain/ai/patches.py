"""Small, exact edits. Helpers compute a result before any database mutation."""

import hashlib
import json
from typing import Literal

from litestar.exceptions import ClientException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError

LIST_FIELDS = {
    "story": {"world_rules", "style_rules", "motifs"},
    "character": {"aliases"},
    "glossary_entry": {"aliases"},
}


class PatchConflict(ClientException):
    status_code = 409


def field_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()


class TextEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    find: str = Field(min_length=1, max_length=200000)
    replace: str = Field(max_length=200000)
    action: Literal["replace", "insert_before", "insert_after"] = "replace"


class ProsePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    edits: list[TextEdit] = Field(min_length=1, max_length=100)


def patch_prose(content: str, data: dict) -> str:
    try:
        patch = ProsePatch.model_validate(data)
    except ValidationError as exc:
        raise ClientException(detail="Invalid prose patch fields") from exc
    if hashlib.sha256(content.encode()).hexdigest() != patch.expected_content_hash:
        raise PatchConflict(detail="Scene prose changed. Read it again before patching.")
    ranges: list[tuple[int, int, str]] = []
    for edit in patch.edits:
        start = content.find(edit.find)
        if start < 0 or content.find(edit.find, start + 1) >= 0:
            raise PatchConflict(detail="Each find/anchor must match exactly once. Add context.")
        end = start + len(edit.find)
        if edit.action == "insert_before":
            end = start
        elif edit.action == "insert_after":
            start = end
        for left, right, _ in ranges:
            overlap = max(start, left) < min(end, right)
            if start == end:
                overlap = left <= start <= right
            if left == right:
                overlap = overlap or start <= left <= end
            if overlap:
                raise ClientException(detail="Prose edits overlap or share an insertion point.")
        ranges.append((start, end, edit.replace))
    result = content
    for start, end, replacement in sorted(ranges, reverse=True):
        result = result[:start] + replacement + result[end:]
    if len(result) > 200000:
        raise ClientException(detail="Resulting scene exceeds 200000 characters")
    return result


class ListEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["append", "insert", "replace", "remove", "move"]
    index: StrictInt | None = Field(default=None, ge=0)
    to_index: StrictInt | None = Field(default=None, ge=0)
    expected_value: str | None = None
    value: str | None = None


class ListPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str
    expected_field_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    edits: list[ListEdit] = Field(min_length=1, max_length=100)


def patch_list(original: list[str] | None, data: dict) -> tuple[str, list[str]]:
    try:
        patch = ListPatch.model_validate(data)
    except ValidationError as exc:
        raise ClientException(detail="Invalid list patch fields") from exc
    if field_hash(original) != patch.expected_field_hash:
        raise PatchConflict(detail="List changed. Read the field again before patching.")
    result = list(original or [])
    for edit in patch.edits:
        expected = {"action"}
        if edit.action in {"insert", "replace", "remove", "move"}:
            expected.add("index")
        if edit.action in {"replace", "remove", "move"}:
            expected.add("expected_value")
        if edit.action in {"append", "insert", "replace"}:
            expected.add("value")
        if edit.action == "move":
            expected.add("to_index")
        if edit.model_fields_set != expected or any(getattr(edit, f) is None for f in expected):
            raise ClientException(
                detail=f"{edit.action} requires exactly: {', '.join(sorted(expected))}"
            )
        index = edit.index
        if edit.action in {"replace", "remove", "move"} and (
            index is None or index >= len(result) or result[index] != edit.expected_value
        ):
            raise PatchConflict(detail="List index/value does not match the current item")
        if edit.action == "append":
            result.append(edit.value)  # type: ignore[arg-type]
        elif edit.action == "insert":
            if index is None or index > len(result):
                raise ClientException(detail="Insert index is outside the list")
            result.insert(index, edit.value)  # type: ignore[arg-type]
        elif edit.action == "replace":
            result[index] = edit.value  # type: ignore[index, assignment]
        elif edit.action == "remove":
            result.pop(index)  # type: ignore[arg-type]
        else:
            value = result.pop(index)  # type: ignore[arg-type]
            if edit.to_index is None or edit.to_index > len(result):
                raise ClientException(detail="Move destination is outside the resulting list")
            result.insert(edit.to_index, value)
    return patch.field, result
