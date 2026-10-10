"""Hosted MCP adapter. Internal ASGI calls preserve the API's auth/write/checkpoint boundary."""

import hashlib
import json
from collections.abc import Callable
from typing import Any, Literal, cast
from uuid import UUID

import httpx
from advanced_alchemy.extensions.litestar import SQLAlchemyAsyncConfig
from litestar import asgi
from litestar.types import ASGIApp, Receive, Scope, Send
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import Icon, ToolAnnotations
from pydantic import Field

from storytool.config import get_settings
from storytool.domain.ai.commands import ENTITIES, LINKS
from storytool.domain.ai.schemas import Proposal
from storytool.domain.auth.access import _reject
from storytool.domain.auth.oauth import SCOPES, Delegation, delegated_access, issuer
from storytool.domain.story.schemas import StoryCreate

GUIDELINES = {
    "connections": {
        "principle": "Connect cause, choice and consequence; links must have a story purpose.",
        "links": {
            name: {"from": left, "to": right} for name, (_, left, right, _, _) in LINKS.items()
        },
        "example": "A midpoint scene belongs to an Act 2 chapter, fulfills a midpoint beat, "
        "advances the repair A-story and trust B-story, and demonstrates a specific character "
        "arc stage. Link actual people and place. Presence is different from POV.",
    },
    "character_arcs": {
        "principle": "An external want drives choices; a need/misbelief shapes their cost. "
        "Positive, negative and flat arcs are all valid. An arc has exactly one owner.",
        "example": "Maya wants to repair the light alone, but needs shared responsibility. "
        "Stages: refuses help -> accepts one costly concession -> deliberately trusts Eli. "
        "Link stages to scenes showing those choices; being present is not an arc advance.",
        "source": "https://www.helpingwritersbecomeauthors.com/character-arcs-3/",
    },
    "scenes": {
        "principle": "Goal, opposition and consequence create causal momentum. A sequel "
        "can show reaction, dilemma and a decision that creates the next goal.",
        "example": "Maya's repair burns the reserve circuit. She weighs abandoning the "
        "light against surrendering control, then gives Eli the key. Quiet scenes are valid.",
        "schema_note": "Reaction/dilemma/decision go in summary; dedicated fields do not exist.",
        "source": "https://www.helpingwritersbecomeauthors.com/5-questions-about-scene-sequences/",
    },
    "timeline": {
        "principle": "World time is when events occur. Reading order is when scenes reveal "
        "them. Unknown time stays null. Preserve flashbacks and deliberate ambiguity.",
        "example": "The Blue Carbuncle's theft precedes the opening in world time, but its "
        "explanation comes near the ending. Moving the confession does not move the theft.",
        "schema_note": "Events link one scene; multiple reveal links are not implemented.",
    },
    "frameworks": {
        "principle": "Three-act and Save the Cat provide optional structural obligations. "
        "Snowflake-style expansion can develop a premise into people, turns and scenes. "
        "Map experimental structures to custom; guidelines are not technical constraints.",
        "frameworks": ["three_act", "save_the_cat", "custom"],
        "source": "https://www.advancedfictionwriting.com/articles/snowflake-method/",
    },
    "review": {
        "principle": "Separate proven contradictions from editorial judgments. Read fresh "
        "findings and notices, cite affected scenes, respect dismissed feedback, offer "
        "alternatives, and recheck after a repair. Zero warnings does not prove good writing.",
        "example": "An arc jumps from refusal to acceptance: propose a limited concession "
        "in an existing scene, or a flat arc. Explain the thematic tradeoff before editing.",
    },
}


class StageProposal(Proposal):
    """MCP staging always requires a fresh context fingerprint, unlike model generation."""

    base_fingerprint: str = Field(
        min_length=64,
        max_length=64,
        description="Copy the exact base_fingerprint returned by get_story_context for this story.",
    )


