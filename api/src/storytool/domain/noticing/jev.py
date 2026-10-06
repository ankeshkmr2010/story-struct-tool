"""Jev-backed noticing (TypeSafe `System One`).

Jev returns typed values and probability distributions -- never text. That makes it a
closer fit to this feature than a text model: the "cannot propose prose" guarantee the
Claude noticer achieves through schema validation is simply a property of Jev's API, which
has no free-text output to constrain.

Three deliberate differences from `ClaudeNoticer`:

1. **It composes rather than replaces.** Jev's primitives answer *decisions*, not extraction,
   so character presence and unrecognised names still come from the deterministic matcher --
   which is free, exact, and already good at that. Jev is asked only the questions string
   matching cannot answer honestly: does this scene turn, and which existing beat does it
   resemble.
2. **Answers are graded, so suggestions are gated.** A Noul returns 0.0-1.0 rather than a
   boolean, so a weak signal stays quiet instead of being asserted. This is the direct fix
   for nudge noise.
3. **No evidence quotes.** Jev returns no text at all, so structural notices carry a
   probability instead of a supporting quote. Character notices keep the deterministic
   matcher's verbatim evidence.
"""

import logging
import re
from dataclasses import replace
from uuid import UUID

from storytool.domain.noticing.types import (
    Confidence,
    KnownBeat,
    KnownCharacter,
    SceneNotices,
    StructureNotice,
)

logger = logging.getLogger(__name__)

# Below this, "reads like a turning point" is not worth saying out loud.
TURNING_POINT_THRESHOLD = 0.65
# A spread distribution means Jev is guessing; do not pin a beat on a guess.
BEAT_MIN_CONFIDENCE = 0.5
# API limit on Choice options.
MAX_CHOICE_OPTIONS = 255

TURNING_POINT_QUESTION = (
    "Does this scene contain an irreversible change in the point-of-view character's "
    "situation or understanding -- something that cannot be undone?"
)
BEAT_QUESTION = (
    "Which of these story beats does this scene most closely fulfil, as written? "
    "Judge only what is on the page."
)

_SLUG = re.compile(r"[^a-z0-9]+")


def _slug(label: str, index: int) -> str:
    """A readable, unique option key.

    Readable because Jev reasons over the key as well as the description; unique because two
    frameworks can both define a "Midpoint" and the key must still map back to one beat.
    """
    base = _SLUG.sub("_", label.strip().casefold()).strip("_") or "beat"
    return f"{index}_{base}"[:60]


def _band(value: float) -> Confidence:
    if value >= 0.8:
        return "high"
    if value >= 0.6:
        return "medium"
    return "low"


class JevNoticer:
    name = "jev"

    def __init__(
        self,
        client: object,
        model: str,
        deterministic: object,
        *,
        turning_point_threshold: float = TURNING_POINT_THRESHOLD,
        beat_min_confidence: float = BEAT_MIN_CONFIDENCE,
    ) -> None:
        self._client = client
        self._model = model
        # Not a fallback -- a collaborator. It always runs, for extraction.
        self._deterministic = deterministic
        self._turning_point_threshold = turning_point_threshold
        self._beat_min_confidence = beat_min_confidence

    async def notice_scene(
        self,
        prose: str,
        known_characters: tuple[KnownCharacter, ...],
        known_beats: tuple[KnownBeat, ...] = (),
    ) -> SceneNotices:
        # Presence and unknown names: deterministic, with verbatim evidence.
        base: SceneNotices = await self._deterministic.notice_scene(  # type: ignore[attr-defined]
            prose, known_characters, known_beats
        )
        if not prose.strip():
            return replace(base, noticed_by=self.name)

        try:
            from typesafe_sdk import Choice, Noul
        except ImportError:  # pragma: no cover -- dependency is declared
            logger.warning("typesafe-sdk unavailable; deterministic noticing only")
            return base

        beats = known_beats[:MAX_CHOICE_OPTIONS]
        options = {_slug(beat.label, index): beat for index, beat in enumerate(beats)}

        questions: dict[str, object] = {"turning_point": Noul(instructions=TURNING_POINT_QUESTION)}
        if options:
            questions["beat"] = Choice(
                instructions=BEAT_QUESTION,
                criteria={key: beat.label for key, beat in options.items()},
            )

        try:
            response = await self._client.system_one(  # type: ignore[attr-defined]
                model=self._model,
                state={"scene": prose},
                questions=questions,
            )
        except Exception:
            logger.warning("Jev noticing failed; keeping deterministic results", exc_info=True)
            return base

        return replace(
            base, structure=self._read_structure(response, options), noticed_by=self.name
        )

    def _read_structure(
        self, response: object, options: dict[str, KnownBeat]
    ) -> StructureNotice | None:
        nouls = getattr(response, "nouls", {}) or {}
        choices = getattr(response, "choices", {}) or {}

        probability = 0.0
        answer = nouls.get("turning_point")
        if answer is not None:
            probability = float(getattr(answer, "noul", 0.0) or 0.0)
        reads_like_turning_point = probability >= self._turning_point_threshold

        resembles: UUID | None = None
        beat_confidence = 0.0
        choice = choices.get("beat")
        if choice is not None:
            beat_confidence = float(getattr(choice, "confidence", 0.0) or 0.0)
            # Closed set enforced again on the way back: an option key Jev did not receive
            # resolves to nothing.
            matched = options.get(str(getattr(choice, "choice", "")))
            if matched is not None and beat_confidence >= self._beat_min_confidence:
                resembles = matched.id

        if not reads_like_turning_point and resembles is None:
            return None

        return StructureNotice(
            reads_like_turning_point=reads_like_turning_point,
            resembles_beat_id=resembles,
            confidence=_band(max(probability, beat_confidence)),
            # Jev returns no text, so there is no quote to attach.
            evidence=None,
            probability=round(probability, 3),
        )
