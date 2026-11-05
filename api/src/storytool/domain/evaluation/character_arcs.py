"""Character arcs, scene by scene (narrative/models.py CharacterSceneState).

For a scene, the author records where a character stands: their misbelief stage (holds, doubts,
tested, lets go, relapses), how their want is going (pursued, blocked, won, given up), and a note.
An agent's states start `suggested`; the check ignores them until the author accepts them.

The check (`character_arcs`) reads accepted states only and flags, in Checks and nowhere else: a
misbelief stuck on one stage for many recorded scenes, a misbelief let go (or relapsed) with no
scene that tested it first, and a major character whose last recorded stage leaves the arc open.
"""

from collections.abc import Iterable
from typing import Literal
from uuid import UUID

from litestar import Controller, Request, delete, get, patch, post
from litestar.exceptions import NotFoundException, PermissionDeniedException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id
from storytool.domain.cast.models import Character
from storytool.domain.evaluation.engine import (
    EvaluationFinding,
    EvaluationResult,
    Evaluator,
    register,
)
from storytool.domain.evaluation.setup_marks import _origin
from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity
from storytool.domain.narrative.models import CharacterSceneState, Scene

Misbelief = Literal["holds", "doubts", "tested", "lets_go", "relapses"]
Want = Literal["pursued", "blocked", "won", "given_up"]
STALL_AFTER = 4
"""This many recorded scenes in a row on `holds` or `doubts` reads as a stalled arc."""
_RESOLVED = {"lets_go", "relapses"}
_LABEL = {
    "holds": "holds the misbelief",
    "doubts": "doubts it",
    "tested": "tested",
    "lets_go": "lets go",
    "relapses": "relapses",
}


def _major(c: Character) -> bool:
    return c.role in {"protagonist", "antagonist"} or c.arc_type in {"positive", "negative"}


def _needs_states(g: StoryGraph) -> list[str]:
    if any(status == "active" for *_, status in g.character_states):
        return []
    return ["Record a character's misbelief stage for a scene in Design → Characters"]


def _run(g: StoryGraph) -> EvaluationResult:
    order = {s.id: index for index, s in enumerate(g.scenes_in_reading_order())}
    titles = {s.id: s.title or "Untitled scene" for s in g.scenes}
    by_character: dict[UUID, list[tuple[int, UUID, str]]] = {}
    for scene_id, character_id, misbelief, _want, status in g.character_states:
        if status == "active" and misbelief and scene_id in order:
            by_character.setdefault(character_id, []).append((order[scene_id], scene_id, misbelief))
    findings: list[EvaluationFinding] = []

    def finding(code: str, cid: UUID, scene_id: UUID, message: str, severity: Severity) -> None:
        findings.append(
            EvaluationFinding(
                code=code,
                severity=severity,
                message=message,
                entity_type="character",
                entity_id=cid,
                passage=None,
            )
        )

    characters = g.character_by_id()
    for cid, rows in by_character.items():
        character = characters.get(cid)
        if character is None:
            continue
        rows.sort()
        name = character.name or "A character"
        run_start, run_len = 0, 0
        for index, (_, _scene, stage) in enumerate(rows):
            if index and stage == rows[index - 1][2] and stage in {"holds", "doubts"}:
                run_len += 1
            else:
                run_start, run_len = index, 1
            if run_len == STALL_AFTER:
                first, last = rows[run_start][1], rows[index][1]
                finding(
                    "arc.stall",
                    cid,
                    first,
                    f"{name} {_LABEL[stage]} for {STALL_AFTER} recorded scenes in a row, from "
                    f"'{titles[first]}' to '{titles[last]}'. Is something pressing on it?",
                    Severity.WARNING,
                )
        tested = False
        for _, scene_id, stage in rows:
            if stage == "tested":
                tested = True
            elif stage in _RESOLVED and not tested:
                finding(
                    "arc.off_page",
                    cid,
                    scene_id,
                    f"{name} {_LABEL[stage]} in '{titles[scene_id]}', but no earlier recorded "
                    "scene tests the misbelief. The turn may happen off the page.",
                    Severity.WARNING,
                )
                break
        if _major(character) and len(rows) >= 2 and rows[-1][2] not in _RESOLVED:
            last_scene, last_stage = rows[-1][1], rows[-1][2]
            finding(
                "arc.unresolved",
                cid,
                last_scene,
                f"{name}'s last recorded stage is '{_LABEL[last_stage]}' in "
                f"'{titles[last_scene]}'. The arc doesn't land yet.",
                Severity.INFO,
            )
    return EvaluationResult(
        findings=tuple(findings),
        visual={
            "characters": len(by_character),
            "states": sum(len(rows) for rows in by_character.values()),
            "suggested": sum(1 for *_, status in g.character_states if status == "suggested"),
        },
    )


register(
    Evaluator(
        id="character_arcs",
        name="Character arcs",
        description=(
            "The misbelief stages you record per scene in Design → Characters: arcs stuck on "
            "one stage, misbeliefs let go with no scene that tests them, and major characters "
            "whose arc doesn't land."
        ),
        inputs=("character_scene_state",),
        missing=_needs_states,
        run=_run,
        reads_prose=False,
    )
)


