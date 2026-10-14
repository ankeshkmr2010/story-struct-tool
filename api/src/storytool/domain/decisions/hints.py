"""Atomic, advisory current-scene hints. All wording belongs to the application."""

import hashlib
import re
from typing import Annotated

from pydantic import BaseModel, Field

from storytool.config import get_settings
from storytool.domain.decisions.service import DecisionService, DecisionUnavailable
from storytool.domain.decisions.types import Noul, Score


class HintInput(BaseModel):
    content: str = Field(max_length=30000)
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


class HintReading(BaseModel):
    content_hash: str
    hints: list[WritingHint] = Field(default_factory=list)
    unavailable: str | None = None
    model: str | None = None


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


async def read_hints(service: DecisionService, model: str, data: HintInput) -> HintReading:
    result = HintReading(
        content_hash=hashlib.sha256(data.content.encode()).hexdigest(), model=model
    )
    # Images are never sent to the text reader. Preserve paragraph order for navigation.
    text = re.sub(r"!\[[^\]\n]*\]\([^\n)]*\)", "", data.content)
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if len(text.strip()) < 40:
        return result
    if len(text.encode()) > 24000 or len(paragraphs) > 40:
        result.unavailable = (
            "This scene is too long for live hints. Split it into scenes to read it completely."
        )
        return result
    questions = {key: Noul(instructions=instructions) for key, (instructions, _) in CHECKS.items()}
    if not data.known_names_complete:
        del questions["unknown_name"]
    for index in range(len(paragraphs)):
        questions[f"telling_{index}"] = Score(
            instructions=(
                f"Assess paragraph {index + 1}: does abstract explanation replace a moment "
                "that would benefit from concrete action or sensory detail? Intentional "
                "summary and transitions are appropriate, not defects."
            ),
            criteria=[
                "Concrete action or appropriate summary.",
                "A little abstraction, with enough concrete detail.",
                "Consider grounding this paragraph in action or sensory detail.",
                "Much of this moment is explained; consider showing it through concrete detail.",
            ],
        )
    try:
        answers = await service.evaluate(
            model=model,
            state={"paragraphs": paragraphs, "known_names": data.known_names},
            questions=questions,
        )
    except DecisionUnavailable:
        result.unavailable = (
            "Live hints are temporarily unavailable or the usage limit has been reached. "
            "Your writing is saved normally."
        )
        return result

    def threshold(code: str) -> float:
        return get_settings().decision_threshold(
            f"hint.{code}",
            answers.model,
            service.provider.identity,
            "hints-v1",
            get_settings().decision_hint_probability,
        )

    for key, (_, message) in CHECKS.items():
        if key not in answers.answers:
            continue
        answer = answers.answers[key]
        if answer.noul is not None and answer.noul >= threshold(key):
            result.hints.append(
                WritingHint(
                    code=key,
                    message=message,
                    probability=answer.noul,
                    evidence_keys=[answers.cache_keys[key]],
                )
            )
    for index in range(len(paragraphs)):
        answer = answers.answers[f"telling_{index}"]
        probability = sum(answer.probabilities.get(str(level), 0) for level in (2, 3))
        if probability >= threshold("telling") and (answer.confidence or 0) >= threshold("telling"):
            level = 3 if answer.probabilities.get("3", 0) > answer.probabilities.get("2", 0) else 2
            result.hints.append(
                WritingHint(
                    code=f"telling_{index}",
                    message=questions[f"telling_{index}"].criteria[level],
                    probability=probability,
                    paragraph=index + 1,
                    evidence_keys=[answers.cache_keys[f"telling_{index}"]],
                )
            )
    return result
