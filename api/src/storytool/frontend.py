"""Serve the built React app beside /api, preserving same-origin sessions."""

from pathlib import Path
from uuid import UUID

from litestar import Router, get
from litestar.handlers import HTTPRouteHandler
from litestar.response import File
from litestar.static_files import create_static_files_router


def frontend_router(directory: Path) -> Router:
    directory = directory.resolve()
    if not (directory / "index.html").is_file() or not (directory / "assets").is_dir():
        raise RuntimeError("Build the frontend before setting STORYTOOL_FRONTEND_DIR")

    @get(["/", "/settings", "/how-to-use", "/stories/{story_id:uuid}"], include_in_schema=False)
    async def index(story_id: UUID | None = None) -> File:
        return File(
            directory / "index.html",
            media_type="text/html",
            content_disposition_type="inline",
            headers={"Cache-Control": "no-cache"},
        )

    handlers: list[HTTPRouteHandler | Router] = [
        index,
        create_static_files_router("/assets", directories=[directory / "assets"]),
    ]
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
