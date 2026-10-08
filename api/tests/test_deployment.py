from uuid import uuid4

from litestar import Litestar
from litestar.testing import TestClient

from storytool.config import Settings
from storytool.frontend import frontend_router


def test_neon_connection_string_uses_asyncpg_and_verified_tls():
    settings = Settings(
        _env_file=None,
        database_url="postgresql://writer:p%40ss@ep-example.neon.tech/storytool"
        "?sslmode=require&channel_binding=require",
    )
    assert settings.database_url == (
        "postgresql+asyncpg://writer:p%40ss@ep-example.neon.tech/storytool?ssl=verify-full"
    )


def test_frontend_routes_support_reload_without_serving_api_or_private_files(tmp_path):
    (tmp_path / "index.html").write_text("<html>StoryTool frontend</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('StoryTool')")
    (tmp_path / ".env").write_text("not-a-real-secret")
    app = Litestar(route_handlers=[frontend_router(tmp_path)])
    with TestClient(app) as client:
        for route in ["/", "/settings", "/how-to-use", f"/stories/{uuid4()}"]:
            response = client.get(route)
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/html")
            assert "StoryTool frontend" in response.text
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/.env").status_code == 404
        assert client.get("/api/missing").status_code == 404
        assert client.get("/assets/missing.js").status_code == 404
