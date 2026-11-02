"""Setups and payoffs the author marks in the prose (narrative/models.py SetupMark, SetupLink).

Marks are stored links beside the prose, never prose edits. A mark is found again by its text and
which occurrence of that text in the scene it is. An agent's marks and links start `suggested`:
they show in Write and Design for the author to accept, and the check ignores them until then.

The check (`setup_marks`) reads accepted marks only and flags, in Checks and nowhere else: a
setup nothing pays off, a payoff with no setup, a payoff read before its setup, and a mark whose
text is no longer in the scene.
"""

from typing import Literal
from uuid import UUID

from litestar import Controller, Request, delete, get, patch, post
from litestar.exceptions import ClientException, NotFoundException, PermissionDeniedException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id
from storytool.domain.evaluation.engine import (
    EvaluationFinding,
    EvaluationResult,
    Evaluator,
    register,
)
from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity
from storytool.domain.narrative.models import Scene, SetupLink, SetupMark
from storytool.domain.prose_scan import Passage, excerpt_around, paragraph_spans

Kind = Literal["setup", "payoff"]


def locate(scene: Scene, text: str, occurrence: int) -> Passage | None:
    """The `occurrence`-th appearance of `text` in the scene, if it sits inside one paragraph."""
    content = scene.content or ""
    at = -1
    for _ in range(max(occurrence, 1)):
        at = content.find(text, at + 1)
        if at < 0:
            return None
    for number, (offset, paragraph) in enumerate(paragraph_spans(content), start=1):
        if offset <= at and at + len(text) <= offset + len(paragraph):
            start = at - offset
            return Passage(
                scene_id=scene.id,
                paragraph=number,
                find=text,
                start=at,
                end=at + len(text),
                excerpt=excerpt_around(paragraph, start, start + len(text)),
            )
    return None


class _Mark:
    def __init__(self, g: StoryGraph, row: tuple[UUID, UUID, str, str, int, str | None, str]):
        self.id, self.scene_id, self.kind, self.text, self.occurrence, self.label, self.status = row
        scenes = {s.id: s for s in g.scenes}
        order = {s.id: index for index, s in enumerate(g.scenes_in_reading_order())}
        scene = scenes.get(self.scene_id)
        self.scene_title = (scene.title if scene else None) or "Untitled scene"
        self.passage = locate(scene, self.text, self.occurrence) if scene else None
        self.position = (
            (order[self.scene_id], self.passage.start)
            if self.passage and self.scene_id in order
            else None
        )

    @property
    def name(self) -> str:
        return self.label or self.text


def marks(g: StoryGraph) -> list[_Mark]:
    """Every mark, in reading order; marks in unplaced scenes or with lost text last."""
    found = [_Mark(g, row) for row in g.setup_marks]
    return sorted(found, key=lambda m: (m.position is None, m.position or (0, 0), m.text))


def _needs_marks(g: StoryGraph) -> list[str]:
    if any(status == "active" for *_, status in g.setup_marks):
        return []
    return ["Mark a setup or a payoff in Write (select text, then Mark as setup)"]


def _run(g: StoryGraph) -> EvaluationResult:
    active = [m for m in marks(g) if m.status == "active"]
    by_id = {m.id: m for m in active}
    links = [(s, p) for s, p, status in g.setup_links if status == "active"]
    payoffs: dict[UUID, list[_Mark]] = {}
    setups: dict[UUID, list[_Mark]] = {}
    for setup_id, payoff_id in links:
        if setup_id in by_id and payoff_id in by_id:
            payoffs.setdefault(setup_id, []).append(by_id[payoff_id])
            setups.setdefault(payoff_id, []).append(by_id[setup_id])
    findings: list[EvaluationFinding] = []

    def finding(code: str, mark: _Mark, message: str, severity: Severity) -> None:
        findings.append(
            EvaluationFinding(
                code=code,
                severity=severity,
                message=message,
                entity_type="scene",
                entity_id=mark.scene_id,
                passage=mark.passage,
            )
        )

    for mark in active:
        if mark.passage is None:
            finding(
                "setup.lost",
                mark,
                f"The marked {mark.kind} '{mark.name}' in '{mark.scene_title}' is no longer in "
                "the text. Mark it again or remove it.",
                Severity.WARNING,
            )
        elif mark.kind == "setup" and not payoffs.get(mark.id):
            finding(
                "setup.unpaid",
                mark,
                f"Setup '{mark.name}' in '{mark.scene_title}' has no payoff yet.",
                Severity.WARNING,
            )
        elif mark.kind == "payoff" and not setups.get(mark.id):
            finding(
                "setup.payoff_without_setup",
                mark,
                f"Payoff '{mark.name}' in '{mark.scene_title}' has no setup linked to it.",
                Severity.INFO,
            )
        elif mark.kind == "payoff":
            for setup in setups[mark.id]:
                if mark.position and setup.position and mark.position < setup.position:
                    finding(
                        "setup.payoff_first",
                        mark,
                        f"Payoff '{mark.name}' in '{mark.scene_title}' comes before its setup "
                        f"'{setup.name}' in '{setup.scene_title}'.",
                        Severity.WARNING,
                    )
    return EvaluationResult(
        findings=tuple(findings),
        visual={
            "setups": sum(1 for m in active if m.kind == "setup"),
            "payoffs": sum(1 for m in active if m.kind == "payoff"),
            "links": len(links),
            "suggested": sum(1 for *_, status in g.setup_marks if status == "suggested")
            + sum(1 for *_, status in g.setup_links if status == "suggested"),
        },
    )


