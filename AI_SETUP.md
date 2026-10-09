# StoryTool AI setup

## Hosted MCP server

The MCP server is part of the same StoryTool backend, at:

`https://storytool.onrender.com/mcp`

For local development use `http://localhost:8000/mcp`. Transport is Streamable HTTP.
The server supports standard OAuth authorization code with PKCE and dynamic client registration,
plus the existing manual story-scoped tokens.
It supports both the 2025-11-25 and 2026-07-28 protocol profiles through the official SDK.

1. Sign in to StoryTool and open **Settings -> Connect an AI client · MCP**.
2. Choose a story and create an agent token. It expires after seven days; revoke it in Settings.
3. In a client supporting custom bearer headers, add the MCP URL and set the Authorization
   header to `Bearer <your-story-token>`. Enter the actual token locally, never in a prompt.
4. Ask the client to call `get_connection`, then `get_story_context`, `get_writing_guidelines`
   and `get_story_findings`. It will discover entity schemas, links and current IDs.
5. Request a focused outline or draft. Review its staged proposal before applying.

The token authorizes reading/editing the chosen story, including prose and whole-story
version history/restores. It cannot access other stories, provider credentials or account
settings, and cannot run in-app billable generation. There are no granular read-only token
presets in this release. Grant access only to clients you intend to let edit this story.
The external AI client supplies its own model and usage billing; MCP does not run a model.

### Fetch your library and create stories

OAuth connections can now choose **All my stories, including new stories** during consent.
Enable **Create new stories in my account** to allow the `create_story` tool, and enable
**Propose and apply edits** to populate the new story afterward. Existing story-bound tokens
and grants keep their original limits; reconnect to authorize the wider library permissions.

`list_stories` returns your owned stories with pagination; `include_trashed=true` also lists
Trash metadata. `create_story` accepts the StoryCreate fields and returns an owned story with
an initial version. For a library connection, pass the returned `story_id` to context,
entity, prose, proposal, timeline, and version tools. No shared server-side story selection
is used, so parallel agents cannot accidentally switch each other's target.

Example request: "List my stories. Create a new hybrid mystery called The Missing Hour.
Use its returned ID to build a connected outline, and stage the changes for my review."

Tools cover context, exact schemas, paginated/searchable graph entities and links, arc
tracing, global timeline, health/continuity/readiness, notices and fresh stored reader
observations, scene annotations/mentions, prose chunks, writing guidelines, proposals and apply/dismiss/undo, version
listing/reading/creation/comparison, restore preview and recovery-protected restore.
One guidelines resource and a reusable outline/draft/review/timeline prompt are provided.

Entity and relationship fields reflect the current app. Separate world-rule/lore/theme
models, multi-scene event revelations and version forks remain in the roadmap.
No tool silently calls a paid reader. Reading notices does not generate new observations.
Context reads are currently graph-based; output pages are bounded, but novel-scale database
projection/search optimizations are still future work.

### Clients that need a local stdio connection

The full remote catalog can also be exposed by the local SDK bridge:

```powershell
$env:STORYTOOL_AGENT_TOKEN = 'paste-your-story-token-locally'
$env:STORYTOOL_BASE_URL = 'https://storytool.onrender.com'
uv --directory D:/learning/StoryTool/api run python scripts/story_mcp_remote.py
```

Register that command in your client's local MCP configuration and forward the two
environment variable names. Use your own checkout path. Keep raw tokens outside repository
configuration and prompts. The original `story_mcp.py` remains compatible, with its older
four-tool catalog; `story_mcp_remote.py` forwards the full hosted tool/resource/prompt catalog.

OAuth clients use the same URL, discover authorization metadata, and open a StoryTool consent
screen. Sign in with Google, select one story and choose permissions. Read-only is the default;
enable edits to let the client stage/apply changes. Prose and whole-story restore have separate
permissions. Access tokens last one hour, refresh tokens rotate, and consent lasts at most
30 days. Revoke any connection in Settings -> OAuth connections.

For Gemini on a phone, open gemini.google.com in the browser -> Settings -> Connected Apps ->
Custom apps -> Add a custom app. Enter the MCP URL and complete StoryTool consent. Once linked,
the connector can be used in the mobile app. Google controls availability by region/account.
No manual token or new model key is needed for this OAuth flow. The server's protocol flow is
tested; completion inside a user's Gemini account must be confirmed by that user.

Local OAuth testing requires STORYTOOL_PUBLIC_URL=http://localhost:8000. Production's default
issuer is https://storytool.onrender.com. For a different hostname configure STORYTOOL_PUBLIC_URL
to its HTTPS origin, keeping issuer/resource metadata and callbacks consistent. Custom MCP
browser origins can be configured with STORYTOOL_MCP_ALLOWED_ORIGINS; Gemini is explicitly allowed.
The free Render server may need about a minute to wake after being idle; a startup timeout
is different from a rejected token.

### Outline and prose example

