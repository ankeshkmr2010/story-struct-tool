"""Mount the SDK's standard OAuth endpoints and public discovery documents."""

import base64
import binascii
import json
from typing import Any, cast
from urllib.parse import parse_qs, unquote, urlencode

from advanced_alchemy.extensions.litestar import SQLAlchemyAsyncConfig
from litestar import asgi
from litestar.handlers import ASGIRouteHandler
from litestar.types import Receive, Scope, Send
from mcp.server.auth.routes import create_auth_routes
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from pydantic import AnyHttpUrl, ConfigDict, TypeAdapter
from starlette.applications import Starlette

from storytool.domain.auth.oauth import SCOPES, OAuthProvider, issuer, resource


def oauth_routes(config: SQLAlchemyAsyncConfig) -> list[ASGIRouteHandler]:
    sdk_app = Starlette(
        routes=create_auth_routes(
            OAuthProvider(config),
            TypeAdapter(
                AnyHttpUrl, config=ConfigDict(url_preserve_empty_path=True)
            ).validate_python(issuer()),
            client_registration_options=ClientRegistrationOptions(
                enabled=True,
                valid_scopes=SCOPES,
                default_scopes=SCOPES,
            ),
            revocation_options=RevocationOptions(enabled=True),
        )
    )

    @asgi(
        ["/.well-known/oauth-authorization-server", "/authorize", "/token", "/register", "/revoke"],
        copy_scope=True,
    )
    async def auth(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return
        if scope["path"] in {"/token", "/revoke"} and scope.get("method") == "POST":
            messages = []
            body = b""
            while True:
                message = await receive()
                if message["type"] != "http.request":
                    return
                messages.append(message)
                body += message.get("body", b"")
                if len(body) > 65536:
                    await json_response(send, 413, {"error": "invalid_request"})
                    return
                if not message.get("more_body", False):
                    break
            try:
                fields = parse_qs(body.decode(), keep_blank_values=True)
            except UnicodeDecodeError:
                await json_response(send, 400, {"error": "invalid_request"})
                return
            targets = fields.get("resource", [])
            if scope["path"] == "/token" and targets and targets != [resource()]:
                await json_response(send, 400, {"error": "invalid_target"})
                return
            # SDK 2.3 requires client_id in the form even for HTTP Basic, and a secret field
            # for public-client revocation. Normalize these valid OAuth wire forms; its
            # authenticator still checks the registered method and actual credentials.
            headers = dict(scope.get("headers", []))
            authorization = headers.get(b"authorization", b"").decode()
            if "client_id" not in fields and authorization.startswith("Basic "):
                try:
                    decoded = base64.b64decode(authorization[6:], validate=True).decode()
                    identifier, _ = decoded.split(":", 1)
                    fields["client_id"] = [unquote(identifier)]
                except (ValueError, UnicodeDecodeError, binascii.Error):
                    await json_response(send, 400, {"error": "invalid_client"})
                    return
            if scope["path"] == "/revoke":
                fields.setdefault("client_secret", [""])
            body = urlencode(fields, doseq=True).encode()
            messages = [{"type": "http.request", "body": body, "more_body": False}]
            scope["headers"] = [
                (key, value)
                for key, value in scope.get("headers", [])
                if key.lower() != b"content-length"
            ] + [(b"content-length", str(len(body)).encode())]

            async def replay() -> Any:
                return messages.pop(0) if messages else await receive()

            await sdk_app(cast(Any, scope), replay, cast(Any, send))
        else:
            await sdk_app(cast(Any, scope), cast(Any, receive), cast(Any, send))

    @asgi(
        ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
        copy_scope=True,
    )
    async def metadata(scope: Scope, receive: Receive, send: Send) -> None:
        await json_response(
            send,
            200,
            {
                "resource": resource(),
                "authorization_servers": [issuer()],
                "scopes_supported": SCOPES,
                "bearer_methods_supported": ["header"],
            },
            [
                (b"access-control-allow-origin", b"*"),
                (b"access-control-allow-methods", b"GET, OPTIONS"),
            ],
        )

    return [auth, metadata]


async def json_response(send: Send, status: int, data: dict, headers: list | None = None) -> None:
    body = json.dumps(data).encode()
    await send(
        cast(
            Any,
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"cache-control", b"no-store"),
                    *(headers or []),
                ],
            },
        )
    )
    await send(cast(Any, {"type": "http.response.body", "body": body}))
