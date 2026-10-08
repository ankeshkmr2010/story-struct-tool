"""Full hosted tool/resource/prompt catalog over stdio for local AI clients.

Credentials come only from STORYTOOL_AGENT_TOKEN; configure STORYTOOL_BASE_URL.
The SDK owns stdio framing and discovery. The HTTP endpoint owns all authoring behavior.
"""

import asyncio
import os
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp_types import (
    CallToolRequestParams,
    CallToolResult,
    GetPromptRequestParams,
    GetPromptResult,
    ListPromptsResult,
    ListResourcesResult,
    ListToolsResult,
    PaginatedRequestParams,
    ReadResourceRequestParams,
    ReadResourceResult,
)

RESULTS = {
    "tools/list": ListToolsResult,
    "tools/call": CallToolResult,
    "resources/list": ListResourcesResult,
    "resources/read": ReadResourceResult,
    "prompts/list": ListPromptsResult,
    "prompts/get": GetPromptResult,
}


def create_proxy(base_url: str, token: str) -> Server:
    proxy = Server(
        "StoryTool",
        version="1.0.0",
        instructions=(
            "Read get_connection and get_story_context before editing. Read writing guidelines "
            "and findings; stage changes for author review. Apply only requested work. "
            "Preview and ask before a whole-story restore. The token permits one story only."
        ),
    )

    def handler(method: str):
        async def forward(ctx: Any, params: Any) -> Any:
            # Use the server's tested legacy HTTP profile; SDK stdio serves both protocol eras.
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(
                    base_url.rstrip("/") + "/mcp",
                    headers={
                        "Authorization": "Bearer " + token,
                        "Accept": "application/json, text/event-stream",
                        "MCP-Protocol-Version": "2025-11-25",
                    },
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": method,
                        "params": params.model_dump(
                            mode="json", by_alias=True, exclude_none=True, exclude={"meta"}
                        ),
                    },
                )
            if not response.is_success:
                raise ValueError(
                    f"StoryTool connection returned {response.status_code}. "
                    "Check the server URL and token, or retry after it wakes."
                )
            payload = response.json()
            if "error" in payload:
                raise ValueError("StoryTool rejected the MCP request")
            # SDK result models fill era-specific cache/result fields before stdio serialization.
            return RESULTS[method].model_validate(payload["result"])

        return forward

    for method, params_type in (
        ("tools/list", PaginatedRequestParams),
        ("tools/call", CallToolRequestParams),
        ("resources/list", PaginatedRequestParams),
        ("resources/read", ReadResourceRequestParams),
        ("prompts/list", PaginatedRequestParams),
        ("prompts/get", GetPromptRequestParams),
    ):
        proxy.add_request_handler(method, params_type, handler(method))
    return proxy


async def main() -> None:
    token = os.environ.get("STORYTOOL_AGENT_TOKEN")
    if not token:
        raise RuntimeError("Set STORYTOOL_AGENT_TOKEN from StoryTool Settings")
    proxy = create_proxy(
        os.environ.get("STORYTOOL_BASE_URL", "https://storytool.onrender.com"), token
    )
    async with stdio_server() as (incoming, outgoing):
        await proxy.run(incoming, outgoing, proxy.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
