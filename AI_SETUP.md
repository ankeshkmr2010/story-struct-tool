# StoryTool AI setup

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
streaming progress, remote MCP hosting/OAuth, and embedded agent runtimes are later extensions.

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