TOOL_USAGE = {
    "templates_not_ready_to_submit": True,
    "template_note": "Replace every <...> placeholder with values from fresh tool results. "
    "Examples illustrate the call shape; do not create example characters unless requested.",
    "workflow": [
        "get_connection: check scopes; list_stories: choose an owned story for library access.",
        "Read context once for entity IDs; get_story_fingerprint refreshes only the write guard.",
        "get_entity_schema(entity): use supported fields; check link endpoint types.",
        "stage_story_changes(story_id, proposal): include fingerprint INSIDE proposal.",
        "Inspect the proposal; apply_story_changes(story_id, run_id) only for requested edits.",
        "After applying, use returned real UUIDs and get_story_fingerprint before the next batch.",
    ],
    "reference_rules": [
        "story_id is an existing story UUID, never a title, email, or new: reference.",
        "Existing references use UUIDs from this story's context, never names or invented IDs.",
        "Each create needs a unique ref such as new:maya. Reuse that exact ref in this batch.",
        "A new: reference is local to one proposal. Use the returned real UUID after applying.",
        "Links use data.from_id and data.to_id, not names or chapter_id/beat_id keys.",
        "ref is required on every operation; a link ref labels that operation, not an entity.",
    ],
    "examples": {
        "read_context": {
            "name": "get_story_context",
            "arguments": {"story_id": "<story UUID from list_stories>"},
        },
        "create_connected_draft": {
            "name": "stage_story_changes",
            "arguments": {
                "story_id": "<same story UUID>",
                "proposal": {
                    "summary": "Create a protagonist, chapter, and connected opening scene",
                    "base_fingerprint": "<exact base_fingerprint from get_story_context>",
                    "operations": [
                        {
                            "op": "create",
                            "entity": "character",
                            "ref": "new:maya",
                            "data": {"name": "Maya", "role": "protagonist"},
                        },
                        {
                            "op": "create",
                            "entity": "chapter",
                            "ref": "new:chapter-1",
                            "data": {"number": 1, "title": "The light goes out"},
                        },
                        {
                            "op": "create",
                            "entity": "scene",
                            "ref": "new:opening",
                            "data": {
                                "title": "The failing lantern",
                                "chapter_id": "new:chapter-1",
                                "pov_character_id": "new:maya",
                            },
                        },
                        {
                            "op": "link",
                            "entity": "scene_presence",
                            "ref": "presence:maya",
                            "data": {"from_id": "new:opening", "to_id": "new:maya"},
                        },
                    ],
                },
            },
        },
        "update_existing_character": {
            "name": "stage_story_changes",
            "arguments": {
                "story_id": "<story UUID>",
                "proposal": {
                    "summary": "Clarify the protagonist's external goal",
                    "base_fingerprint": "<fresh context fingerprint>",
                    "operations": [
                        {
                            "op": "update",
                            "entity": "character",
                            "ref": "<character UUID from this story's context>",
                            "data": {"want": "Repair the island's last lantern"},
                        }
                    ],
                },
            },
        },
        "apply_reviewed_proposal": {
            "name": "apply_story_changes",
            "arguments": {"story_id": "<same story UUID>", "run_id": "<id returned by staging>"},
        },
    },
    "error_recovery": {
        "missing_fingerprint": "Read context and set proposal.base_fingerprint. Do not invent it.",
        "invalid_reference": "Use context UUIDs or declare matching new: creates in this proposal.",
        "stale_context_409": "Read fresh context, reconcile author edits, rebuild and stage again.",
        "permission_denied": "Reconnect and authorize edits; never try a different user's story.",
        "server_or_transport_error": "Inspect proposals and fresh context before retrying.",
        "isError": "Read the error message and correct the call; tool errors keep MCP available.",
    },
}

INSTRUCTIONS = """StoryTool is an author's story graph and writing workspace.
First get_connection and read the selected story. Its permission scopes govern access
to the selected story or the explicitly authorized account library. Never request provider keys.
For library access, list_stories first, then pass story_id to other tools. create_story saves a
new owned story with an initial version. Respect read-only, creation and prose permissions.
Use schemas, real IDs and typed new: references. Read guidelines and findings before repairs.
Use get_story_fingerprint to refresh the guard when context is already known.
Read get_tool_usage before your first staging call; it supplies the exact argument structure.
stage_story_changes takes {story_id, proposal}; proposal contains summary, base_fingerprint,
and operations. Never omit the fingerprint or substitute names for IDs. Use data.from_id and
data.to_id for link operations. A new: reference must be declared by a create in this same batch.
Respect plotter/pantser/hybrid mode, author canon and dismissed notices. Placeholders are valid.
Story.blurb is the reader-facing pitch; premise is the working story idea. Keep them separate.
Chapter.epigraph is an opening quote; opening_note and closing_note are reader-facing flavour
text before and after the chapter prose. Keep them separate from the planning summary.
Use glossary_entry for terminology: term, aliases, definition and first_explained_scene_id.
Query it with query_story_entities, get its schema, then stage create/update/delete operations.
Explanation scene references must belong to this story. Do not invent explanations in prose.
For ordered entities, set sort_key explicitly. Append with the highest existing key plus 100;
do not use the item count as an order key. Keep chapter numbers consistent with the outline.
World time and reading order are independent. Editorial judgments need evidence and alternatives.
Stage changes with the base_fingerprint from your context read, inspect the proposal, and apply
only work the author requested. Prose changes use write_prose and expected_content_hash.
Never claim a proposal was applied until apply returns applied. Stale plans must be rebuilt.
Undo refuses later edits. Version restore replaces the whole draft: preview, get explicit author
authorization, then use its exact fingerprint; a recovery checkpoint preserves the previous draft.
No tool calls a billable LLM or runs shell/database commands. The connected client writes/reasons.
"""


