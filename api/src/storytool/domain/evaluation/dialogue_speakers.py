"""Who speaks each quoted line, stored (narrative/models.py DialogueSpeaker).

Every line starts empty. `populate` fills only empty lines: first the code rule (speech tag or a
named subject, `dialogue_voice.extract`), then optionally the shared reader, kept only at high
confidence. Agents and the author set or clear speakers directly; the passes never overwrite a
stored speaker. Dialogue voice reads stored speakers first.
"""

from uuid import UUID

from litestar import Controller, Request, get, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id
from storytool.domain.evaluation.dialogue_voice import Line, extract, prepare
from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import DialogueSpeaker


class DialogueLineOut(BaseModel):
    line_id: str
    """scene_id:n, the n-th quoted line of the scene. Send it back with `text` to set a speaker."""
    scene_id: UUID
    scene_title: str
    paragraph: int
    find: str
    """The quote as written, marks included, to locate it in Write."""
    text: str
    speaker_id: UUID | None
    speaker: str | None
    source: str | None
    """code | reader | agent | author; empty while nobody has said who speaks."""


class DialogueOut(BaseModel):
    total: int
    attributed: int
    lines: list[DialogueLineOut]
    characters: dict[str, str]
    """character id -> name, the speakers you can choose from."""


class PopulateIn(BaseModel):
    use_reader: bool = False
    """Also ask the shared reader about lines the code rule leaves empty (high confidence only)."""


class PopulateOut(BaseModel):
    total: int
    by_code: int
    by_reader: int
    empty: int
    removed: int
    """Stored speakers whose quote is no longer in the scene."""


class SpeakerIn(BaseModel):
    line_id: str
    text: str
    """The line's text as listed, so a line that changed since is refused, not mislabelled."""
    character_id: UUID | None = None
    """None clears the speaker."""


class SpeakersIn(BaseModel):
    lines: list[SpeakerIn] = Field(min_length=1, max_length=500)


class SpeakersOut(BaseModel):
    updated: int
    cleared: int
    stale: list[str]
    """line_ids whose text no longer matches; list the dialogue again and retry those."""


def _ids(lines: list[Line]) -> dict[str, Line]:
    count: dict[UUID, int] = {}
    out = {}
    for line in lines:
        count[line.scene_id] = count.get(line.scene_id, 0) + 1
        out[f"{line.scene_id}:{count[line.scene_id]}"] = line
    return out


def _key(line: Line) -> tuple[UUID, str, int]:
    return (line.scene_id, line.text, line.occurrence)


async def _rows(db: AsyncSession, g: StoryGraph) -> dict[tuple[UUID, str, int], DialogueSpeaker]:
    scene_ids = [scene.id for scene in g.scenes]
    if not scene_ids:
        return {}
    rows = await db.scalars(select(DialogueSpeaker).where(DialogueSpeaker.scene_id.in_(scene_ids)))
    return {(r.scene_id, r.quote_text, r.occurrence): r for r in rows}


