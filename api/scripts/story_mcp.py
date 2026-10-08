"""Local MCP bridge for Claude/Codex, authenticated with a story-scoped app token.

Set STORYTOOL_AGENT_TOKEN in the local client environment. Never put keys in prompts.
Run: uv --directory D:/learning/StoryTool/api run python scripts/story_mcp.py
"""

import os
from typing import Any
from uuid import UUID

import httpx
from mcp.server.mcpserver import MCPServer

from storytool.domain.ai.schemas import Proposal

selected_story_id = (
    UUID(os.environ["STORYTOOL_STORY_ID"]) if os.environ.get("STORYTOOL_STORY_ID") else None
)

mcp = MCPServer(
    "StoryTool",
    instructions=(
        "Use get_story_context before editing. World time and reading order are independent. "
        "Stage typed proposals using new: refs for creates, then apply only the changes the user "
        "has requested. Do not run shell commands or manipulate the database. Undo refuses "
        "to overwrite subsequent manual edits. The app token is bound to one story. "
        + (f"Selected story ID: {selected_story_id}." if selected_story_id else "")
    ),
)


async def call(story_id: UUID, suffix: str, body: dict[str, Any] | None = None) -> Any:
    token = os.environ.get("STORYTOOL_AGENT_TOKEN")
    if not token:
        raise RuntimeError(
            "Create an agent token in StoryTool Settings and set STORYTOOL_AGENT_TOKEN locally"
        )
    base = os.environ.get("STORYTOOL_BASE_URL", "http://localhost:8000")
    async with httpx.AsyncClient(
        base_url=base, timeout=120, headers={"Authorization": f"Bearer {token}"}
    ) as client:
        path = f"/api/stories/{story_id}/ai/{suffix}"
        response = await (client.get(path) if body is None else client.post(path, json=body))
        if not response.is_success:
            raise RuntimeError(f"StoryTool returned {response.status_code}: {response.text}")
        return response.json()


@mcp.tool()
async def get_story_context(
    story_id: UUID | None = None, include_prose: bool = False
) -> dict[str, Any]:
    """Read the owned story, schemas, timeline fields, health and fresh Jev observations."""
    identifier = story_id or selected_story_id
    if identifier is None:
        raise RuntimeError("Supply the story UUID from its URL, or configure STORYTOOL_STORY_ID.")
    return await call(identifier, "context?include_prose=" + str(include_prose).lower())


@mcp.tool()
async def stage_story_changes(story_id: UUID, proposal: Proposal) -> dict[str, Any]:
    """Validate structured changes for review, without applying them."""
    return await call(story_id, "stage", proposal.model_dump(mode="json"))


@mcp.tool()
async def apply_story_changes(story_id: UUID, run_id: UUID) -> dict[str, Any]:
    """Apply an authorized staged proposal once, atomically; refuses stale proposals."""
    return await call(story_id, f"runs/{run_id}/apply", {})


@mcp.tool()
async def undo_story_changes(story_id: UUID, run_id: UUID) -> dict[str, Any]:
    """Undo a batch only when no subsequent story edit would be overwritten."""
    return await call(story_id, f"runs/{run_id}/undo", {})


if __name__ == "__main__":
    mcp.run(transport="stdio")
