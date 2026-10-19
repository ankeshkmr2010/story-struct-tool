"""Importing the package registers every evaluator."""

from storytool.domain.evaluation import (  # noqa: F401
    mice_nesting,
    misbelief_midpoint,
    prose_checks,
    scene_rhythm,
    value_shift,
)
from storytool.domain.evaluation.engine import all_evaluators, get_evaluator, reads_prose

__all__ = ("all_evaluators", "get_evaluator", "reads_prose")

from storytool.domain.evaluation.engine import EvaluationResult, Evaluator, register

for _id, _name, _description in [
    (
        "setups_payoffs",
        "Setups and payoffs",
        "Review openings and resolutions of authored story threads.",
    ),
    ("continuity", "Prose continuity", "Compare scene cast and assigned places with the prose."),
]:
    register(
        Evaluator(
            id=_id,
            name=_name,
            description=_description,
            inputs=("scene.content",),
            missing=lambda graph: (
                [] if any(scene.content for scene in graph.scenes) else ["Draft a scene"]
            ),
            run=lambda graph: EvaluationResult(),
            kind="reader",
        )
    )