def build_mcp(db_config: SQLAlchemyAsyncConfig, get_app: Callable[[], ASGIApp]) -> tuple[Any, Any]:
    server = MCPServer(
        "StoryTool",
        instructions=INSTRUCTIONS,
        version="1.1.1",
        website_url=issuer(),
        icons=[
            Icon(
                src=issuer() + "/branding/storytool-icon.png",
                mime_type="image/png",
                sizes=["512x512"],
            )
        ],
    )

    async def principal(headers: Any) -> Delegation | None:
        authorization = headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            return None
        async with db_config.get_session() as db:
            return await delegated_access(db, authorization[7:])

    async def call(
        ctx: Context,
        suffix: str,
        method: str = "GET",
        body: Any = None,
        story_id: UUID | None = None,
        collection: bool = False,
    ) -> Any:
        headers = ctx.headers or {}
        grant = await principal(headers)
        if grant is None:
            raise ToolError("Authentication expired or revoked. Reconnect or sign in again.")
        identifier = story_id or grant.story_id
        if not collection and identifier is None:
            raise ToolError("Choose a story ID from list_stories and pass story_id to this tool")
        target = "/api/stories" + suffix if collection else f"/api/stories/{identifier}{suffix}"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=cast(Any, get_app()), raise_app_exceptions=False),
            base_url="http://storytool.internal",
            headers={"Authorization": headers["authorization"]},
            timeout=120,
        ) as client:
            try:
                response = await client.request(method, target, json=body)
            except httpx.TransportError:
                raise ToolError(
                    "The app request could not complete. Retry reads; before retrying a write, "
                    "inspect_story_proposals and read fresh story context to check its status."
                ) from None
        if not response.is_success:
            if response.status_code >= 500:
                raise ToolError(
                    f"StoryTool {response.status_code}: the app could not complete this request. "
                    "Inspect existing proposals and read fresh context before retrying a write."
                )
            try:
                detail = response.json().get("detail", "Request rejected")
            except (ValueError, AttributeError):
                detail = "Request rejected. Read fresh story context and check your permissions."
            raise ToolError(f"StoryTool {response.status_code}: {detail}")
        return response.json() if response.content else {}

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_connection(ctx: Context) -> dict[str, Any]:
        """Discover your selected-story or account-library access and permission scopes."""
        grant = await principal(ctx.headers or {})
        if grant is None:
            raise ToolError("Story token required")
        return {
            "story_id": str(grant.story_id) if grant.story_id else None,
            "library_access": "library:read" in grant.scopes,
            "can_create_stories": "story:create" in grant.scopes,
            "access_mode": "library" if grant.story_id is None else "story",
            "expires_at": grant.expires_at.isoformat(),
            "permissions": grant.scopes,
            "transport": "Streamable HTTP",
            "auth": "OAuth" if grant.oauth else "story-scoped bearer token",
            "oauth_supported": True,
            "fork_supported": False,
            "call_guide": "get_tool_usage",
            "limits": {"operations": 200, "prose_characters": 200000},
        }

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    def get_tool_usage() -> dict[str, Any]:
        """Read exact MCP call templates and ID/fingerprint rules before staging any edits."""
        return TOOL_USAGE

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def list_stories(
        ctx: Context, offset: int = 0, limit: int = 50, include_trashed: bool = False
    ) -> dict[str, Any]:
        """Fetch this account's active stories with explicit library permission; never other users.
        Story-bound tokens return only their selected story. Pick an ID for story-specific tools.
        """
        if offset < 0 or not 1 <= limit <= 100:
            raise ToolError("Invalid pagination")
        grant = await principal(ctx.headers or {})
        if grant is None:
            raise ToolError("Connection expired")
        if "library:read" in grant.scopes:
            rows = await call(ctx, "", collection=True)
            if include_trashed:
                rows += await call(ctx, "?trashed=true", collection=True)
        else:
            rows = [await call(ctx, "")]
        rows = sorted(rows, key=lambda row: row["id"])
        return {
            "stories": rows[offset : offset + limit],
            "total": len(rows),
            "next_offset": offset + limit if offset + limit < len(rows) else None,
            "scope": "your library" if "library:read" in grant.scopes else "selected story",
        }

    @server.tool()
    async def create_story(ctx: Context, story: StoryCreate) -> dict[str, Any]:
        """Create a story owned by the connected account and save its initial whole-story version.
        Requires story:create permission. Only a title is required; returns the ID to use next.
        """
        grant = await principal(ctx.headers or {})
        if grant is None or "story:create" not in grant.scopes:
            raise ToolError("Reconnect and authorize story creation in the consent screen")
        return await call(ctx, "", "POST", story.model_dump(mode="json"), collection=True)

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_story_context(
        ctx: Context, include_prose: bool = False, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Read graph, schemas, base fingerprint, health/continuity and fresh observations.
        Prose excerpts are opt-in and bounded; use read_scene_prose for complete scene text.
        """
        return await call(
            ctx, f"/ai/context?include_prose={str(include_prose).lower()}", story_id=story_id
        )

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_story_fingerprint(ctx: Context, story_id: UUID | None = None) -> dict[str, Any]:
        """Fetch only the current write guard; skips health, continuity and observations.
        Use before a write when you already have the entity IDs and story context.
        """
        return await call(ctx, "/ai/fingerprint", story_id=story_id)

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_entity_schema(entity: str) -> dict[str, Any]:
        """Exact create/update fields and reference kinds. No World/Theme/lore models yet."""
        if entity not in ENTITIES:
            raise ToolError("Choose: " + ", ".join(ENTITIES))
        _, create, update = ENTITIES[entity]
        result = {
            "entity": entity,
            "create": create.model_json_schema() if create else None,
            "update": update.model_json_schema(),
        }
        if entity == "arc_stage":
            result["proposal_note"] = "Creates additionally need arc_id: UUID or new:arc reference"
        if entity == "scene":
            result["prose_operation"] = {
                "op": "write_prose",
                "entity": "scene",
                "ref": "owned UUID or new:scene",
                "data": {
                    "content": "complete replacement text",
                    "expected_content_hash": "SHA256 from read_scene_prose",
                },
                "note": "Full-scene replacement, not a partial chunk patch",
            }
        result["reference_note"] = "Use owned UUIDs or new: references; ownership is set by server"
        if "sort_key" in update.model_fields:
            result["ordering_note"] = (
                "sort_key determines order. Append with max(existing sort_key) + 100, "
                "not item count. Chapter numbers break ties; UUIDs break remaining ties."
            )
        return result

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_arc_trace(
        ctx: Context, arc_id: UUID, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Read a character/relationship/thread arc's ordered stages and evidence scenes."""
        context = await call(ctx, "/ai/context?include_prose=false", story_id=story_id)
        entities = context["entities"]
        arc = next((r for r in entities["arc"] if r["id"] == str(arc_id)), None)
        if arc is None:
            raise ToolError("Arc not found in selected story")
        stages = sorted(
            [r for r in entities["arc_stage"] if r["arc_id"] == str(arc_id)],
            key=lambda r: (r["sort_key"], r["id"]),
        )
        trace = []
        for stage in stages:
            linked_ids = {
                r["scene_id"]
                for r in entities["scene_arc_advance"]
                if r["arc_stage_id"] == stage["id"]
            }
            trace.append(
                {"stage": stage, "scenes": [s for s in entities["scene"] if s["id"] in linked_ids]}
            )
        return {"arc": arc, "trace": trace, "base_fingerprint": context["base_fingerprint"]}

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def query_story_entities(
        ctx: Context,
        entity: str,
        offset: int = 0,
        limit: int = 50,
        search: str | None = None,
        story_id: UUID | None = None,
    ) -> dict[str, Any]:
        """Browse/search one entity kind or link kind without prose. Returns bounded pages."""
        if entity not in ENTITIES and entity not in LINKS:
            raise ToolError("Unknown entity or link kind")
        if not 0 <= offset <= 100000 or not 1 <= limit <= 100:
            raise ToolError("offset must be nonnegative and limit between 1 and 100")
        context = await call(ctx, "/ai/context?include_prose=false", story_id=story_id)
        rows = context["entities"][entity]
        if search:
            rows = [row for row in rows if search.casefold() in json.dumps(row).casefold()]
        return {
            "story_id": context["story_id"],
            "base_fingerprint": context["base_fingerprint"],
            "items": rows[offset : offset + limit],
            "total": len(rows),
            "next_offset": offset + limit if offset + limit < len(rows) else None,
            "prose_included": False,
        }

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def read_scene_prose(
        ctx: Context,
        scene_id: UUID,
        offset: int = 0,
        limit: int = 8000,
        story_id: UUID | None = None,
    ) -> dict[str, Any]:
        """Read full scene prose in chunks and get the hash required for staged editing."""
        if offset < 0 or not 1 <= limit <= 24000:
            raise ToolError("offset must be nonnegative; limit 1..24000")
        result = await call(ctx, f"/scenes/{scene_id}/content", story_id=story_id)
        content = result.get("content") or ""
        return {
            "scene_id": str(scene_id),
            "content": content[offset : offset + limit],
            "content_hash": hashlib.sha256(content.encode()).hexdigest(),
            "word_count": result["word_count"],
            "total_characters": len(content),
            "next_offset": offset + limit if offset + limit < len(content) else None,
        }

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_scene_context(
        ctx: Context, scene_id: UUID, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Scene purpose, POV, place, linked beats/threads/arc stages and computed chapter brief."""
        context = await call(ctx, "/ai/context?include_prose=false", story_id=story_id)
        entities = context["entities"]
        scene = next((row for row in entities["scene"] if row["id"] == str(scene_id)), None)
        if scene is None:
            raise ToolError("Scene not found in selected story")
        result = {
            "scene": scene,
            "base_fingerprint": context["base_fingerprint"],
            "links": {
                kind: [r for r in entities[kind] if r.get("scene_id") == str(scene_id)]
                for kind in ("scene_beat", "scene_thread", "scene_arc_advance", "scene_presence")
            },
        }
        result["related"] = {
            "pov_character": next(
                (r for r in entities["character"] if r["id"] == scene.get("pov_character_id")), None
            ),
            "location": next(
                (r for r in entities["location"] if r["id"] == scene.get("location_id")), None
            ),
            "beats": [
                r
                for r in entities["beat"]
                if any(link["beat_id"] == r["id"] for link in result["links"]["scene_beat"])
            ],
            "threads": [
                r
                for r in entities["thread"]
                if any(link["thread_id"] == r["id"] for link in result["links"]["scene_thread"])
            ],
            "arc_stages": [
                r
                for r in entities["arc_stage"]
                if any(
                    link["arc_stage_id"] == r["id"] for link in result["links"]["scene_arc_advance"]
                )
            ],
        }
        if scene.get("chapter_id"):
            result["chapter_brief"] = await call(
                ctx, f"/chapters/{scene['chapter_id']}/brief", story_id=story_id
            )
        siblings = sorted(
            [s for s in entities["scene"] if s.get("chapter_id") == scene.get("chapter_id")],
            key=lambda s: (s["sort_key"], s["id"]),
        )
        position = next(i for i, s in enumerate(siblings) if s["id"] == scene["id"])
        result["previous_scene"] = siblings[position - 1] if position > 0 else None
        result["next_scene"] = siblings[position + 1] if position + 1 < len(siblings) else None
        return result

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def read_scene_notes(
        ctx: Context, scene_id: UUID, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Read author annotations and confirmed/rejected/inferred character mentions."""
        return {
            "scene_id": str(scene_id),
            "annotations": await call(ctx, f"/scenes/{scene_id}/annotations", story_id=story_id),
            "mentions": await call(ctx, f"/scenes/{scene_id}/mentions", story_id=story_id),
        }

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_story_timeline(ctx: Context, story_id: UUID | None = None) -> dict[str, Any]:
        """Global timeline with people/places, on/off-page events and world vs reading order."""
        return await call(ctx, "/timeline", story_id=story_id)

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_story_glossary(ctx: Context, story_id: UUID | None = None) -> dict[str, Any]:
        """Read terms, aliases, definitions and first-explanation scene links.

        To edit, get_entity_schema('glossary_entry'), stage typed operations and apply.
        This does not judge whether prose has explained a term adequately.
        """
        return {"entries": await call(ctx, "/glossary", story_id=story_id)}

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_story_findings(
        ctx: Context, include_dismissed: bool = False, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Read health issues, readiness, continuity, fresh reader observations and notices.
        This reads stored evidence and deterministic checks, never calls a paid reader.
        """
        context = await call(ctx, "/ai/context?include_prose=false", story_id=story_id)
        suggestions = await call(ctx, "/suggestions?include_dismissed=true", story_id=story_id)
        return {
            "base_fingerprint": context["base_fingerprint"],
            "health": context["health"],
            "continuity": context["continuity"],
            "observations": context["observations"],
            "dismissed_feedback": context["dismissed_feedback"],
            "character_mentions": context["entities"]["scene_presence"],
            "notices": [s for s in suggestions if include_dismissed or not s["is_dismissed"]],
            "readiness": await call(ctx, "/ladder", story_id=story_id),
            "note": "Editorial guesses are distinct from proved graph contradictions.",
            "observations_fresh_only": True,
        }

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def get_writing_guidelines(topic: str = "all") -> dict[str, Any]:
        """Original connected-story examples and optional craft guidance; not enforced formulas."""
        if topic == "all":
            return GUIDELINES
        if topic not in GUIDELINES:
            raise ToolError("Choose all or " + ", ".join(GUIDELINES))
        return {topic: GUIDELINES[topic]}

    @server.tool()
    async def stage_story_changes(
        ctx: Context, proposal: StageProposal, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Validate/stage creates, updates, links, unlinks, deletes and hash-guarded write_prose.
        Use get_story_fingerprint for a fresh base_fingerprint if context is already known.
        Delete uses an owned UUID, empty data, and requires reviewing destructive impact.
        No edits happen until apply; deletion creates a recovery version.
        Arguments are {story_id, proposal: {summary, base_fingerprint, operations}}.
        Read get_tool_usage for examples. Names are not UUIDs; new: refs need matching creates.
        """
        if not proposal.base_fingerprint:
            raise ToolError(
                "Call get_story_context for this story, then put its base_fingerprint "
                "inside proposal.base_fingerprint and retry stage_story_changes. "
                "No proposal was staged."
            )
        return await call(
            ctx, "/ai/stage", "POST", proposal.model_dump(mode="json"), story_id=story_id
        )

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def inspect_story_proposals(ctx: Context, story_id: UUID | None = None) -> dict[str, Any]:
        """Read recent staged/applied/undone plans and their text replies for review."""
        return {"runs": await call(ctx, "/ai/runs", story_id=story_id)}

    @server.tool()
    async def apply_story_changes(
        ctx: Context, run_id: UUID, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Apply only an author-authorized staged plan. Atomic, stale guarded and retry-safe."""
        return await call(ctx, f"/ai/runs/{run_id}/apply", "POST", {}, story_id=story_id)

    @server.tool()
    async def undo_story_changes(
        ctx: Context, run_id: UUID, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Undo an applied plan only when later author edits will not be overwritten."""
        return await call(ctx, f"/ai/runs/{run_id}/undo", "POST", {}, story_id=story_id)

    @server.tool()
    async def dismiss_story_changes(
        ctx: Context, run_id: UUID, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Dismiss a pending proposal without changing the story graph."""
        return await call(ctx, f"/ai/runs/{run_id}/dismiss", "POST", {}, story_id=story_id)

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def list_story_versions(ctx: Context, story_id: UUID | None = None) -> dict[str, Any]:
        """Read whole-story checkpoint metadata; no full snapshot/prose payloads."""
        return {"versions": await call(ctx, "/versions", story_id=story_id)}

    @server.tool()
    async def create_story_version(
        ctx: Context, label: str, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Save a named whole-story checkpoint before a rewrite."""
        if not label.strip() or len(label) > 200:
            raise ToolError("Version label must contain 1..200 characters")
        return await call(ctx, "/versions", "POST", {"label": label}, story_id=story_id)

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def read_story_version(
        ctx: Context,
        version_id: UUID,
        entity: str = "story",
        include_prose: bool = False,
        offset: int = 0,
        limit: int = 50,
        story_id: UUID | None = None,
    ) -> dict[str, Any]:
        """Read a saved entity/link page. Old state is context, not the writable current draft."""
        if offset < 0 or not 1 <= limit <= 100:
            raise ToolError("Invalid pagination")
        result = await call(
            ctx,
            f"/versions/{version_id}?include_prose={str(include_prose).lower()}",
            story_id=story_id,
        )
        if entity not in result["state"]:
            raise ToolError("Unknown snapshot entity kind")
        rows = result["state"][entity]
        return {
            "version": result["version"],
            "items": rows[offset : offset + limit],
            "next_offset": offset + limit if offset + limit < len(rows) else None,
            "source": "immutable version",
            "prose_included": include_prose,
        }

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def preview_version_restore(
        ctx: Context, version_id: UUID, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Compare saved state with current draft before any whole-story restore."""
        return await call(ctx, f"/versions/{version_id}/preview", story_id=story_id)

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False))
    async def compare_story_versions(
        ctx: Context,
        from_version_id: UUID,
        to_version_id: UUID,
        include_prose: bool = False,
        story_id: UUID | None = None,
    ) -> dict[str, Any]:
        """Compare two immutable story versions; explain what changed without restoring."""
        from storytool.domain.versioning.service import changes

        suffix = f"?include_prose={str(include_prose).lower()}"
        before = await call(ctx, f"/versions/{from_version_id}{suffix}", story_id=story_id)
        after = await call(ctx, f"/versions/{to_version_id}{suffix}", story_id=story_id)
        items, count = changes(before["state"], after["state"])
        return {
            "from_version": before["version"],
            "to_version": after["version"],
            "changes": items,
            "change_count": count,
            "prose_included": include_prose,
        }

    @server.tool()
    async def restore_story_version(
        ctx: Context, version_id: UUID, expected_fingerprint: str, story_id: UUID | None = None
    ) -> dict[str, Any]:
        """Restore only after author authorization and preview. Preserves a recovery version.
        This replaces prose, structure, arcs, timeline, notes and links together.
        """
        return await call(
            ctx,
            f"/versions/{version_id}/restore",
            "POST",
            {"expected_fingerprint": expected_fingerprint},
            story_id=story_id,
        )

    @server.resource("storytool://guidelines")
    def writing_guidelines_resource() -> str:
        return json.dumps(GUIDELINES)

    @server.resource("storytool://tool-usage")
    def tool_usage_resource() -> str:
        return json.dumps(TOOL_USAGE)

    @server.prompt()
    def writing_workflow(
        task: Literal["outline", "draft", "review", "timeline"] = "outline",
    ) -> str:
        """A reusable author-controlled writing workflow with tool sequence and quality checks."""
        return (
            f"Task: {task}. "
            + INSTRUCTIONS
            + (
                "Read writing guidelines and current findings. Clarify pivotal missing decisions. "
                "Use causal turns, choices/costs in arcs and consistent world/reveal order. "
                "Show alternatives and preserve the author's voice. Stage a focused batch, inspect "
                "its impact, apply only requested changes, and read findings again."
            )
        )

    # SDK 2.3 high-level wrapper drops host/security arguments; use its low-level factory.
    # Our authenticated mount validates Origin before the transport accepts the request.
    http_app = server._lowlevel_server.streamable_http_app(
        streamable_http_path="/", stateless_http=True, json_response=True, host="0.0.0.0"
    )

    @asgi("/mcp", is_mount=True, copy_scope=True)
    async def endpoint(scope: Scope, receive: Receive, send: Send) -> None:
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        origin = headers.get("origin")
        if origin:
            from urllib.parse import urlsplit

            if (
                urlsplit(origin).netloc.lower() != headers.get("host", "").lower()
                and origin not in get_settings().mcp_allowed_origins
            ):
                await _reject(send, 403, "Invalid MCP origin")
                return
        if await principal(headers) is None:
            from storytool.oauth_routes import json_response

            challenge = (
                f'Bearer resource_metadata="{issuer()}/.well-known/oauth-protected-resource/mcp", '
                f'scope="{" ".join(SCOPES)}"'
            )
            await json_response(
                send, 401, {"error": "invalid_token"}, [(b"www-authenticate", challenge.encode())]
            )
            return
        await http_app(cast(Any, scope), cast(Any, receive), cast(Any, send))

    return endpoint, http_app.router.lifespan_context
