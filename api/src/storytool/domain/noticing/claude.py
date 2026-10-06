"""Claude-backed noticing.

Reads a scene and reports what is *already* there: which known characters appear, which
capitalised names match nobody, and whether the scene reads like a turning point.

Three hard constraints, enforced in code rather than by prompt instruction:

1. **Closed sets.** Character names are matched back to the story's existing characters and
   beat labels back to its existing beats. Anything the model returns that does not resolve
   to something the author already created is discarded.
2. **Verbatim evidence only.** Every quote is checked against the prose; a quote that is not
   a literal substring is dropped. The model can quote the author to themselves and do
   nothing else with words.
3. **No generative field exists.** The response schema has no slot for prose, plot, a new
   beat, or a recommendation. There is nowhere for a suggestion about what *should* happen
   to go.

Refusals and API errors degrade to the deterministic noticer rather than failing the
author's save -- fiction routinely contains violence and other content a safety classifier
may decline, and losing a save over that would be unacceptable.
"""

import logging
from typing import Literal

from pydantic import BaseModel, Field

from storytool.domain.noticing.types import (
    CharacterNotice,
    Confidence,
    KnownBeat,
    KnownCharacter,
    KnownLocation,
    SceneNotices,
    StructureNotice,
    UnknownNameNotice,
    verbatim_or_none,
)

logger = logging.getLogger(__name__)

SYSTEM = """You are a structural reader for a novelist's planning tool.

Your only job is to NOTICE what is already written on the page. You report observations \
about the author's existing prose. You never propose, invent, suggest, continue, rewrite, \
or improve anything.

Rules:
- Report a character only if they appear in the scene. Use their name exactly as given in \
the list of known characters.
- Report a capitalised name as unknown only if it looks like a person and matches no known \
character.
- Every `evidence` value must be copied VERBATIM from the scene text, character for \
character. Never paraphrase, never write your own sentence.
- Judge `reads_like_turning_point` on whether the scene contains an irreversible change in \
the character's situation or understanding.
- For `resembles_beat_label`, choose only from the supplied list of existing beats, or null. \
Never invent a beat name.

You are describing, not advising."""


class _NoticedName(BaseModel):
    name: str = Field(description="Exactly as written in the scene or the known list.")
    evidence: str = Field(description="A verbatim quote from the scene text.")


class _SceneNoticeResponse(BaseModel):
    """The entire surface a model may return.

    Note what is absent: no summary, no recommendation, no suggested text, no new labels.
    """

    characters: list[_NoticedName] = Field(
        default_factory=list, description="Known characters who appear in this scene."
    )
    unknown_names: list[_NoticedName] = Field(
        default_factory=list, description="Person-like names matching no known character."
    )
    reads_like_turning_point: bool = False
    resembles_beat_label: str | None = Field(
        default=None, description="An existing beat label from the supplied list, or null."
    )
    confidence: Literal["low", "medium", "high"] = "low"
    turning_point_evidence: str | None = Field(
        default=None, description="A verbatim quote supporting the turning-point judgement."
    )


class ClaudeNoticer:
    """Optional enrichment over the deterministic pass."""

    name = "claude"

    def __init__(self, client: object, model: str, fallback: object) -> None:
        self._client = client
        self._model = model
        # Used when Claude refuses, errors, or is unreachable.
        self._fallback = fallback

    async def notice_scene(
        self,
        prose: str,
        known_characters: tuple[KnownCharacter, ...],
        known_beats: tuple[KnownBeat, ...] = (),
        known_locations: tuple[KnownLocation, ...] = (),
    ) -> SceneNotices:
        if not prose.strip():
            return SceneNotices(noticed_by=self.name)

        character_lines = "\n".join(f"- {c.name}" for c in known_characters) or "(none yet)"
        beat_lines = "\n".join(f"- {b.label}" for b in known_beats) or "(none yet)"

        prompt = (
            f"Known characters:\n{character_lines}\n\n"
            f"Existing beats:\n{beat_lines}\n\n"
            f"Scene text:\n---\n{prose}\n---"
        )

        try:
            response = await self._client.messages.parse(  # type: ignore[attr-defined]
                model=self._model,
                max_tokens=2048,
                system=SYSTEM,
                # Extraction and classification, not reasoning -- low effort is the right
                # cost/quality point and keeps this cheap enough to run per save.
                output_config={"effort": "low"},
                output_format=_SceneNoticeResponse,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception:
            logger.warning("Claude noticing failed; falling back to deterministic", exc_info=True)
            return await self._degrade(prose, known_characters, known_beats)

        # A safety decline is expected occasionally on fiction. Degrade, do not fail.
        if getattr(response, "stop_reason", None) == "refusal":
            details = getattr(response, "stop_details", None)
            logger.info(
                "Claude declined to read a scene (category=%s); using deterministic noticing",
                getattr(details, "category", None),
            )
            return await self._degrade(prose, known_characters, known_beats)

        parsed = getattr(response, "parsed_output", None)
        if parsed is None:
            return await self._degrade(prose, known_characters, known_beats)

        return self._resolve(parsed, prose, known_characters, known_beats)

    async def _degrade(
        self,
        prose: str,
        known_characters: tuple[KnownCharacter, ...],
        known_beats: tuple[KnownBeat, ...],
    ) -> SceneNotices:
        return await self._fallback.notice_scene(  # type: ignore[attr-defined]
            prose, known_characters, known_beats
        )

    def _resolve(
        self,
        parsed: _SceneNoticeResponse,
        prose: str,
        known_characters: tuple[KnownCharacter, ...],
        known_beats: tuple[KnownBeat, ...],
    ) -> SceneNotices:
        """Map the model's answer onto things that actually exist, discarding the rest.

        This is where the closed-set guarantee is enforced: a hallucinated character or an
        invented beat label simply does not survive.
        """
        by_name = {c.name.casefold(): c for c in known_characters}
        known_names = set(by_name)

        characters: list[CharacterNotice] = []
        seen: set[str] = set()
        for item in parsed.characters:
            character = by_name.get(item.name.strip().casefold())
            if character is None or str(character.id) in seen:
                continue  # Not a character this story has -- discard silently.
            seen.add(str(character.id))
            characters.append(
                CharacterNotice(
                    character_id=character.id,
                    evidence=verbatim_or_none(item.evidence, prose),
                    confidence=parsed.confidence,
                )
            )

        unknown = tuple(
            UnknownNameNotice(
                name=item.name.strip(), evidence=verbatim_or_none(item.evidence, prose)
            )
            for item in parsed.unknown_names
            if item.name.strip() and item.name.strip().casefold() not in known_names
        )

        beats_by_label = {b.label.casefold(): b for b in known_beats}
        resembles = (
            beats_by_label.get(parsed.resembles_beat_label.strip().casefold())
            if parsed.resembles_beat_label
            else None
        )

        structure = None
        if parsed.reads_like_turning_point or resembles is not None:
            structure = StructureNotice(
                reads_like_turning_point=parsed.reads_like_turning_point,
                resembles_beat_id=resembles.id if resembles else None,
                confidence=parsed.confidence,
                evidence=verbatim_or_none(parsed.turning_point_evidence, prose),
            )

        return SceneNotices(
            characters=tuple(characters),
            unknown_names=unknown,
            structure=structure,
            noticed_by=self.name,
        )


def confidence_rank(confidence: Confidence) -> int:
    return {"low": 0, "medium": 1, "high": 2}[confidence]
