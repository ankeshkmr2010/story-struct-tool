"""Direct browser navigation must serve the SPA without swallowing unknown API routes."""

from litestar import Litestar
from litestar.di import Provide
from litestar.testing import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.frontend import frontend_router


def test_admin_direct_navigation_and_reload(tmp_path) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text('<html><div id="root"></div></html>')

    async def no_session():
        return AsyncSession()

    app = Litestar([frontend_router(tmp_path)], dependencies={"db_session": Provide(no_session)})
    with TestClient(app) as client:
        for path in ["/admin", "/admin?tab=features", "/admin?tab=tiers"]:
            response = client.get(path)
            assert response.status_code == 200, response.text
            assert 'id="root"' in response.text
            assert response.headers["content-type"].startswith("text/html")
        assert client.get("/api/not-a-real-endpoint").status_code == 404