class DialogueController(Controller):
    path = "/api/stories/{story_id:uuid}/dialogue"
    tags = ["evaluation"]  # noqa: RUF012

    async def _graph(self, db_session: AsyncSession, story_id: UUID) -> StoryGraph:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return graph

    @get(summary="Quoted lines and who speaks each (empty until set)")
    async def list_dialogue(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        only_empty: bool = False,
        scene_id: UUID | None = None,
        character_id: UUID | None = None,
        offset: int = 0,
        limit: int = 200,
    ) -> DialogueOut:
        g = await self._graph(db_session, story_id)
        names = {c.id: c.name for c in g.characters}
        titles = {s.id: s.title or "Untitled scene" for s in g.scenes}
        lines = _ids(extract(g))
        chosen = [
            (line_id, line)
            for line_id, line in lines.items()
            if (scene_id is None or line.scene_id == scene_id)
            and (character_id is None or (line.source and line.speaker == character_id))
            and not (only_empty and line.source)
        ]
        return DialogueOut(
            total=len(lines),
            attributed=sum(1 for line in lines.values() if line.source),
            characters={str(key): name for key, name in names.items()},
            lines=[
                DialogueLineOut(
                    line_id=line_id,
                    scene_id=line.scene_id,
                    scene_title=titles.get(line.scene_id, ""),
                    paragraph=line.passage.paragraph,
                    find=line.passage.find,
                    text=line.text,
                    speaker_id=line.speaker if line.source else None,
                    speaker=names.get(line.speaker) if line.source and line.speaker else None,
                    source=line.source,
                )
                for line_id, line in chosen[max(offset, 0) : max(offset, 0) + min(limit, 500)]
            ],
        )

    @post("/populate", summary="Fill empty speakers from the text, optionally the shared reader")
    async def populate(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: PopulateIn
    ) -> PopulateOut:
        from storytool.config import get_settings

        settings = get_settings()
        if data.use_reader and not settings.shared_reader_available:
            raise ClientException(detail="The site-provided scene reader is not configured yet")
        g = await self._graph(db_session, story_id)
        lines = extract(g)
        rows = await _rows(db_session, g)
        current = {_key(line) for line in lines}
        removed = 0
        for key, row in rows.items():
            if key not in current:
                await db_session.delete(row)
                removed += 1
        by_code = 0
        for line in lines:
            if line.source is None and line.speaker is not None:
                db_session.add(
                    DialogueSpeaker(
                        scene_id=line.scene_id,
                        quote_text=line.text,
                        occurrence=line.occurrence,
                        character_id=line.speaker,
                        source="code",
                    )
                )
                line.source = "code"
                by_code += 1
        by_reader = 0
        if data.use_reader:
            from storytool.domain.ai.controller import actor
            from storytool.domain.decisions.providers import shared_provider
            from storytool.domain.decisions.service import Actor, DecisionService
            from storytool.domain.evaluation.dialogue_voice import attribute_with_reader

            # Plain values first: the commit below expires the graph's ORM objects.
            prepared = prepare(g)
            prepared.lines = lines
            provider, model = shared_provider()
            service = DecisionService(db_session, Actor.user(actor(request)), provider)
            await db_session.commit()  # No transaction held across the remote calls.
            await attribute_with_reader(
                prepared, service, model, settings.decision_evaluation_confidence
            )
            for line in lines:
                if line.by_reader and line.source is None and line.speaker is not None:
                    db_session.add(
                        DialogueSpeaker(
                            scene_id=line.scene_id,
                            quote_text=line.text,
                            occurrence=line.occurrence,
                            character_id=line.speaker,
                            source="reader",
                            confidence=line.confidence,
                        )
                    )
                    line.source = "reader"
                    by_reader += 1
        return PopulateOut(
            total=len(lines),
            by_code=by_code,
            by_reader=by_reader,
            empty=sum(1 for line in lines if line.source is None),
            removed=removed,
        )

    @post("/speakers", summary="Set or clear who speaks given lines")
    async def set_speakers(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: SpeakersIn
    ) -> SpeakersOut:
        g = await self._graph(db_session, story_id)
        cast = {c.id for c in g.characters}
        unknown = {
            str(item.character_id)
            for item in data.lines
            if item.character_id is not None and item.character_id not in cast
        }
        if unknown:
            raise NotFoundException(detail=f"No character in this story: {', '.join(unknown)}")
        source = (
            "agent"
            if request.scope.get("state", {}).get("storytool_write_origin") == "mcp"
            else "author"
        )
        lines = _ids(extract(g))
        rows = await _rows(db_session, g)
        changed, cleared, stale = 0, 0, []
        for item in data.lines:
            line = lines.get(item.line_id)
            if line is None or line.text != item.text.strip():
                stale.append(item.line_id)
                continue
            row = rows.get(_key(line))
            if item.character_id is None:
                if row is not None:
                    await db_session.execute(
                        delete(DialogueSpeaker).where(DialogueSpeaker.id == row.id)
                    )
                    cleared += 1
                continue
            if row is None:
                row = DialogueSpeaker(
                    scene_id=line.scene_id,
                    quote_text=line.text,
                    occurrence=line.occurrence,
                    character_id=item.character_id,
                    source=source,
                )
                db_session.add(row)
                rows[_key(line)] = row
            else:
                row.character_id, row.source, row.confidence = item.character_id, source, None
            changed += 1
        return SpeakersOut(updated=changed, cleared=cleared, stale=stale)
