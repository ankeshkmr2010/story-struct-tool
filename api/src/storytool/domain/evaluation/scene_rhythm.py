"""Scene/sequel rhythm (Swain, Bickham).

Action scenes (goal/conflict/outcome) and sequels (reaction/dilemma/decision) should
alternate often enough that the reader gets both movement and processing. A long run of
either is flagged, never forbidden: a breathless finale is a legitimate choice.
"""

from storytool.domain.enums import SceneType
from storytool.domain.evaluation.engine import (
    EvaluationFinding,
    EvaluationResult,
    Evaluator,
    register,
)
from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity

RUN_LIMIT = 4
MIN_SCENES = 2


def _missing(g: StoryGraph) -> list[str]:
    if len(g.scenes_in_reading_order()) < MIN_SCENES:
        return [f"Place at least {MIN_SCENES} scenes in chapters"]
    return []


def _run(g: StoryGraph) -> EvaluationResult:
    scenes = g.scenes_in_reading_order()
    sequence = [
        {
            "scene_id": str(s.id),
            "chapter_id": str(s.chapter_id),
            "title": s.title,
            "type": s.type,
        }
        for s in scenes
    ]

    runs: list[tuple[str, int, int]] = []  # (type, start index, length)
    start = 0
    for index in range(1, len(scenes) + 1):
        if index == len(scenes) or scenes[index].type != scenes[start].type:
            runs.append((scenes[start].type, start, index - start))
            start = index
    visual = {
        "sequence": sequence,
        "runs": [{"type": t, "start": i, "length": n} for t, i, n in runs],
        "run_limit": RUN_LIMIT,
    }

    if not any(s.type == SceneType.SEQUEL for s in scenes):
        return EvaluationResult(
            findings=(
                EvaluationFinding(
                    code="rhythm.no_sequels",
                    severity=Severity.INFO,
                    message=(
                        "No scene is marked as a sequel, so every scene reads as action. "
                        "Mark the reaction/decision scenes as sequels to see the rhythm."
                    ),
                    entity_type="story",
                    entity_id=g.story.id,
                ),
            ),
            visual=visual,
        )

    findings = []
    for run_type, run_start, length in runs:
        if length < RUN_LIMIT:
            continue
        first = scenes[run_start]
        if run_type == SceneType.SEQUEL:
            message = (
                f"{length} sequels in a row from '{first.title or 'untitled'}': the pace may "
                "drag. Consider a new goal or conflict in this stretch."
            )
        else:
            message = (
                f"{length} action scenes in a row from '{first.title or 'untitled'}': the "
                "reader may need a beat to react. Consider a sequel in this stretch."
            )
        findings.append(
            EvaluationFinding(
                code=f"rhythm.{run_type}_run",
                severity=Severity.WARNING,
                message=message,
                entity_type="scene",
                entity_id=first.id,
            )
        )
    return EvaluationResult(findings=tuple(findings), visual=visual)


SCENE_RHYTHM = register(
    Evaluator(
        id="scene_rhythm",
        name="Scene and sequel rhythm",
        description=(
            "Checks that action scenes and reaction sequels alternate, flagging runs of "
            f"{RUN_LIMIT} or more of the same kind in reading order."
        ),
        inputs=("scene.type", "scene.chapter_id"),
        missing=_missing,
        run=_run,
    )
)
