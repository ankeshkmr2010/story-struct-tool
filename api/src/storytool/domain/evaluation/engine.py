"""Story evaluation: on-demand, pluggable evaluators.

Separate from `health` on purpose. Health rules run on every read and flag gaps in the
graph; evaluators only run when the author asks, and judge the story against a named craft
framework (scene/sequel rhythm, MICE nesting, ...). Their input fields are plain authoring
fields -- nothing is flagged just because an evaluator could use them.

An evaluator is one module that builds an `Evaluator` and calls `register`. Each declares
what it needs (`missing`), so the page can say why it cannot run yet, and returns findings
plus a `visual` payload its chart reads. Deterministic results are computed per request and
never stored.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity

__all__ = (
    "EvaluationFinding",
    "EvaluationResult",
    "Evaluator",
    "all_evaluators",
    "get_evaluator",
    "register",
)


@dataclass(frozen=True, slots=True)
class EvaluationFinding:
    code: str
    severity: Severity
    message: str
    entity_type: str | None = None
    entity_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class EvaluationResult:
    findings: tuple[EvaluationFinding, ...] = ()
    visual: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Evaluator:
    id: str
    name: str
    description: str
    inputs: tuple[str, ...]
    """The authoring fields this evaluator reads, for the page to point at."""
    missing: Callable[[StoryGraph], list[str]]
    """What still has to be filled in before it can run; empty means ready."""
    run: Callable[[StoryGraph], EvaluationResult]
    kind: str = "deterministic"


_REGISTRY: dict[str, Evaluator] = {}


def register(evaluator: Evaluator) -> Evaluator:
    if evaluator.id in _REGISTRY:
        raise ValueError(f"Duplicate evaluator id {evaluator.id!r}")
    _REGISTRY[evaluator.id] = evaluator
    return evaluator


def all_evaluators() -> tuple[Evaluator, ...]:
    return tuple(_REGISTRY.values())


def get_evaluator(evaluator_id: str) -> Evaluator | None:
    return _REGISTRY.get(evaluator_id)