Before the first edit, ask the connected client to call `get_tool_usage`. It supplies
exact argument templates, ID rules, and error recovery. The same guide is available as
`storytool://tool-usage`. A staging call has the shape
`stage_story_changes({story_id, proposal: {summary, base_fingerprint, operations}})`;
`base_fingerprint` is required inside `proposal`, copied from fresh story context.
Use UUIDs from that story for existing entities. Names and titles are not IDs.
Each `new:...` reference must match a create operation in the same proposal; later
batches use the real UUID returned by Apply. Link data uses `from_id` and `to_id`.
Validation failures return a readable MCP tool error. Correct the call and retry;
they do not require reconnecting. If a client cached old tool schemas, refresh its
StoryTool connection to discover the updated staging schema and guide.

An outline proposal uses the `base_fingerprint` returned by current context, owned IDs,
and `new:...` references for creates. Stage is a validation preview, not a write to the draft.
The author can inspect external proposals in the story's **Story assistant** panel.
Apply is atomic and a retried Apply returns the same result. Later edits invalidate stale plans.

For prose, call `read_scene_prose` and page until you have the relevant text. Its hash
covers the whole scene, even when the returned text is a chunk. Then stage:

```json
{
  "summary": "Give Maya's choice a concrete consequence",
  "base_fingerprint": "<fingerprint-from-current-context>",
  "operations": [
    {
      "op": "write_prose",
      "entity": "scene",
      "ref": "<owned-scene-uuid>",
      "data": {
        "content": "Maya gave Eli the key. Beyond the glass, the last boat vanished into rain.",
        "expected_content_hash": "<hash-from-read-scene-prose>"
      }
    }
  ]
}
```

This replaces the complete scene text when applied, not just one returned chunk. Assemble
the intended full scene and preserve unaffected prose. Maximum replacement is 200,000
characters. Range-patch editing is not implemented yet. Word counts, prose revisions and
annotation re-anchoring use the same save service as the manual editor.

For recovery, create a named checkpoint, compare versions or preview a restore, obtain
the author's authorization, and pass the preview's exact `current_fingerprint` to
`restore_story_version`. Restore replaces the whole story graph and creates a recovery version.
It does not change ownership, saved model keys or account sessions.

Useful author requests:

> Read my story issues and notices. Identify the three most useful repairs, cite the
> affected scenes, and propose two alternatives where the evidence is uncertain.

> Read the connection guidelines, then build Act 2 with beats, linked chapters/scenes,
> Maya's character arc, her relationship arc, A/B threads and events with people/places.
> Reuse existing entities. Stage the outline and show what it changes before applying.

> Save a version called Before the ending rewrite. Draft an alternative climax that
> resolves Maya's need through a costly choice. Preserve the established POV and voice.

> Compare the current timeline with an earlier version. Keep theft before the opening
> in world time and the confession near the ending in reading order.

The deeper design and remaining release phases are in [MCP_SERVER_PLAN.md](MCP_SERVER_PLAN.md).

## Use the assistant in the app

1. Sign in and open **Settings** from the account menu.
2. Select OpenRouter, Anthropic (Claude), OpenAI, or TypeSafe (Jev), enter a model ID available
   to your provider account, and paste the API key in the password field.
3. Save the connection, then **Test** it. Keys are encrypted on this server and
   never returned by the settings API. The Jev test makes one small billable request.
4. Open a story and select **Story assistant** above the level list.
5. Choose a connected OpenRouter/Claude/OpenAI model and **Send message**. Discuss ideas, ask questions,
   and answer the assistant's questions. The conversation is saved separately for each story;
   replies include its latest 20 exchanges and the current story structure.
   Each reply shows a short preview of affected story items and whether edits are pending,
   applied, undone, or invalid. Plain-text replies work even without an edit tool call.
   Invalid edit plans retain the assistant's explanation in chat but cannot be applied;
   ask the assistant to revise them. Connection failures appear in the conversation.
6. Ask it to populate the beats, timeline, arcs, or any other supported story entities.
   Select **Review … story changes**, inspect the plan, then **Apply changes**.
   Advice-only replies have no edits. Unapplied plans remain proposals, and follow-up requests
   can revise them against the actual story. You can undo an applied batch before later edits.
7. To improve reader findings, **Refresh reader observations**, then use **Review and suggest**.
   Jev is used when connected; otherwise the Claude reader or configured fallback is used.

Example prompts:

> Build the missing beats and timeline events from this premise. Link the events to
> their people and locations and outline the scenes that fulfil the beats.

> Review the reader observations. Offer two possible improvements to the weak
> scene goals, explain their tradeoffs, and propose changes to the scene outlines.

> Reveal the theft in a late confession. Keep it before the opening in world time,
> and keep the confession near the ending in reading order.

Generation shares structure and fresh reader judgments. The prose checkbox also
shares bounded scene excerpts and evidence quotations. Draft prose is not replaced.
Requests use the connected provider's API billing. No key is needed to keep editing manually.

