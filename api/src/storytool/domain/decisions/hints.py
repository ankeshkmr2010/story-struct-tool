"""Atomic, advisory current-scene hints. All wording belongs to the application."""

import asyncio
import hashlib
import re
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from storytool.config import get_settings
from storytool.domain.decisions.service import DecisionService, DecisionUnavailable, canonical
from storytool.domain.decisions.types import Choice, Noul, Question, Score


class HintInput(BaseModel):
    content: str = Field(max_length=1000000)
    known_names: list[Annotated[str, Field(max_length=200)]] = Field(
        default_factory=list, max_length=255
    )
    known_names_complete: bool = True


class WritingHint(BaseModel):
    code: str
    message: str
    probability: float
    paragraph: int | None = None
    evidence_keys: list[str] = Field(default_factory=list)
    kind: str | None = None
    excerpt: str | None = None
    action: str | None = None


class HintReading(BaseModel):
    content_hash: str
    hints: list[WritingHint] = Field(default_factory=list)
    unavailable: str | None = None
    model: str | None = None
    rubric_version: Literal["hints-v2"] = "hints-v2"
    sections_read: int = 0
    sections_total: int = 0


CHECKS = {
    "pov": (
        "Does the narrative unintentionally slip outside its established point of "
        "view? Exclude intentional omniscience and dialogue.",
        "Check for a point-of-view slip.",
    ),
    "tense": (
        "Does the narrative unintentionally change tense? Exclude dialogue, memories "
        "and intentional shifts.",
        "Check for an unintended tense change.",
    ),
    "dialogue": (
        "Does a dialogue passage need an action beat to clarify the speaker or "
        "physical situation? Do not demand a beat on every line.",
        "A dialogue beat may help clarify the speaker or action.",
    ),
    "unknown_name": (
        "Does a likely character name appear that is absent from known_names? Ignore "
        "common nouns, sentence capitals and quoted titles.",
        "A character name may be missing from your glossary or cast.",
    ),
    "turn": (
        "Does this passage appear to be a finished scene that ends without a "
        "meaningful reversal, decision or change? An unfinished passage, sequel or "
        "deliberate quiet scene is false.",
        "Consider whether this scene needs a turn before it ends.",
    ),
}


ACTIONS = {
    "pov": (
        "Check whether this paragraph reveals thoughts or perceptions the "
        "viewpoint character cannot know."
    ),
    "tense": (
        "Compare this paragraph's narrative verbs with the established tense. "
        "Dialogue and memories may differ intentionally."
    ),
    "dialogue": (
        "Check who is speaking here. Add a speaker cue or an action beat only "
        "if the exchange is unclear."
    ),
    "unknown_name": (
        "Check the name in this paragraph against your cast and glossary; add "
        "it or correct its spelling if needed."
    ),
    "turn": (
        "Check what the closing paragraph changes in knowledge, intention or "
        "situation; keep a quiet ending if it serves the scene."
    ),
    "telling": (
        "Check whether this paragraph would benefit from one concrete action or"
        " sensory detail; intentional summary can stay."
    ),
}