class StateOut(BaseModel):
    id: UUID
    scene_id: UUID
    scene_title: str
    character_id: UUID
    character_name: str
    misbelief: str | None
    want: str | None
    note: str | None
    source: str
    status: str
    position: int | None
    """Reading-order index of the scene; null when the scene is not placed in a chapter."""


class SceneRef(BaseModel):
    id: UUID
    title: str
    characters: list[UUID]
    """Characters who appear in the scene (mentions the author has not rejected)."""


class StatesOut(BaseModel):
    states: list[StateOut]
    scenes: list[SceneRef]
    """Placed scenes in reading order, so a client can lay a character's arc along them."""


class StateIn(BaseModel):
    scene_id: UUID
    character_id: UUID
    misbelief: Misbelief | None = None
    want: Want | None = None
    note: str | None = Field(default=None, max_length=2000)


class StatePatch(BaseModel):
    status: Literal["active"]
    """Accepting a suggested state; only the author can."""


class CharacterStateController(Controller):
    path = "/api/stories/{story_id:uuid}/character-states"
    tags = ["evaluation"]  # noqa: RUF012

    async def _state(self, db: AsyncSession, story_id: UUID, state_id: UUID) -> CharacterSceneState:
        state = await db.scalar(
            select(CharacterSceneState)
            .join(Scene, Scene.id == CharacterSceneState.scene_id)
            .where(CharacterSceneState.id == state_id, Scene.story_id == story_id)
        )
        if state is None:
            raise NotFoundException(detail="No such character state in this story")
        return state

    @get(summary="Each character's recorded misbelief and want, scene by scene")
    async def list_states(self, db_session: AsyncSession, story_id: UUID) -> StatesOut:
        g = await load_graph_by_id(db_session, story_id)
        if g is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        order = {s.id: index for index, s in enumerate(g.scenes_in_reading_order())}
        scenes = {s.id: s for s in g.scenes}
        names = {c.id: c.name for c in g.characters}
        rows: Iterable[CharacterSceneState] = (
            await db_session.scalars(
                select(CharacterSceneState).where(CharacterSceneState.scene_id.in_(list(scenes)))
            )
            if scenes
            else []
        )
        out = [
            StateOut(
                id=r.id,
                scene_id=r.scene_id,
                scene_title=scenes[r.scene_id].title or "Untitled scene",
                character_id=r.character_id,
                character_name=names.get(r.character_id) or "Unnamed",
                misbelief=r.misbelief,
                want=r.want,
                note=r.note,
                source=r.source,
                status=r.status,
                position=order.get(r.scene_id),
            )
            for r in rows
        ]
        present = g.characters_in_scene()
        return StatesOut(
            states=sorted(
                out, key=lambda s: (s.position is None, s.position or 0, s.character_name)
            ),
            scenes=[
                SceneRef(
                    id=s.id,
                    title=s.title or "Untitled scene",
                    characters=sorted(present.get(s.id, set())),
                )
                for s in g.scenes_in_reading_order()
            ],
        )

    @post(summary="Record a character's state in a scene (an agent's state is suggested)")
    async def upsert_state(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: StateIn
    ) -> StateOut:
        scene = await db_session.scalar(
            select(Scene).where(Scene.id == data.scene_id, Scene.story_id == story_id)
        )
        if scene is None:
            raise NotFoundException(detail="No such scene in this story")
        character = await db_session.scalar(
            select(Character).where(
                Character.id == data.character_id, Character.story_id == story_id
            )
        )
        if character is None:
            raise NotFoundException(detail="No such character in this story")
        source = _origin(request)
        state = await db_session.scalar(
            select(CharacterSceneState).where(
                CharacterSceneState.scene_id == scene.id,
                CharacterSceneState.character_id == character.id,
            )
        )
        if state is None:
            state = CharacterSceneState(scene_id=scene.id, character_id=character.id)
            db_session.add(state)
        elif source == "agent" and state.status == "active":
            raise PermissionDeniedException(
                detail="The author already recorded this state; an agent can't replace it"
            )
        state.misbelief = data.misbelief
        state.want = data.want
        state.note = (data.note or "").strip() or None
        state.source = source
        state.status = "suggested" if source == "agent" else "active"
        await db_session.flush()
        return StateOut(
            id=state.id,
            scene_id=scene.id,
            scene_title=scene.title or "Untitled scene",
            character_id=character.id,
            character_name=character.name or "Unnamed",
            misbelief=state.misbelief,
            want=state.want,
            note=state.note,
            source=state.source,
            status=state.status,
            position=None,
        )

    @patch("/{state_id:uuid}", summary="Accept a suggested character state")
    async def accept_state(
        self,
        request: Request,
        db_session: AsyncSession,
        story_id: UUID,
        state_id: UUID,
        data: StatePatch,
    ) -> None:
        if _origin(request) == "agent":
            raise PermissionDeniedException(detail="Only the author can accept a suggestion")
        (await self._state(db_session, story_id, state_id)).status = data.status

    @delete("/{state_id:uuid}", summary="Remove a character's state for a scene")
    async def delete_state(self, db_session: AsyncSession, story_id: UUID, state_id: UUID) -> None:
        await db_session.delete(await self._state(db_session, story_id, state_id))
