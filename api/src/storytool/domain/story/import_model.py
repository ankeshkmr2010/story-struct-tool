"""Format-neutral manuscript import: adapters parse a file into this shape; one importer
turns it into a story. Adapters infer no planning metadata the source does not contain."""

from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass
class ImportedScene:
    title: str | None = None
    prose: str = ""
    summary: str | None = None


@dataclass
class ImportedChapter:
    title: str | None = None
    scenes: list[ImportedScene] = field(default_factory=list)


@dataclass
class ImportedStory:
    chapters: list[ImportedChapter]


@dataclass(frozen=True)
class ImportAdapter:
    """One source format. `parse` raises ValueError with a writer-facing message."""

    name: str
    label: str
    max_bytes: int
    parse: Callable[[bytes], ImportedStory]