def sections(paragraphs: list[str], budget: int) -> list[list[tuple[int, str]]]:
    """Read all text, including oversized single paragraphs; retain original anchors."""
    result, current, size = [], [], 0
    for index, paragraph in enumerate(paragraphs):
        rest = paragraph
        while rest:
            low, high = 1, min(len(rest), budget)
            while low < high:
                middle = (low + high + 1) // 2
                if len(canonical(rest[:middle]).encode()) + 40 <= budget:
                    low = middle
                else:
                    high = middle - 1
            end = low
            if end < len(rest):
                boundary = rest.rfind(" ", end // 2, end)
                if boundary > 0:
                    end = boundary + 1
            piece = rest[:end]
            cost = len(canonical(piece).encode()) + 40
            if current and (size + cost > budget or len(current) >= 128):
                result.append(current)
                current, size = [], 0
            if current and current[-1][0] == index + 1:
                current[-1] = (index + 1, current[-1][1] + piece)
            else:
                current.append((index + 1, piece))
            size += cost
            rest = rest[end:]
    if current:
        result.append(current)
    return result


def excerpt(text: str) -> str:
    # Verbatim source text, never an explanation invented by the provider.
    return text[:320].rstrip()


async def read_hints(service: DecisionService, model: str, data: HintInput) -> HintReading:
    result = HintReading(
        content_hash=hashlib.sha256(data.content.encode()).hexdigest(), model=model
    )
    text = re.sub(r"!\[[^\]\n]*\]\([^\n)]*\)", "", data.content)
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if len(text.strip()) < 40:
        return result
    names = data.known_names
    names_complete = data.known_names_complete
    # A huge roster must not prevent POV/tense/dialogue checks from running.
    if len(canonical(names).encode()) > 8000:
        names, names_complete = [], False
    frames = sections(paragraphs, 14000)
    result.sections_total = len(frames)
    gate = asyncio.Semaphore(2)

    async def read_frame(index: int, frame: list[tuple[int, str]]):
        options = {str(number): f"Paragraph {number}" for number, _ in frame}
        options.update(
            {
                "none": "No supplied paragraph supports this issue.",
                "unclear": "Cannot reliably locate supporting text.",
            }
        )
        questions: dict[str, Question] = {}
        for key, (instruction, _) in CHECKS.items():
            if key == "turn" or (key == "unknown_name" and not names_complete):
                continue
            questions[key] = Noul(
                instructions=instruction
                + " Assess only target paragraphs; opening and previous context "
                "establish the voice."
            )
            questions[f"where_{key}"] = Choice(
                instructions=(
                    f"Which target paragraph most clearly supports the {key} issue? "
                    "Select none if there is no issue, or unclear if it cannot "
                    "be located. Use the supplied paragraph numbers."
                ),
                criteria=options,
            )
        questions["change"] = Noul(
            instructions=(
                "Does this section contain a meaningful discovery, decision, reversal, "
                "escalation, resolution or change in knowledge, intention or situation?"
                " New information that changes the story counts. Mere descriptive "
                "repetition does not."
            )
        )
        if index == len(frames) - 1:
            questions["finished"] = Noul(
                instructions=(
                    "Does this look like the completed ending of an enacted scene that "
                    "needs a change? An unfinished draft, intentional quiet passage, "
                    "summary or reflective sequel is false. Do not assume every scene needs"
                    " a dramatic reversal."
                )
            )
        for number, _ in frame:
            questions[f"telling_{number}"] = Score(
                instructions=(
                    f"Assess target paragraph {number}: does abstract explanation "
                    "replace a moment that would benefit from concrete action "
                    "or sensory detail? Intentional summary and transitions "
                    "are appropriate."
                ),
                criteria=[
                    "Concrete action or appropriate summary.",
                    "Enough concrete detail.",
                    "Consider grounding this paragraph in action or sensory detail.",
                    "Consider showing this moment through concrete action "
                    "rather than explaining it.",
                ],
            )
        state = {
            "rubric": "hints-v2",
            "target_paragraphs": [{"number": number, "text": part} for number, part in frame],
            "opening_context": paragraphs[0][:200] if index else "",
            "previous_context": frames[index - 1][-1][1][-200:] if index else "",
            "known_names": names,
        }
        async with gate:
            try:
                reading = await service.evaluate(model=model, state=state, questions=questions)
            except DecisionUnavailable:
                return None
        found = []

        def threshold(kind: str) -> float:
            return get_settings().decision_threshold(
                f"hint.{kind}",
                reading.model,
                service.provider.identity,
                "hints-v2",
                get_settings().decision_hint_probability,
            )

        by_number = dict(frame)
        for key, (_, message) in CHECKS.items():
            if key not in reading.answers:
                continue
            answer, where = reading.answers[key], reading.answers[f"where_{key}"]
            if answer.noul < threshold(key) or (where.confidence or 0) < threshold(key):
                continue
            if where.choice not in options or where.choice in {"none", "unclear"}:
                continue
            number = int(where.choice)
            found.append(
                WritingHint(
                    code=f"{key}_{number}",
                    kind=key,
                    message=message,
                    action=ACTIONS[key],
                    paragraph=number,
                    excerpt=excerpt(by_number[number]),
                    probability=min(answer.noul, where.confidence),
                    evidence_keys=[reading.cache_keys[key], reading.cache_keys[f"where_{key}"]],
                )
            )
        for number, part in frame:
            answer = reading.answers[f"telling_{number}"]
            probability = sum(answer.probabilities.get(str(level), 0) for level in (2, 3))
            if min(probability, answer.confidence or 0) >= threshold("telling"):
                found.append(
                    WritingHint(
                        code=f"telling_{number}",
                        kind="telling",
                        message="This paragraph may explain a moment that could "
                        "be shown concretely.",
                        action=ACTIONS["telling"],
                        paragraph=number,
                        excerpt=excerpt(part),
                        probability=min(probability, answer.confidence),
                        evidence_keys=[reading.cache_keys[f"telling_{number}"]],
                    )
                )
        return reading, found

    readings = await asyncio.gather(
        *(read_frame(index, frame) for index, frame in enumerate(frames))
    )
    merged = {}
    for reading in readings:
        if reading is None:
            continue
        result.sections_read += 1
        result.model = reading[0].model
        for hint in reading[1]:
            previous = merged.get(hint.code)
            if previous is None or hint.probability > previous.probability:
                merged[hint.code] = hint
    # A whole-scene absence claim needs complete coverage and a finished ending.
    if result.sections_read == result.sections_total:
        no_change = min(1 - reading[0].answers["change"].noul for reading in readings)
        ending = readings[-1][0].answers["finished"].noul
        threshold = get_settings().decision_threshold(
            "hint.turn",
            result.model,
            service.provider.identity,
            "hints-v2",
            get_settings().decision_hint_probability,
        )
        if min(no_change, ending) >= max(0.85, threshold):
            merged["turn"] = WritingHint(
                code="turn",
                kind="turn",
                message=CHECKS["turn"][1],
                action=ACTIONS["turn"],
                paragraph=len(paragraphs),
                excerpt=excerpt(paragraphs[-1]),
                probability=min(no_change, ending),
                evidence_keys=[reading[0].cache_keys["change"] for reading in readings]
                + [readings[-1][0].cache_keys["finished"]],
            )
    else:
        result.unavailable = (
            f"Read {result.sections_read} of {result.sections_total} sections. "
            "The remaining sections could not be read because the reader "
            "is unavailable or its usage limit was reached."
        )
    result.hints = sorted(merged.values(), key=lambda hint: (hint.paragraph or 0, hint.code))
    return result
