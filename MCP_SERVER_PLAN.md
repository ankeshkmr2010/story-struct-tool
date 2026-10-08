# StoryTool MCP server and writing workflows

Planning date: 8 October 2026. Status: proposed architecture; implementation is not started by this document.

## 1. Product outcome

An author connects a compatible AI application to StoryTool, selects the stories it may access, and asks it to plan, draft, review, or revise. The agent can understand the existing story, propose connected changes, and apply authorized changes. Everything appears in the normal workspace and version history.

The server supplies context, constraints, operations, and writing workflow templates. The connected AI application supplies the model and executes the reasoning loop. MCP does not by itself run a model, pay for inference, or make a model capable of reliable tool use. A plain model API requires a host/orchestrator to execute calls. The native assistant should eventually use the same services.

Success means useful story work with preserved author intent. A filled outline and zero structural warnings do not prove that a story is effective.

## 2. Existing foundations and verified gaps

Reviewed files:

- `api/scripts/story_mcp.py`: local stdio MCP bridge with get_story_context, stage_story_changes, apply_story_changes, undo_story_changes.
- `api/src/storytool/domain/ai/commands.py`: entity schemas, story-owned references, new: references, transactional operations and inverses.
- `api/src/storytool/domain/ai/controller.py`: staging, validation, applied-run retry handling, stale-state checks, undo and story-scoped tokens.
- `api/src/storytool/domain/ai/context.py`: graph, schema catalog, health, continuity, fresh observations, optional bounded prose.
- `api/src/storytool/domain/versioning/`: full-state checkpoints, previews and recovery on restore.
- `api/src/storytool/domain/auth/access.py` and `db/plugin.py`: ownership, write locking and automatic checkpoints currently coupled to API requests.
- `AI_SETUP.md`: current local-client setup and documented limits.

The SDK is already locked to mcp 2.3.0. Keep that baseline until compatibility tests justify an upgrade.

Current limits:

1. No hosted MCP endpoint or remote authorization flow.
2. Four coarse tools; reading a whole graph and all schemas is wasteful for one scene.
3. SceneCreate/SceneUpdate do not accept prose content; structural proposals cannot draft prose.
4. Delegated tokens are limited to one story and the existing /ai/ API prefix. There are no granular read/prose/propose/apply scopes.
5. Model metadata for external proposals is generic; provenance needs improvement.
6. No first-class writing brief, durable work session, or resumable chapter workflow.
7. No focused MCP resources, writing prompt catalog, or MCP-level contract test suite identified.
8. A new /mcp route would bypass current API-path authentication and checkpoint hooks unless explicitly integrated. This is the most important implementation trap.

Retain the valid executor, ownership checks, graph diagnostics, existing UI and versioning. Refactor their transport-dependent boundaries rather than creating another mutation engine.

## 3. Architecture

```mermaid
flowchart TD
    A[Compatible external AI client] --> B[Hosted MCP endpoint]
    C[Local stdio adapter] --> B
    D[StoryTool native assistant] --> E[Shared authoring services]
    B --> F[Authentication and delegated grants]
    F --> E
    G[Web workspace and REST API] --> E
    E --> H[Owned context and search]
    E --> I[Validated proposals and prose revisions]
    I --> J[Story write transaction]
    J --> K[Neon story graph and version history]
```

Proposed public endpoint: `https://storytool.onrender.com/mcp`. This URL is a design target, not a deployed MCP endpoint yet.

Use the official Python SDK and Streamable HTTP, mounted as an ASGI application alongside the existing Litestar app. Do not replace Litestar or introduce a separate service initially. Verify routing, middleware boundaries, startup/shutdown, exception handling and SDK lifespan integration in a small first milestone.

One adapter uses HTTP; another retains stdio for local clients. Both expose the same tool definitions and domain behavior. Keep the existing local configuration working during migration.

Use SDK-supported protocol negotiation and test both current and older supported clients. The July 2026 protocol changed sessions and HTTP behavior; avoid copying a pre-2026 SSE tutorial into this app.

Domain writes must use a transport-independent transaction service that authorizes ownership and capabilities, acquires the per-story lock, checks the reviewed revision, applies mutations, saves checkpoints, records the audit result and commits atomically. A failure in any part rolls back all story changes. Existing REST and MCP paths must pass the same fault-injection tests.

Never hold a transaction or story write lock while the external model thinks, while the author reviews, or while a provider generates text.

