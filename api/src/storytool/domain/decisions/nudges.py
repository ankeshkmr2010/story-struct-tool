"""Mode-aware readiness advice; weak evidence stays silent."""

from storytool.config import get_settings
from storytool.domain.decisions.service import DecisionService, DecisionUnavailable
from storytool.domain.decisions.types import Score
from storytool.domain.enums import Level
from storytool.domain.story.schemas import ReadinessOut

CHECKS = {
    "premise": (
        1,
        "Is the premise specific enough to write from?",
        "Clarify who wants what and what stands in their way.",
    ),
    "stakes": (
        1,
        "Do the stakes establish a concrete cost of failure?",
        "Consider what failure would cost the protagonist.",
    ),
    "arc": (
        2,
        "Do the turning points sketch a usable change across the story?",
        "Sketch the changes that steer the story.",
    ),
    "character": (
        3,
        "Is the central character's desire and conflict specific enough to guide scenes?",
        "Give the central character a clear desire and conflict.",
    ),
    "acts": (
        4,
        "Do the acts suggest distinct stretches of change?",
        "Consider what changes across each act.",
    ),
    "beats": (
        5,
        "Do the planned beats describe concrete developments rather than vague labels?",
        "Make the next planned developments concrete.",
    ),
    "threads": (
        6,
        "Are the story's continuing questions or promises clear enough to follow?",
        "Identify the promises or questions that carry through the story.",
    ),
    "chapters": (
        7,
        "Is the chapter organisation usable for this writer's next drafting step?",
        "Consider a chapter grouping for the next stretch of writing.",
    ),
    "scenes": (
        8,
        "Are the planned scenes specific enough for the next drafting step?",
        "Give the next scene a concrete purpose or change.",
    ),
}


async def read_nudges(
    service: DecisionService | None, model: str, state: dict
) -> list[ReadinessOut]:
    levels = [
        ReadinessOut(
            level=int(level), label=level.label, is_ready=True, blocked_by=(), assessed=False
        )
        for level in Level
    ]
    if service is None or state["mode"] == "pantser":
        return levels
    questions = {
        key: Score(
            instructions=(
                question
                + " Respect the writer's mode: Plotter can benefit from explicit planning; "
                "Hybrid only needs enough to continue. Do not demand finished outlines "
                "or fixed item counts."
            ),
            criteria=[
                advice,
                "A likely gap remains. " + advice,
                "Enough to continue in this mode.",
                "Specific and usable for the next writing step.",
            ],
        )
        for key, (_, question, advice) in CHECKS.items()
    }
    try:
        result = await service.evaluate(model=model, state=state, questions=questions)
    except DecisionUnavailable:
        return levels
    for key, (level, _, advice) in CHECKS.items():
        threshold = get_settings().decision_threshold(
            f"nudge.{key}",
            result.model,
            service.provider.identity,
            "nudges-v1",
            get_settings().decision_nudge_probability,
        )
        answer = result.answers[key]
        gap = sum(answer.probabilities.get(str(index), 0) for index in (0, 1))
        ready = sum(answer.probabilities.get(str(index), 0) for index in (2, 3))
        rung = levels[level - 1]
        if (answer.confidence or 0) >= threshold and gap >= threshold:
            rung.is_ready = False
            rung.assessed = True
            rung.blocked_by = (*rung.blocked_by, advice)
        elif ready >= threshold and (answer.confidence or 0) >= threshold:
            rung.assessed = True
    return levels