Each proposal is scoped to one owned story. Apply commits the whole validated batch
or nothing. A second Apply returns the first result. If the story has changed since
generation, create a fresh proposal. Undo is available only while the story has not
changed since that batch; it will not overwrite subsequent manual edits.

Current limits: at most 200 operations per proposal; 8,000 characters per scene
excerpt and 24,000 excerpt characters in total; synchronous generation with a provider
timeout. A rejected/invalid response leaves the story intact. Partial proposal selection,
streaming progress and embedded agent runtimes are later extensions.

## OpenRouter free model setup

In Settings choose **OpenRouter**. The model field is prefilled with
`nvidia/nemotron-3.5-lightning:free`; paste an OpenRouter API key from
https://openrouter.ai/settings/keys, save, and test. The test checks key authentication
and model tool support without making an inference request. Chat and structural edits
use the same saved connection, conversation history, validation, and apply/undo controls.

The free model request is pinned to that exact model and restricts provider input/output
prices to zero. No paid-model fallback is configured. Free requests can be rate limited;
start with a few beats or timeline events rather than a whole novel in one response.
NVIDIA's free endpoint logs session data for security and product improvement and asks
users not to submit confidential information. See the model page:
https://openrouter.ai/nvidia/nemotron-3.5-lightning:free.

## Connect a local Claude or Codex client

The included MCP bridge exposes four tools: read story context, stage a typed proposal,
apply it, and undo it. It uses the same ownership checks and executor as the in-app assistant.
The external client supplies its own model; it cannot read your saved provider keys or
trigger in-app billable generation using the delegated token.

In Settings, select a story under **Connect Claude or Codex tools** and create an agent
token. It expires after seven days and can be revoked there. Copy its one-time value
locally; keep it out of prompts, repository files, and chat.

In the terminal that will launch your agent, set:

```powershell
$env:STORYTOOL_AGENT_TOKEN = 'paste-your-story-token-locally'
$env:STORYTOOL_BASE_URL = 'http://localhost:8000'
```

For **Codex**, register the bridge:

```powershell
codex mcp add storytool -- uv --directory D:/learning/StoryTool/api run python scripts/story_mcp.py
```

Ensure the server entry in your local Codex configuration forwards the environment:

```toml
[mcp_servers.storytool]
command = "uv"
args = ["--directory", "D:/learning/StoryTool/api", "run", "python", "scripts/story_mcp.py"]
env_vars = ["STORYTOOL_AGENT_TOKEN", "STORYTOOL_BASE_URL"]
```

The environment variables contain the token; the configuration contains only their names.
Restart the client and use `/mcp` to check the tool connection. See
[official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

For **Claude Code**, launch from the terminal where the token is set and register:

```powershell
claude mcp add --transport stdio storytool -- uv --directory D:/learning/StoryTool/api run python scripts/story_mcp.py
```

Use `/mcp` to check the connection. Your local client must inherit the environment above;
do not put the raw token in a project-scoped MCP configuration. See
[Claude Code's local MCP setup](https://code.claude.com/docs/en/mcp).

Adjust the repository path if using another machine. Keep the backend running. The
bridge is a local stdio server, not an unauthenticated public MCP endpoint. Its token
permits reading and editing only the selected story, including its prose when requested.

An external agent should read context, use its returned entity schemas and existing IDs,
stage a proposal, and apply the user's requested changes. Creates use `new:...` references;
the server allocates actual IDs. Existing references must belong to the selected story.

## Server configuration

The local `api/.env` now has a generated `STORYTOOL_AI_ENCRYPTION_KEY`. Keep it stable
and outside version control. Losing or replacing it makes saved provider keys unreadable;
users then need to reconnect. A hosted deployment must supply that setting from its
secret configuration rather than generating a different key on each restart.

The migration adds encrypted provider connections, proposal history, reader observations,
and scoped agent tokens. Event world time can now be unset instead of treating every
unplaced event as simultaneous at position zero.

The in-app adapters use the [Claude Messages tool API](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
and [OpenAI Responses function calling](https://developers.openai.com/api/docs/guides/function-calling).
They do not run a coding agent's shell or file tools on behalf of app users.


### Reference fields, authorship, and safe deletion

Use description and aliases for character identity, relation_to_protagonist for a plain
reference, notes for working notes, and voice_notes for voice. minor is a supported role.
Only protagonists, antagonists, and positive/negative arcs require want/need for completeness.
Wounds are optional. Story fields world_rules, style_rules, thematic_statement, motifs and
notes keep reference material out of premise; scenes have notes separate from summary.
Private notes are excluded from shared reading and imports.

If you already know the entity IDs and intent, call get_story_fingerprint rather than the
full health/context read to refresh the write guard. Existing guards from context remain valid.
Delete uses {op:"delete", entity:"event", ref:"<owned UUID>", data:{}} inside a staged
proposal. Explain its impact and obtain the author's approval before applying. Story deletion
is not a proposal operation. Applied deletes preserve a recovery version; undo refuses later
edits. Field authorship is recorded from authenticated writes, not claimed model instructions.