## 4. Connection and permissions

Default connection scope: one selected story. Multi-story grants are explicit, with a list of allowed story IDs. A list_stories response only lists allowed stories, even if the account owns more.

Capability design:

| Capability | Allows |
| --- | --- |
| story:read | Structure, summaries, timelines, health and non-prose context |
| prose:read | Selected draft text and authorized textual evidence |
| changes:propose | Stage structure or prose changes, without applying |
| changes:apply | Apply changes allowed by the grant and approval policy |
| versions:read | Version metadata and authorized previews |
| versions:create | Create named checkpoints |
| story:create | Optional future creation of a new story; absent from single-story grants |

Prose-bearing previews and old versions require prose:read. Scope enforcement must happen in services, not only tool discovery. A client calling an undisclosed tool directly still gets denied.

Preset UI: Review only; Suggest edits; Authorized writing. Grant author, selected story, expiry, capabilities and revocation are stored server-side. Client-provided identity and an `approved=true` tool parameter are never proof of authorization.

Phase A: support existing personal agent tokens and add capability constraints. This enables stdio and HTTP clients that support bearer headers. Call this a token-authenticated beta, not universal OAuth compatibility.

Phase B: implement standards-based remote OAuth. The author uses their existing Google-backed StoryTool login at the consent screen, chooses stories and capabilities, then grants access. Google authenticates the person; StoryTool or a vetted authorization-server integration issues access tokens intended for the MCP resource. Do not send Google ID tokens as MCP bearer tokens and do not expose model-provider keys.

The OAuth milestone includes protected-resource and authorization-server discovery, authorization code with PKCE, validated redirect URIs, resource/audience restrictions, short-lived access tokens, appropriate refresh rotation/revocation, issuer validation, and compatibility testing for client registration. Use a maintained implementation and complete conformance checks; OAuth is a separate workstream from tool decorators.

Origin validation, authenticated calls, secret redaction and authorization on every resource read are required parts of publishing a private server. Do not add a broad CORS wildcard to make connection problems disappear.

## 5. Author control

Default: read, reason, stage, show changes; applying requires a recorded user approval or an already authorized bounded workflow.

The author should not approve every individual beat. Offer a workflow grant such as: outline Act 1 and draft three new scene placeholders; do not rewrite existing prose, delete items, or change the ending. Persist these bounds and enforce them server-side.

A proposal records both requested intent and assumptions. Alternatives remain alternatives until chosen. A rejected proposal stays rejected. Author-confirmed decisions are distinguished from tentative ideas and reader guesses.

Approve against an immutable proposal digest, base story revision, actor and grant. If the proposal is edited, approval becomes invalid. Partial selection must include its required create/link dependencies or explain what is missing.

Read-only, propose-only and authorized-write behavior should be visible in both the client tools and the app connection screen.

## 6. Context designed for novels

Use progressive reads:

1. Story overview: premise, theme, mode, framework, brief, counts, major turning points, current revision.
2. Filtered entity lists: act, chapter, scene, thread, character, place; pagination and stable ordering.
3. Scene brief: POV, want/need, arc stage, goal/conflict/outcome, chapter obligations, thread, setting, prior outcome, next setup and temporal position.
4. Targeted prose: full requested scene through bounded chunks, never a silently truncated whole-novel payload.
5. Diagnostics: deterministic problems separately from model judgments, including stale status and evidence references.
6. Search: database-backed text and metadata filters first. Add embeddings only if usage proves they help.

Each response includes story_id, relevant entity IDs, revision, returned fields, prose inclusion, truncation flag and cursor when needed. Default lists exclude prose. Initial suggested bounds: 50 list rows and 8,000 characters per prose chunk; these are product settings to tune, not promises of token counts.

Use query projections and bounded evidence reads. Do not select every scene's content merely to return an outline. Cache only with identity/grant/story/revision in the key, with private resource cache scope. No shared prose cache across users.

Health or continuity checks may need the complete internal graph; the client response can still be compact.

## 7. Tools

Start with a small, stable tool catalog. The precise names can change once usability is tested.

