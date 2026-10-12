"""MICE nesting (Card; Kowal's "nest your threads like brackets").

A thread opens at its first scene and closes at its last, in reading order -- derived from
the scene links, never stored. Threads should close in the reverse order they opened: a
thread opened inside another should be resolved before the outer one is. A crossing pair
is flagged, never forbidden.
"""

from uuid import UUID

from storytool.domain.enums import MiceType
from storytool.domain.evaluation.engine import (
    EvaluationFinding,
    EvaluationResult,
    Evaluator,
    register,
)
from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity
from storytool.domain.structure.models import Thread

MIN_THREADS = 2

CLOSES_WHEN = {
    MiceType.MILIEU: "the character leaves the place",
    MiceType.IDEA: "the question is answered",
    MiceType.CHARACTER: "the character settles who they are",
    MiceType.EVENT: "order is restored (or a new order takes hold)",
}


def _label(thread: Thread) -> str:
    return thread.title or thread.type.replace("_", "-")


def _spans(g: StoryGraph) -> list[tuple[Thread, int, int, int]]:
    """(thread, open index, close index, linked scene count) for threads with placed scenes."""
    position = {scene.id: index for index, scene in enumerate(g.scenes_in_reading_order())}
    indices: dict[UUID, list[int]] = {}
    for scene_id, thread_id, _ in g.scene_threads:
        if scene_id in position:
            indices.setdefault(thread_id, []).append(position[scene_id])
    spans = [
        (thread, min(found), max(found), len(found))
        for thread in g.threads
        if (found := indices.get(thread.id))
    ]
    return sorted(spans, key=lambda span: (span[1], -span[2]))


def _missing(g: StoryGraph) -> list[str]:
    if len(_spans(g)) < MIN_THREADS:
        return [f"Link scenes placed in chapters to at least {MIN_THREADS} threads"]
    return []


def _run(g: StoryGraph) -> EvaluationResult:
    scenes = g.scenes_in_reading_order()
    spans = _spans(g)

    def scene_label(index: int) -> str:
        return f"'{scenes[index].title or 'untitled'}'"

    findings: list[EvaluationFinding] = []
    for outer, outer_open, outer_close, _ in spans:
        for inner, inner_open, inner_close, _ in spans:
            if not outer_open < inner_open < outer_close < inner_close:
                continue
            outer_name, inner_name = _label(outer), _label(inner)
            closes_at = scene_label(outer_close)
            message = (
                f"'{inner_name}' opens inside '{outer_name}' (at {scene_label(inner_open)}) "
                f"but is still open after '{outer_name}' closes (at {closes_at}). "
                f"The last thread opened usually closes first: consider resolving "
                f"'{inner_name}' before {closes_at}, or opening it earlier."
            )
            if outer.mice in CLOSES_WHEN:
                article = "an" if outer.mice[0] in "aeiou" else "a"
                message += (
                    f" '{outer_name}' is {article} {outer.mice} thread: it closes when "
                    f"{CLOSES_WHEN[MiceType(outer.mice)]}."
                )
            findings.append(
                EvaluationFinding(
                    code="mice.crossed_threads",
                    severity=Severity.WARNING,
                    message=message,
                    entity_type="thread",
                    entity_id=inner.id,
                )
            )

    uncategorised = [thread for thread, *_ in spans if not thread.mice]
    if uncategorised:
        findings.append(
            EvaluationFinding(
                code="mice.uncategorised",
                severity=Severity.INFO,
                message=(
                    f"{len(uncategorised)} thread(s) have no MICE category (milieu, idea, "
                    "character or event). Set one to get advice on what closing it means."
                ),
                entity_type="story",
                entity_id=g.story.id,
            )
        )

    visual = {
        "scene_count": len(scenes),
        "spans": [
            {
                "thread_id": str(thread.id),
                "title": _label(thread),
                "type": thread.type,
                "mice": thread.mice,
                "open": opened,
                "close": closed,
                "scene_count": count,
            }
            for thread, opened, closed, count in spans
        ],
    }
    return EvaluationResult(findings=tuple(findings), visual=visual)


MICE_NESTING = register(
    Evaluator(
        id="mice_nesting",
        name="MICE thread nesting",
        description=(
            "Treats each thread as opening at its first scene and closing at its last, and "
            "flags threads that close out of order (opened later, closed later)."
        ),
        inputs=("scene_thread", "scene.chapter_id", "thread.mice"),
        missing=_missing,
        run=_run,
    )
)
