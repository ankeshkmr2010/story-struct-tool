"""Prose checks that need no AI: TK placeholders and name consistency.

Both read the saved prose through `prose_scan`, so each finding carries the passage it came
from and opens there in Write. Only scenes placed in chapters are read, in reading order --
the same text an export contains.
"""

from collections import defaultdict
from uuid import UUID

from storytool.domain.evaluation.engine import (
    EvaluationFinding,
    EvaluationResult,
    Evaluator,
    FindingAction,
    register,
)
from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity
from storytool.domain.prose_scan import (
    NameSource,
    ProseMatch,
    lowercase_vocabulary,
    markers,
    near_miss_names,
    scan,
)

MAX_NAME_FINDINGS = 50
ALIAS_TARGETS = {"character", "glossary_entry"}
"""Entity kinds whose aliases the author can extend from a finding; places have no aliases."""


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


def name_sources(g: StoryGraph) -> list[NameSource]:
    return [
        *(NameSource("character", c.id, c.name, tuple(c.aliases or ())) for c in g.characters),
        *(NameSource("location", place.id, place.name) for place in g.locations),
        *(
            NameSource("glossary_entry", entry.id, entry.term, tuple(entry.aliases or ()))
            for entry in g.glossary_entries
        ),
    ]


def _missing_names(g: StoryGraph) -> list[str]:
    missing = _needs_prose(g)
    if not name_sources(g):
        missing.append("Add a character, place or glossary term")
    return missing


def _run_names(g: StoryGraph) -> EvaluationResult:
    scenes = g.scenes_in_reading_order()
    matcher = near_miss_names(name_sources(g), lowercase_vocabulary(scenes))
    # One finding per spelling and name it resembles, opened at its first appearance.
    groups: dict[tuple[str, str], list[ProseMatch]] = defaultdict(list)
    for match in scan(scenes, matcher):
        groups[(match.text, match.details["entity_id"])].append(match)

    findings = []
    for (variant, _), matches in list(groups.items())[:MAX_NAME_FINDINGS]:
        first = matches[0]
        name, entity_type = first.details["name"], first.details["entity_type"]
        entity_id = UUID(first.details["entity_id"])
        times = "once" if len(matches) == 1 else f"{len(matches)} times"
        findings.append(
            EvaluationFinding(
                code="names.near_miss",
                severity=Severity.WARNING,
                message=(
                    f"'{variant}' looks like {name}: it appears {times}, first in "
                    f"'{_title(first)}'. Fix the spelling, or add it as an alias if intended."
                ),
                entity_type=entity_type,
                entity_id=entity_id,
                passage=first.passage,
                action=(
                    FindingAction(
                        kind="add_alias",
                        label=f"Add '{variant}' as an alias of {name}",
                        entity_type=entity_type,
                        entity_id=entity_id,
                        value=variant,
                    )
                    if entity_type in ALIAS_TARGETS
                    else None
                ),
            )
        )
    return EvaluationResult(
        findings=tuple(findings),
        visual={"spellings": len(groups), "shown": len(findings)},
    )


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

NAME_CONSISTENCY = register(
    Evaluator(
        id="name_consistency",
        name="Name consistency",
        description=(
            "Flags capitalised words one or two letters away from a character, place or "
            "glossary name or alias (Maia for Maya). Intended variants can be added as aliases."
        ),
        inputs=("scene.content", "character.aliases", "glossary_entry.aliases"),
        missing=_missing_names,
        run=_run_names,
        reads_prose=True,
    )
)