| Tool | Inputs and useful output |
| --- | --- |
| get_capabilities | Allowed stories, granted scopes, schema/tool version, transport capabilities, limits |
| list_stories | Allowed library summaries; cursor |
| get_story_overview | Story ID; premise, brief, structural summary, revision |
| query_story_entities | Story, entity kind, filters, cursor; typed rows and IDs |
| search_story | Story, search text, field filters; bounded matches, evidence when permitted |
| get_scene_context | Story and scene; computed writing brief, adjacent scene summaries, optional permitted prose |
| get_timeline | Story, world/reading order, filters; people, locations, on/off-page events, unresolved positions |
| get_arc_trace | Character, relationship or thread; stages and linked scene evidence |
| get_story_diagnostics | Health, continuity, fresh observations, dismissed findings, clear severity and provenance |
| stage_structure_changes | Typed batch with expected revision, intent, rationale and idempotency key; stored proposal and summary |
| stage_prose_changes | Scene replacement or checked-range patches; prose diff, revision requirements, assumptions |
| inspect_proposal | Proposal details, paginated before/after diff, dependencies and diagnostics delta |
| apply_proposal | Immutable proposal, approved selection, idempotency key; result IDs, revision, checkpoints, changed entities |
| dismiss_proposal | Proposal; dismissed status, no graph mutation |
| undo_proposal | Applied proposal; reversible result or conflict when later work would be overwritten |
| manage_story_versions | Initially list/create/preview only; restore remains in the app until a separate grant/approval design is implemented |

Resources and prompts supplement these tools. All essential operations also have a tool entry because clients vary in how they expose resources and prompts.

Create schemas are discoverable and versioned, but ordinary reads should not repeat the entire schema catalog. Typed entity-operation unions replace a completely open data dictionary as the public contract. Include readable tool titles, concise descriptions, output schemas and appropriate read-only/destructive/idempotent annotations. Annotations guide clients; server checks enforce permissions.

Errors include a stable code, actionable message, field path/operation index, retryable flag, current revision if permitted and no_changes_applied. Initial codes: forbidden_scope, story_not_found, invalid_reference, invalid_fields, stale_revision, approval_required, proposal_superseded, undo_conflict, request_too_large, temporary_unavailable.

## 8. Editing prose

Prose is a dedicated operation, because the current structural schemas intentionally exclude scene.content.

Support full replacement for new or short drafts and checked-range patches for focused revisions. Each operation includes scene_id, base_content_hash, replacement content or patches, reason and requested change boundaries. Specify offset units consistently with the frontend; reject overlapping patches and stale anchors. Never fuzzy-apply to text that changed after review.

The executor recomputes word count, captures the previous prose revision, runs the existing annotation reconciliation behavior, marks reader observations stale, and records a before/after story checkpoint. Confirm that these behaviors are shared with the manual prose save service rather than reimplemented inconsistently.

UI previews show prose diffs as prose, with metadata changes separately. A tool can draft an optional alternative without replacing the accepted version. Later, promote useful alternatives into branch/fork workflows; the first release can use proposals and named versions.

Deletion of existing entities and whole-story restore stay out of the initial general write tool. They need explicit destructive-operation design, impact previews and separate authorization.

## 9. Timeline semantics

There are at least two orders: what happened in the fictional world, and when readers encounter or learn about it. Current fields support world ordinals and scene/chapter reading order; do not conflate them.

For The Blue Carbuncle, a theft can precede the opening in world time while being revealed near the end. An agent must not move the theft itself to the ending because the confession appears there.

Expose event occurrence, on/off-page status, linked scenes, people and locations. Preserve unknown time as unknown, not ordinal zero. Keep flashback markers meaningful and allow intentionally unplaced events.

A gap worth investigating: one scene_id cannot fully express an event being mentioned, witnessed and explained in multiple scenes. Plan an event_scene_revelation link with relation types such as occurs, mentioned, recalled, explained. Add it only after reviewing the existing timeline representation; keep current links compatible. This is a writing-model enhancement enabled by MCP work, not a protocol requirement.

Also distinguish what the reader knows from what individual characters know. Initially record bounded story decisions/notes; a full knowledge-state engine is a later feature, not a prerequisite for the server.

## 10. Resources and prompts

Private resource templates could include:

- storytool://stories/{story_id}/overview
- storytool://stories/{story_id}/brief
- storytool://stories/{story_id}/scenes/{scene_id}/context
- storytool://stories/{story_id}/timeline
- storytool://stories/{story_id}/diagnostics

These are MCP identifiers, not public website URLs. Reading an identifier requires the same grants as calling the corresponding tool. Resource listing cannot reveal private story titles to unauthorized clients.

