"""Importing the package registers every evaluator."""

from storytool.domain.evaluation import mice_nesting, scene_rhythm  # noqa: F401
from storytool.domain.evaluation.engine import all_evaluators, get_evaluator

__all__ = ("all_evaluators", "get_evaluator")
