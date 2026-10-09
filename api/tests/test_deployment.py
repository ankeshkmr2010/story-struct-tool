import ssl
from uuid import uuid4

from litestar import Litestar
from litestar.testing import TestClient
from sqlalchemy.engine import make_url

from storytool.config import Settings
from storytool.frontend import frontend_router


def test_neon_connection_string_uses_asyncpg_and_verified_tls():
    settings = Settings(
        _env_file=None,
        database_url="postgresql://writer:p%40ss@ep-example.neon.tech/storytool"
        "?sslmode=require&channel_binding=require",
    )
    url = make_url(settings.database_url)
    assert url.drivername == "postgresql+asyncpg"
    assert url.password == "p@ss"
    assert url.host == "ep-example.neon.tech"
    assert url.query["ssl"] == "verify-full"
    context = settings.database_connect_args["ssl"]
    assert isinstance(context, ssl.SSLContext)
    assert context.check_hostname
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert "channel_binding" not in url.query


def test_frontend_routes_support_reload_without_serving_api_or_private_files(tmp_path):
    (tmp_path / "index.html").write_text("<html>StoryTool frontend</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('StoryTool')")
    (tmp_path / "branding").mkdir()
    (tmp_path / "branding" / "storytool.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    )
    (tmp_path / "branding" / "storytool-icon.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (tmp_path / ".env").write_text("not-a-real-secret")
    app = Litestar(route_handlers=[frontend_router(tmp_path)])
    with TestClient(app) as client:
        for route in ["/", "/settings", "/how-to-use", f"/stories/{uuid4()}"]:
            response = client.get(route)
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/html")
            assert "attachment" not in response.headers.get("content-disposition", "")
            assert "StoryTool frontend" in response.text
        assert client.get("/assets/app.js").status_code == 200
        assert (
            client.get("/branding/storytool.svg")
            .headers["content-type"]
            .startswith("image/svg+xml")
        )
        assert client.get("/branding/storytool-icon.png").status_code == 200
        assert client.get("/branding/.env").status_code == 404
        assert client.get("/.env").status_code == 404
        assert client.get("/api/missing").status_code == 404
        assert client.get("/assets/missing.js").status_code == 404