Prompt templates: develop_premise, build_connected_outline, discover_structure_from_scenes, draft_scene, revise_scene, repair_timeline, strengthen_character_arc, review_story, continue_chapter.

Each specifies expected reads, author questions, artifact scope, quality checks and how to stage changes. Prompts suggest a workflow; the server does not assume the client follows them. Expose equivalent instructions through a tool for clients without a prompt picker.

## 11. What makes the writing effective

Capture an optional author brief: intended audience, genre/subgenre, thematic question, POV/tense, length goal, tone, desired ending, stylistic preferences, constraints, author-confirmed canon and unresolved questions. Persist it as authored state with versioning. Request only decisions needed for the current task; don't force a large setup questionnaire.

Workflow:

1. Understand the requested scope and existing canon.
2. Identify pivotal missing decisions and offer a few useful alternatives.
3. Build causal turns and stakes rather than just inserting named framework beats.
4. Trace character choices and costs through the plot.
5. Build a connected outline appropriate to the selected mode.
6. Draft scene by scene with adjacent context and explicit purpose.
7. Review causality, continuity, POV, voice, pacing and setup/payoff.
8. Revise narrowly, stage the result, explain tradeoffs, then apply within authorization.

Deterministic validation can prove ownership, links, valid schemas and defined temporal contradictions. Editorial judgments such as weak motivation or flat voice need quoted evidence, confidence, caveats and alternatives. Never reduce literary quality to one automated score.

Respect writing mode: plotter follows readiness/scaffolding; hybrid allows incomplete structure and placeholders; pantser can draft first and suggest inferred links without pretending they are confirmed. Hard technical errors remain errors in all modes, while incompleteness remains a visible creative state.

No built-in tool should simply call a model with 'write a good novel' and claim completion. The external client performs the creative reasoning; the server supplies trustworthy context and verifiable changes.

## 12. Sessions, proposals and audit

Durable domain sessions are explicit IDs, not shared module-level selected-story variables or protocol connection state. Session records store owner/grant, story, intent, bounds, base revision, accepted decisions, unresolved questions, completed artifact IDs, next step and status.

Reuse AIRun initially for proposal compatibility, then decide whether clearer Proposal models are justified. Add origin (external MCP/native/web), client-supplied display metadata marked unverified, grant/session IDs, tool name, operation counts, prose-change flag, checkpoints, approval digest and timestamps. Do not treat a claimed client/model name as authorization evidence.

An idempotency key is bound to actor/grant/story/tool and request hash. Replaying the same request returns its existing result; reusing the key with different content fails. Database constraints enforce uniqueness. Retry after a dropped connection cannot create duplicate chapters or apply patches twice.

Persist only the decisions and artifact references needed to resume, not hidden model reasoning. Audit errors without tokens or full prose. External-client conversation history is not automatically available to StoryTool; request summaries explicitly when needed.

Whole-story restore invalidates graph-bound proposals and active workflow revisions. Existing superseded-run behavior must extend to new proposal/session types.

## 13. App experience

Settings becomes an AI clients/Connections area: endpoint, chosen client instructions, selected stories, capabilities, expiry, status, last use and revoke.

The author sees a consent page for remote clients. Provider key settings stay separate; connecting an external client does not require entering another LLM API key in StoryTool.

Each story gets an agent activity view: requested task, client display name, proposed/applied state, short change summary, affected characters/beats/events/scenes, prose preview, review/apply/dismiss, and checkpoint links. Use the same preview components for native and MCP proposals.

A bounded workflow can show 'Outline approved; drafting scene 2 of 3' from explicit session updates. Do not pretend to know what an external model is doing between calls.

Refresh the workspace when the browser regains focus or on modest activity polling. Later add subscriptions where client/server capability and hosting behavior are proven.

## 14. Hosting and reliability

Initially use the existing Render service and Neon database. Persist grants, proposals, work sessions and idempotency receipts in Postgres. Neither the filesystem nor process memory is durable on this host.

Prefer short tools that read, stage or apply stored artifacts. Model thinking belongs in the external client; an open MCP HTTP request should not be needed for a full chapter generation.

Render's free service can sleep after 15 minutes and take about a minute to wake. Beta setup must distinguish waking/unavailable from bad credentials and document realistic retry behavior. Do not promise always-on MCP reliability on this plan. An always-on tier is a later cost decision for regular users, not required to prototype.

