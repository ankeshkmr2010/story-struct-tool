"""Serve the built React app beside /api, preserving same-origin sessions."""

from pathlib import Path
from uuid import UUID

from litestar import Request, Response, Router, get
from litestar.handlers import HTTPRouteHandler
from litestar.response import File
from litestar.static_files import create_static_files_router
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.social_preview import preview_html, preview_metadata


def frontend_router(directory: Path) -> Router:
    directory = directory.resolve()
    if not (directory / "index.html").is_file() or not (directory / "assets").is_dir():
        raise RuntimeError("Build the frontend before setting STORYTOOL_FRONTEND_DIR")

    html = (directory / "index.html").read_text(encoding="utf-8")

    @get(
        [
            "/",
            "/library",
            "/try",
            "/try/keep",
            "/try/{feature:path}",
            "/settings",
            "/checks",
            "/how-to-use",
            "/roadmap",
            "/thanks",
            "/about",
            "/pricing",
            "/privacy",
            "/feedback",
            "/oauth/consent",
            "/stories/{story_id:uuid}",
            "/shared/{story_id:uuid}",
            "/stories/{story_id:uuid}/images",
            "/stories/{story_id:uuid}/beta",
            "/stories/{story_id:uuid}/polls",
            "/stories/{story_id:uuid}/beside/{kind:str}/{item_id:uuid}",
            "/beta/join/{token:str}",
            "/beta/rounds/{round_id:uuid}",
            "/beta/rounds/{round_id:uuid}/threads/{thread_id:uuid}",
            "/showcase/{token:str}",
        ],
        include_in_schema=False,
    )
    async def index(
        request: Request,
        db_session: AsyncSession,
        story_id: UUID | None = None,
        token: str | None = None,
        round_id: UUID | None = None,
        thread_id: UUID | None = None,
        feature: Path | None = None,
        kind: str | None = None,
        item_id: UUID | None = None,
    ) -> Response[str]:
        metadata = await preview_metadata(db_session, request.url.path, token)
        return Response(
            preview_html(html, metadata),
            media_type="text/html",
            headers={"Cache-Control": "no-cache"},
        )

    handlers: list[HTTPRouteHandler | Router] = [
        index,
        create_static_files_router("/assets", directories=[directory / "assets"]),
    ]
    if (directory / "branding").is_dir():
        handlers.append(
            create_static_files_router("/branding", directories=[directory / "branding"])
        )
    if (directory / "sandbox").is_dir():
        handlers.append(create_static_files_router("/sandbox", directories=[directory / "sandbox"]))
    if (directory / "vite.svg").is_file():

        @get("/vite.svg", include_in_schema=False)
        async def favicon() -> File:
            return File(
                directory / "vite.svg",
                media_type="image/svg+xml",
                content_disposition_type="inline",
            )

        handlers.append(favicon)
    return Router(path="/", route_handlers=handlers)
