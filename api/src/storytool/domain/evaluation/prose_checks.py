"""Prose checks that need no AI: TK placeholders and smart consistency.

Both read the saved prose through `prose_scan`, so each finding carries the passage it came
from and opens there in Write. Only scenes placed in chapters are read, in reading order --
the same text an export contains.
"""

from storytool.domain import consistency
from storytool.domain.evaluation.engine import (
    EvaluationFinding,
    EvaluationResult,
    Evaluator,
    register,
)
from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity
from storytool.domain.prose_scan import ProseMatch, markers, scan


def _title(match: ProseMatch) -> str:
    return match.scene.title or "Untitled scene"


def _needs_prose(g: StoryGraph) -> list[str]:
    if any(scene.content for scene in g.scenes_in_reading_order()):
        return []
    return ["Write prose in a scene that is placed in a chapter"]


def tk_placeholders(g: StoryGraph) -> list[ProseMatch]:
    """Every `[TK]` / `[TK: note]` in reading order; also used by the export warning."""
    return list(scan(g.scenes_in_reading_order(), markers("TK")))


def _run_tk(g: StoryGraph) -> EvaluationResult:
    found = tk_placeholders(g)
    findings = tuple(
        EvaluationFinding(
            code="tk.placeholder",
            severity=Severity.WARNING,
            message=(
                f"TK in '{_title(match)}': {match.details['note']}"
                if match.details["note"]
                else f"TK in '{_title(match)}' (no note): {match.excerpt}"
            ),
            entity_type="scene",
            entity_id=match.scene.id,
            passage=match.passage,
        )
        for match in found
    )
    return EvaluationResult(
        findings=findings, visual={"count": len(found), "scenes": len({m.scene.id for m in found})}
    )


def _run_consistency(g: StoryGraph) -> EvaluationResult:
    findings, counts = consistency.check(g)
    return EvaluationResult(findings=tuple(findings), visual={"language": g.language, **counts})


TK_PLACEHOLDERS = register(
    Evaluator(
        id="tk_placeholders",
        name="TK placeholders",
        description=(
            "Lists every [TK] or [TK: note] left in the prose, so nothing unfinished "
            "reaches an export. Type one whenever you want to keep writing and fill a "
            "detail in later."
        ),
        inputs=("scene.content",),
        missing=_needs_prose,
        run=_run_tk,
        reads_prose=True,
    )
)

CONSISTENCY = register(
    Evaluator(
        id="consistency",
        name="Smart consistency",
        description=(
            "Finds misspelt names (Maia for Maya), spellings from the other side of the "
            "Atlantic, terms written several ways (lantern-keeper, lanternkeeper) and "
            "inconsistent capitals. Each finding says why, weighing how often each spelling "
            "appears and who is in the scene, and can be fixed everywhere at once."
        ),
        inputs=(
            "scene.content",
            "character.aliases",
            "glossary_entry.aliases",
            "scene.pov_character_id",
            "story.language",
        ),
        missing=_needs_prose,
        run=_run_consistency,
        reads_prose=True,
    )
)