register(
    Evaluator(
        id="setup_marks",
        name="Marked setups and payoffs",
        description=(
            "Setups and payoffs you mark in Write: setups nothing pays off, payoffs with no "
            "setup, payoffs that come before their setup, and marks whose text has changed."
        ),
        inputs=("setup_mark",),
        missing=_needs_marks,
        run=_run,
        reads_prose=True,
    )
)


class MarkOut(BaseModel):
    id: UUID
    scene_id: UUID
    scene_title: str
    kind: str
    text: str
    occurrence: int
    """Which appearance of `text` in the scene the mark is."""
    label: str | None
    source: str
    status: str
    found: bool
    """False when the marked text is no longer in the scene."""
    paragraph: int | None
    find: str | None


class LinkOut(BaseModel):
    id: UUID
    setup_id: UUID
    payoff_id: UUID
    source: str
    status: str


class SetupsOut(BaseModel):
    marks: list[MarkOut]
    links: list[LinkOut]


class MarkIn(BaseModel):
    scene_id: UUID
    kind: Kind
    text: str = Field(min_length=1, max_length=2000)
    start: int | None = Field(default=None, ge=0)
    """Offset of the text in the saved scene (Write); otherwise `occurrence` (default 1)."""
    occurrence: int | None = Field(default=None, ge=1)
    label: str | None = Field(default=None, max_length=200)


class MarkPatch(BaseModel):
    kind: Kind | None = None
    label: str | None = Field(default=None, max_length=200)
    status: Literal["active"] | None = None
    """Accepting a suggested mark; only the author can."""


class LinkIn(BaseModel):
    setup_id: UUID
    payoff_id: UUID


class LinkPatch(BaseModel):
    status: Literal["active"]


def _origin(request: Request) -> str:
    return (
        "agent"
        if request.scope.get("state", {}).get("storytool_write_origin") == "mcp"
        else "author"
    )


