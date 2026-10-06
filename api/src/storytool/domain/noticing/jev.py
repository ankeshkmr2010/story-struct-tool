"""Jev-backed noticing (TypeSafe `System One`).

Jev returns typed values and probability distributions -- never text. That makes it a closer
fit to this feature than a text model: the "cannot propose prose" guarantee the Claude
noticer achieves through schema validation is simply a property of Jev's API, which has no
free-text output to constrain.

Three deliberate differences from `ClaudeNoticer`:

1. **It composes rather than replaces.** Jev's primitives answer *decisions*, not extraction,
   so character presence and unrecognised names still come from the deterministic matcher --
   free, exact, and the only half that can supply a verbatim quote.
2. **Answers are graded, so suggestions are gated.** A weak signal stays quiet instead of
   being asserted. This is the direct fix for nudge noise.
3. **No evidence quotes** on structural notices, because there is no text to quote.

Built to the documented patterns and to Jev 1.13's documented weaknesses:

* **Speculative fan-out** -- every question for a scene goes in one call. Questions evaluate
  in parallel, so asking five costs about what asking one costs, and the code decides what
  is relevant.
* **Confidence-gated routing** -- a beat is pinned only above a confidence floor. Suggesting
  is a low-risk action, so the floor sits at the documented 0.6 rather than the 0.9 reserved
  for acting automatically.
* **Literal interpretation** is Jev's first documented weakness, so every question states its
  boundary cases in `criteria` rather than relying on the instruction alone.
* **Counting is done in code.** Jev "does not count reliably"; it is asked only for semantic
  judgements, and every threshold, tally and rollup is Python.
* **Context rot** -- state carries only the scene prose, nothing else from the story.
"""

import logging
import re
from dataclasses import replace
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    # Type-only: the runtime import stays lazy so a missing SDK degrades instead of raising
    # at import time.
    from typesafe_sdk import NoulCriteria

from storytool.domain.noticing.types import (
    Confidence,
    KnownBeat,
    KnownCharacter,
    SceneElements,
    SceneNotices,
    StructureNotice,
)

logger = logging.getLogger(__name__)

# Below this a turning point is not worth saying out loud. A noul is a probability of "yes",
# so this is "more likely than not, with margin".
TURNING_POINT_THRESHOLD = 0.65
# Documented floor for acting on a choice at all. Suggesting is low-risk, so the floor is
# 0.6 rather than the ~0.9 the docs reserve for automatic action.
BEAT_MIN_CONFIDENCE = 0.6
# An element counts as present above this and absent below `ELEMENT_ABSENT_BELOW`; between
# the two we say nothing, because a nudge built on a coin flip is worse than silence.
ELEMENT_PRESENT_ABOVE = 0.6
ELEMENT_ABSENT_BELOW = 0.4
# API limit on Choice options.
MAX_CHOICE_OPTIONS = 255

TURNING_POINT = (
    "Does this scene contain a change to the point-of-view character's situation or "
    "understanding that cannot be undone?"
)
TURNING_POINT_CRITERIA: "NoulCriteria" = {
    "true": (
        "Something irreversible happens: a decision is acted on, a relationship breaks, "
        "information is learned that cannot be unlearned, or a loss occurs that cannot be "
        "recovered."
    ),
    "false": (
        "The situation at the end could still return to how it was at the start. Routine "
        "activity, travel, conversation that settles nothing, or preparation for a later "
        "event."
    ),
}

BEAT_QUESTION = (
    "Which of these story beats does this scene fulfil, judging only what is written on the "
    "page rather than what might happen later?"
)

ELEMENT_QUESTIONS: dict[str, tuple[str, "NoulCriteria"]] = {
    "goal": (
        "Does the point-of-view character want something specific in this scene?",
        {
            "true": "There is something the character is actively trying to get, reach, "
            "avoid, or find out during this scene.",
            "false": "The character has no particular objective here; things happen to them "
            "or around them.",
        },
    ),
    "conflict": (
        "Is something opposing what the point-of-view character wants in this scene?",
        {
            "true": "A person, circumstance, physical obstacle, or internal reluctance "
            "stands between the character and what they want.",
            "false": "Nothing resists the character; what they attempt simply proceeds.",
        },
    ),
    "outcome": (
        "Is the point-of-view character's situation different at the end of this scene "
        "than at the start?",
        {
            "true": "Something has changed by the end: they succeed, fail, learn something, "
            "lose something, or commit to something.",
            "false": "The situation at the end is materially the same as at the start.",
        },
    ),
}

_SLUG = re.compile(r"[^a-z0-9]+")


def _slug(label: str, index: int) -> str:
    """A readable, unique option key.

    Readable because Jev reads the key as well as the description; unique because two
    frameworks can both define a "Midpoint" and the key must still map back to one beat.
    """
    base = _SLUG.sub("_", label.strip().casefold()).strip("_") or "beat"
    return f"{index}_{base}"[:60]


def _noul_certainty(probability: float) -> float:
    """A noul returns no confidence; the documented equivalent is |2p - 1|.

    Needed so a noul probability is never compared against a choice confidence as though
    they were the same statistic -- 0.7 means "probably yes", not "70% certain".
    """
    return abs(2.0 * probability - 1.0)


def _band(certainty: float) -> Confidence:
    if certainty >= 0.8:
        return "high"
    if certainty >= 0.5:
        return "medium"
    return "low"


def _probability_of(nouls: dict, key: str) -> float | None:
    answer = nouls.get(key)
    if answer is None:
        return None
    value = getattr(answer, "noul", None)
    return None if value is None else float(value)


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

        # Speculative fan-out: one call, every question. Parallel evaluation means the extra
        # questions are close to free, and the code below decides what is worth reporting.
        questions: dict[str, object] = {
            "turning_point": Noul(instructions=TURNING_POINT, criteria=TURNING_POINT_CRITERIA),
        }
        for name, (instructions, criteria) in ELEMENT_QUESTIONS.items():
            questions[f"element_{name}"] = Noul(instructions=instructions, criteria=criteria)

        if options:
            questions["beat"] = Choice(
                instructions=BEAT_QUESTION,
                # The framework's description, not the bare label: Jev reads option
                # descriptions, and literal interpretation is its first documented weakness.
                criteria={key: (beat.description or beat.label) for key, beat in options.items()},
            )

        try:
            response = await self._client.system_one(  # type: ignore[attr-defined]
                model=self._model,
                # Only the prose. Jev degrades on irrelevant context ("context rot"), so no
                # other story state is sent.
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

        probability = _probability_of(nouls, "turning_point") or 0.0
        reads_like_turning_point = probability >= self._turning_point_threshold

        elements = SceneElements(
            goal=_probability_of(nouls, "element_goal"),
            conflict=_probability_of(nouls, "element_conflict"),
            outcome=_probability_of(nouls, "element_outcome"),
        )
        has_elements = any(
            value is not None for value in (elements.goal, elements.conflict, elements.outcome)
        )

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

        if not (reads_like_turning_point or resembles is not None or has_elements):
            return None

        # Compare like with like: a noul's certainty, not its raw probability.
        certainty = max(_noul_certainty(probability), beat_confidence)
        return StructureNotice(
            reads_like_turning_point=reads_like_turning_point,
            resembles_beat_id=resembles,
            confidence=_band(certainty),
            # Jev returns no text, so there is no quote to attach.
            evidence=None,
            probability=round(probability, 3),
            elements=elements if has_elements else None,
        )
