"""The noticing contract.

This tool augments the writer; it does not write. That is enforced here by the *shape* of
what a noticer may return, not by asking a model nicely:

* A character notice can only point at a character that **already exists** in the story.
* A structure notice can only point at a beat that **already exists**, plus a boolean and a
  confidence level.
* The only free text any noticer may return is `evidence`, which must be a **verbatim
  substring of the author's own prose** -- validated on the way in, dropped if it isn't.

There is no field anywhere in which a model could return invented prose, a proposed plot
development, or a new beat label. An LLM wired to this interface cannot suggest what should
happen next; it can only report what is already on the page.
"""

from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import UUID

Confidence = Literal["low", "medium", "high"]


@dataclass(frozen=True, slots=True)
class KnownCharacter:
    """A character the story already has, passed *into* a noticer as a closed set."""

    id: UUID
    name: str

    @property
    def aliases(self) -> tuple[str, ...]:
        """The full name plus a bare first name, which is how prose usually refers to people."""
        parts = self.name.split()
        if len(parts) > 1:
            return (self.name, parts[0])
        return (self.name,)


@dataclass(frozen=True, slots=True)
class CharacterNotice:
    """ "This character appears in this scene." Nothing more."""

    character_id: UUID
    evidence: str | None = None
    confidence: Confidence = "high"


@dataclass(frozen=True, slots=True)
class UnknownNameNotice:
    """A capitalised name in the prose that matches no character in the story.

    The name is lifted verbatim from the author's text -- it is an observation about what
    they have already written, not an invented character.
    """

    name: str
    evidence: str | None = None


@dataclass(frozen=True, slots=True)
class SceneElements:
    """Whether the *prose* shows the three things that make a scene a scene.

    Separate from `Scene.complete_when`, which asks whether the author filled in the fields.
    A scene can have a goal on the page and an empty goal field, or the reverse. Probabilities
    rather than booleans, with None meaning "too uncertain to claim either way".
    """

    goal: float | None = None
    conflict: float | None = None
    outcome: float | None = None

    def missing(self, absent_below: float) -> tuple[str, ...]:
        return tuple(
            name
            for name, value in (
                ("goal", self.goal),
                ("conflict", self.conflict),
                ("outcome", self.outcome),
            )
            if value is not None and value <= absent_below
        )


@dataclass(frozen=True, slots=True)
class StructureNotice:
    """An observation about a scene's shape.

    `resembles_beat_id` is constrained to beats the story already has. A noticer cannot
    name a new beat, only recognise an existing one.
    """

    reads_like_turning_point: bool = False
    resembles_beat_id: UUID | None = None
    confidence: Confidence = "low"
    evidence: str | None = None
    # Raw probability when the noticer reports one (Jev does; Claude does not). Lets the UI
    # show strength instead of a bare claim, and lets suggestions be threshold-gated.
    probability: float | None = None
    # Present only when the noticer can judge prose structure (Jev).
    elements: "SceneElements | None" = None


@dataclass(frozen=True, slots=True)
class SceneNotices:
    characters: tuple[CharacterNotice, ...] = ()
    unknown_names: tuple[UnknownNameNotice, ...] = ()
    structure: StructureNotice | None = None
    noticed_by: str = "deterministic"


@dataclass(frozen=True, slots=True)
class KnownBeat:
    id: UUID
    label: str
    # Jev reads option descriptions as well as keys, and its documented weakness is literal
    # interpretation -- so the framework's own beat description is far better criteria than
    # the bare label. Seeded beats already carry one.
    description: str | None = None


class Noticer(Protocol):
    """Implemented deterministically and, optionally, by Claude.

    Both are interchangeable; with no API key configured the deterministic one is used and
    the feature degrades rather than disappearing.
    """

    name: str

    async def notice_scene(
        self,
        prose: str,
        known_characters: tuple[KnownCharacter, ...],
        known_beats: tuple[KnownBeat, ...] = (),
    ) -> SceneNotices: ...


def verbatim_or_none(evidence: str | None, prose: str) -> str | None:
    """Keep an evidence quote only if it genuinely appears in the author's prose.

    The guarantee that makes free text safe here: a noticer can quote the writer back to
    themselves, and can do nothing else with words.
    """
    if not evidence:
        return None
    cleaned = evidence.strip()
    if cleaned and cleaned in prose:
        return cleaned
    return None