class SetupController(Controller):
    path = "/api/stories/{story_id:uuid}/setups"
    tags = ["evaluation"]  # noqa: RUF012

    async def _graph(self, db: AsyncSession, story_id: UUID) -> StoryGraph:
        graph = await load_graph_by_id(db, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return graph

    async def _mark(self, db: AsyncSession, story_id: UUID, mark_id: UUID) -> SetupMark:
        mark = await db.scalar(
            select(SetupMark)
            .join(Scene, Scene.id == SetupMark.scene_id)
            .where(SetupMark.id == mark_id, Scene.story_id == story_id)
        )
        if mark is None:
            raise NotFoundException(detail="No such setup or payoff in this story")
        return mark

    async def _link(self, db: AsyncSession, story_id: UUID, link_id: UUID) -> SetupLink:
        link = await db.scalar(
            select(SetupLink)
            .join(SetupMark, SetupMark.id == SetupLink.setup_id)
            .join(Scene, Scene.id == SetupMark.scene_id)
            .where(SetupLink.id == link_id, Scene.story_id == story_id)
        )
        if link is None:
            raise NotFoundException(detail="No such link in this story")
        return link

    @get(summary="Marked setups and payoffs, and the links between them")
    async def list_setups(self, db_session: AsyncSession, story_id: UUID) -> SetupsOut:
        g = await self._graph(db_session, story_id)
        sources = {
            m.id: m.source
            for m in await db_session.scalars(
                select(SetupMark).where(SetupMark.scene_id.in_([s.id for s in g.scenes]))
            )
        }
        found = marks(g)
        links = (
            await db_session.scalars(
                select(SetupLink).where(SetupLink.setup_id.in_([m.id for m in found]))
            )
            if found
            else []
        )
        return SetupsOut(
            marks=[
                MarkOut(
                    id=m.id,
                    scene_id=m.scene_id,
                    scene_title=m.scene_title,
                    kind=m.kind,
                    text=m.text,
                    occurrence=m.occurrence,
                    label=m.label,
                    source=sources.get(m.id, "author"),
                    status=m.status,
                    found=m.passage is not None,
                    paragraph=m.passage.paragraph if m.passage else None,
                    find=m.passage.find if m.passage else None,
                )
                for m in found
            ],
            links=[
                LinkOut(
                    id=link.id,
                    setup_id=link.setup_id,
                    payoff_id=link.payoff_id,
                    source=link.source,
                    status=link.status,
                )
                for link in links
            ],
        )

    @post("/marks", summary="Mark a passage as a setup or a payoff (an agent's mark is suggested)")
    async def create_mark(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: MarkIn
    ) -> MarkOut:
        scene = await db_session.scalar(
            select(Scene).where(Scene.id == data.scene_id, Scene.story_id == story_id)
        )
        if scene is None:
            raise NotFoundException(detail="No such scene in this story")
        content = scene.content or ""
        if data.start is not None:
            if content[data.start : data.start + len(data.text)] != data.text:
                raise ClientException(
                    detail="The scene has changed since this text was selected. Save and retry."
                )
            occurrence, at = 0, -1
            while True:
                at = content.find(data.text, at + 1)
                if at < 0 or at > data.start:
                    break
                occurrence += 1
        else:
            occurrence = data.occurrence or 1
        passage = locate(scene, data.text, occurrence)
        if passage is None:
            raise ClientException(
                detail="That text is not in the scene within one paragraph. Mark text from a "
                "single paragraph, exactly as it appears."
            )
        source = _origin(request)
        mark = SetupMark(
            scene_id=scene.id,
            kind=data.kind,
            quote_text=data.text,
            occurrence=occurrence,
            label=(data.label or "").strip() or None,
            source=source,
            status="suggested" if source == "agent" else "active",
        )
        db_session.add(mark)
        await db_session.flush()
        return MarkOut(
            id=mark.id,
            scene_id=scene.id,
            scene_title=scene.title or "Untitled scene",
            kind=mark.kind,
            text=mark.quote_text,
            occurrence=mark.occurrence,
            label=mark.label,
            source=mark.source,
            status=mark.status,
            found=True,
            paragraph=passage.paragraph,
            find=passage.find,
        )

    @patch("/marks/{mark_id:uuid}", summary="Change a mark's kind or label, or accept it")
    async def update_mark(
        self,
        request: Request,
        db_session: AsyncSession,
        story_id: UUID,
        mark_id: UUID,
        data: MarkPatch,
    ) -> None:
        mark = await self._mark(db_session, story_id, mark_id)
        if data.status and _origin(request) == "agent":
            raise PermissionDeniedException(detail="Only the author can accept a suggestion")
        fields = data.model_fields_set
        if "kind" in fields and data.kind:
            mark.kind = data.kind
        if "label" in fields:
            mark.label = (data.label or "").strip() or None
        if data.status:
            mark.status = data.status

    @delete("/marks/{mark_id:uuid}", summary="Remove a mark and its links")
    async def delete_mark(self, db_session: AsyncSession, story_id: UUID, mark_id: UUID) -> None:
        await db_session.delete(await self._mark(db_session, story_id, mark_id))

    @post("/links", summary="Link a setup to a payoff (an agent's link is suggested)")
    async def create_link(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: LinkIn
    ) -> LinkOut:
        setup = await self._mark(db_session, story_id, data.setup_id)
        payoff = await self._mark(db_session, story_id, data.payoff_id)
        if setup.kind != "setup" or payoff.kind != "payoff":
            raise ClientException(detail="Link a setup (setup_id) to a payoff (payoff_id)")
        existing = await db_session.scalar(
            select(SetupLink).where(
                SetupLink.setup_id == setup.id, SetupLink.payoff_id == payoff.id
            )
        )
        source = _origin(request)
        link = existing or SetupLink(
            setup_id=setup.id,
            payoff_id=payoff.id,
            source=source,
            status="suggested" if source == "agent" else "active",
        )
        if existing is None:
            db_session.add(link)
        elif source == "author":
            link.status = "active"
        await db_session.flush()
        return LinkOut(
            id=link.id,
            setup_id=link.setup_id,
            payoff_id=link.payoff_id,
            source=link.source,
            status=link.status,
        )

    @patch("/links/{link_id:uuid}", summary="Accept a suggested link")
    async def update_link(
        self,
        request: Request,
        db_session: AsyncSession,
        story_id: UUID,
        link_id: UUID,
        data: LinkPatch,
    ) -> None:
        if _origin(request) == "agent":
            raise PermissionDeniedException(detail="Only the author can accept a suggestion")
        link = await self._link(db_session, story_id, link_id)
        link.status = data.status
        for mark_id in (link.setup_id, link.payoff_id):
            (await self._mark(db_session, story_id, mark_id)).status = "active"

    @delete("/links/{link_id:uuid}", summary="Remove a link (the marks stay)")
    async def delete_link(self, db_session: AsyncSession, story_id: UUID, link_id: UUID) -> None:
        await db_session.delete(await self._link(db_session, story_id, link_id))