A native background writer requires durable jobs and a worker/lifecycle design; this is separate from publishing a useful MCP endpoint. No invisible daemon executing an entire novel in a free web-process background task.

## 15. Implementation sequence and release gates

| Phase | Work | Gate |
| --- | --- | --- |
| 0: contracts | Inventory schemas, authorization boundary, SDK mount and current client behavior | SDK handshake/discovery and one authenticated read work locally and on hosted staging |
| 1: shared safety | Extract principal/grants and story-write transactions; keep REST behavior | Ownership, atomic rollback, stale-state, idempotency and checkpoint parity tests pass |
| 2: useful remote beta | Streamable HTTP, stdio parity, focused read tools, typed structure proposals | Authorized client can build a linked outline; another user/story remains inaccessible |
| 3: prose workflows | Scene briefs, draft/revision staging, prose diffs, revisions and annotation handling | Draft/revise a scene safely; author text survives conflicts, retries and undo |
| 4: remote onboarding | OAuth, consent, grant management and tested client registration | Two real clients connect through browser authorization, revoke and reconnect correctly |
| 5: writing depth | Brief, prompt library, resumable tasks, arc/timeline views and editorial evidence | End-to-end short-story and nonlinear-story scenarios meet author and technical rubrics |

Phases 2 and 4 distinguish a usable bearer-token beta from a broadly connectable public integration. Do not call the latter complete before real OAuth clients pass.

Estimate, assuming the current codebase and one focused developer: roughly 5-8 working days for contracts, shared transactions and a token-authenticated structural beta; 4-7 more for prose workflows and review UI; 5-10 for OAuth and client interoperability; 4-8 for durable writing workflows and evaluations. Approximately 3-6 weeks for a credible broader release, with OAuth/client behavior the largest uncertainty. These are planning estimates, not delivery commitments.

Defer separate microservices, vector databases, autonomous multi-agent teams, automatic publication, arbitrary shell/file/network access, rich MCP widgets, and whole-novel unattended generation. None is needed to validate the central writing workflow.

## 16. Verification

Protocol: SDK and Inspector discovery, tool/resource/prompt lists, structured output, supported revisions, malformed calls, lifecycle, cancellation and restart.

Authorization: user A/user B isolation; story-subset grants; prohibited prose in resources, previews, search and historical versions; expired/revoked tokens; direct calls to hidden tools; invalid origins; OAuth redirect/PKCE/audience/refresh behavior.

Transactions: invalid second operation rolls back the batch; checkpoint failure rolls back the edit; same idempotency key can't duplicate scenes; story edits invalidate stale plans; race between two applies commits at most once; undo preserves subsequent edits.

Prose: content hash mismatch, overlap/offset handling, preserved author text, correct word count, prose revisions, annotation effects and stale reader observations. An unavailable external model never damages the story.

Writing fixtures: Blue Carbuncle occurrence vs reveal order; Red-Headed League misdirection and causal links; Last Lantern linked character stages and tutorial scene; an original small story from premise through draft and revision; pantser prose-first discovery. Treat seeded adaptations as structural fixtures; evaluate voice and literary quality on author-reviewed original text.

Novels: hundreds of scenes, bounded context, correct pagination, no prose overfetch, no incomplete-result masquerading as complete. Assess query counts, latency, output size and cold-start behavior before choosing performance thresholds.

Compare multiple tool-capable models on the same tasks: schema validity, tool selection, retries, unsupported fields, missing links, voice preservation and useful revision rationale. Model-specific success must not become a promise that every LLM behaves equally well.

## 17. Standards and sources checked

- [Official Python SDK](https://py.sdk.modelcontextprotocol.io/): implementation baseline and supported protocol behavior.
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http): endpoint, origin validation, metadata and version compatibility.
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): OAuth roles, discovery, resource-bound tokens and registration mechanisms.
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): tool contracts and structured outputs.
- [Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources): private contextual data and templates.
- [Prompts, older supported specification](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts): reusable user-selected workflows; final current SDK behavior must be verified during implementation.
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector): interoperability and protocol verification.
- [Render free-service limits](https://render.com/docs/free): idle sleep, startup delay and ephemeral filesystem.

The recommended first deliverable is a hosted, authenticated, story-scoped server with focused context reads, validated connected-outline proposals, app review, transactional apply and version recovery. Add prose and OAuth to make it a complete external writing integration.
