"""Format-neutral manuscript import.

Every format is an adapter with two steps: `inspect` describes what the file contains (counts,
splitting options, a recommended plan and a numbered outline an author or an AI can read), and
`parse` turns the file into chapters and scenes using a plan. One importer saves the result, so
Word, Scrivener and future formats share the same story-creation path."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel


@dataclass
class ImportedScene:
    title: str | None = None
    prose: str = ""
    summary: str | None = None
    notes: str | None = None


@dataclass
class ImportedChapter:
    title: str | None = None
    scenes: list[ImportedScene] = field(default_factory=list)


@dataclass
class ImportedStory:
    chapters: list[ImportedChapter]


@dataclass(frozen=True)
class ImportAdapter:
    """One source format. Both steps raise ValueError with a writer-facing message.

    `inspect` returns {"stats", "options", "recommended", "outline", "guide"}: plain JSON an
    author's UI or an AI client can use to choose a plan. `plan_model` validates plans."""

    name: str
    label: str
    max_bytes: int
    plan_model: type[BaseModel]
    inspect: Callable[[bytes], dict[str, Any]]
    parse: Callable[[bytes, Any], ImportedStory]

    def plan(self, data: dict[str, Any] | None) -> BaseModel:
        return self.plan_model.model_validate(data or {})
