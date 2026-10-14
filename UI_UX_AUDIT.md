# UI / UX audit — 2026-10-11

Walked live on prod as a signed-in user (desktop, 1424×715 viewport): landing, library,
workspace Write / Read / Design, Design → Scenes, Story grid, Agent changes. Not yet walked:
Story timeline in depth, Settings, MCP setup, mobile. Code findings come from `web/src`.

**Core problem:** every feature is shown at equal weight, all the time. A new user lands in a
story with ~20 equally loud choices, no "start here", and no explanation of what each mode is
for. Most findings below are symptoms of that.

---

## 1. Grouping — things that belong together but are scattered

| Group | Today | Proposed |
|---|---|---|
| **Downloads** | Export .md · Export .docx · Backup as 3 header buttons; Restore backup in the library | One **Download ▾** menu with a line each: *Manuscript (.docx)*, *Manuscript (.md)*, *Full backup (.json, restorable)*. Library: **New story ▾ → Blank / From backup**. |
| **History & review** | Versions, Authorship in header; Agent changes, Catch up outline in sidebar | One **Review** sidebar group: Agent changes (pending badge) · Versions · Who wrote what · Catch up outline. |
| **Story settings** | Mode (Pantser) in header; POV + Framework inside the Premise level | Together in Premise (or one Story settings panel). Mode is set once per story. |
| **World reference** | Places alone under "REFERENCE"; Glossary as a sidebar tool | **World** group: Places · Glossary. Characters stays in the levels. |
| **Views** | Story timeline, Story grid mixed with tools ("→" buttons) | **Views** group: Timeline · Grid. |

Proposed workspace shape:

```
← Stories   The Red-Headed League         8,539 words · 6/6 drafted   [Share] [Download ▾]
            [ Write | Read | Design ]                                 ● live

DESIGN sidebar
  PLAN       1 Premise … 8 Scenes          (POV, Framework, Mode inside Premise)
  VIEWS      Timeline · Grid
  WORLD      Places · Glossary
  REVIEW     Agent changes (2) · Versions · Who wrote what · Catch up
  ASSISTANT  (only if kept)
```

Header goes from 9 controls to 4; the sidebar from three unlabelled lists to four labelled groups.

## 2. Duplication — same job, two places

- **Prose is editable in Write and in Design → Scenes** (own picker, reorder arrows, Delete,
  Annotate, full prose box). Design → Scenes should show the scene card (goal, conflict, POV, …)
  and an **Open in Write** button. One home for prose.
- **Three "context" surfaces**: Write → Context, Read → Context, Design → Health panel. Fine to
  keep, but same look and naming.
- **Three timeline renderers**: `StoryTimeline.tsx`, `SharedStoryReader.tsx`, `StoryShowcase.tsx`.
  One shared read-only component.

## 3. Clutter and noise

- **Chrome before content.** Site header + back link + title + 7 header buttons + mode tabs +
  "Live · checks for changes every 5 seconds" stack before any content. In Read, prose starts
  at the bottom of the first screen.
- **Developer text**: "Live · checks for changes every 5 seconds" → a small dot that speaks only
  when something changed. Health shows rule codes (`L1 · arc.too_few_turning_points`) in an
  orange block for a mild note → plain language, quiet style, count badge on the tab.
- **Read**: blurb repeated under the header; "Refresh story" is redundant with live updates;
  context panel open by default.
- **Write**: empty Epigraph and Opening note fields sit above the first scene's prose →
  collapse to "+ Add epigraph / note".
- **Library cards**: every card shows a full "complete" bar (no information); Delete as loud as
  Share; no last-edited or word count; own stories, examples and tutorial look identical;
  tutorial CTA is an off-palette blue.

## 4. Journey friction

- **No first-run path.** New accounts get 3–4 stories and no "start here" → a "Start with the
  demo" card in the library and an empty state per tab saying what it is for.
- **Unexplained jargon**: levels, beats, pantser/plotter, threads, "catch up outline".
- **Landing order** is hook → sharing → Write/Read/Design → modes → AI; value order is
  write → plan → share. Sharing section sells email sharing, not the public showcase.
- **Mobile** not addressed (known).

## 5. Code findings

| # | Finding | Evidence | Note |
|---|---|---|---|
| C1 | Two styling systems | Tailwind palette classes in 28 files (~1140 slate, ~100 amber, ~76 violet, ~69 sky) vs `index.css` tokens (`--page`, `--surface`, `--accent`) | Root cause of "all over the place". Migrate to tokens, shell first. |
| C2 | Three timeline renderers | see §2 | Merge into one read-only component. |
| C3 | One-line JSX up to ~1.9k chars | `ManuscriptReading.tsx`, `SharedStoryReader.tsx`, `UserSettings.tsx`, `AuthorshipPanel.tsx`, `SceneEditor.tsx` | Reformat when touched, not as a project. |
| C4 | Polling every 5 s | `StoryList.tsx:45,47` (stories + shared), workspace activity check | Refetch on focus or 30 s. |
| C5 | Dead code is small | unused `api.listAIObservations`; ~30 unused exported types in `api/client.ts` | Trivial cleanup. |
| C6 | In-app assistant unused in prod | `AuthoringAssistant.tsx` (20 KB); prod: nearly all edits via MCP | Product decision: keep or remove. |

## 6. Tester feedback (2026-10-11)

| Feedback | Finding | Maps to |
|---|---|---|
| "A button after Design saying *Generate 3 stories with this* would be cool for non-creatives." Also generate Chapters / Scenes. | New: generation entry points for non-writers. Needs an AI: either a **copy-prompt for your connected AI** (like Catch up outline, no billing) or the in-app assistant (billing). | New item; tied to C6 |
| "Only 1 turning point(s) marked; an arc skeleton wants at least 3" seen in Characters, nothing to fill in. | Confirmed: warning is a level 2 Arc Skeleton finding (`api/src/storytool/domain/health.py:86`); turning points are timeline events with *Turning point* = Yes (`StructurePanels.tsx:60`). Health shows it on every level with no link. Fix: per-finding "Fix in Arc Skeleton →" link + plain wording explaining a turning point. | §3 Health noise (raise to Tranche 1) |
| "Point of view and Framework dropdown values were tough to understand; an info hover icon would help." | Confirmed: options are raw enums (`first`, `third_limited`, `third_omniscient`, `second`, `mixed`; `three_act`, `save_the_cat`, `custom`) at `web/src/pages/StoryWorkspace.tsx:354-355`. Fix: human labels with a one-line description per option + one reusable ⓘ help component, reused for all jargon (levels, beats, pantser/plotter, threads, turning points). | §4 jargon (raise to Tranche 1: cheap) |
| "Dark mode is green; I'd expect bluish or greyish dark." | Green comes from `index.css` tokens (`:root[data-theme=dark]`). Neutral/blue-grey dark is a token change once C1 is done. | C1 |

---

## Proposed order

1. **Tranche 1 — biggest change in feel**: header + Download menu (§1); sidebar regrouping (§1);
   remove prose duplicate in Design → Scenes (§2); developer text and Health noise (§3);
   token migration for the workspace shell (C1, partial).
2. **Tranche 2 — friction**: Read/Write clean-ups and library cards (§3); first-run path and
   jargon (§4); merge timeline renderers (C2); polling (C4).
3. **Tranche 3 — finish**: full token migration (C1); landing reorder (§4); dead code (C5);
   assistant decision (C6); mobile.

**Open decisions:** keep or remove the in-app assistant · generation via copy-prompt vs in-app assistant · dark palette (grey vs blue-grey) · approve the grouping above ·
pick the starting tranche.

---

## Tasks (source of truth for UI/UX work — update status here)

Status: `[ ]` todo · `[~]` in progress · `[x]` done (add commit hash). Rule: propose before
coding anything vague; verify on prod with the user (Render deploy is manual).

2026-10-14: per user, shipped work is marked done. This status does not claim local tests
or production visual confirmation. T20 remains open for the unfinished walkthrough.

## Remaining work by effort — 2026-10-14

Complete current overview of recorded/requested work. Effort is relative and provisional;
undecided scope needs clarification before implementation. Built work awaiting confirmation
is separate. Adding these tasks authorizes documentation only, not implementation.

### High effort — implementation

- [~] T61 User-built typed validators (High; builder and definition/API/MCP foundation built): simple form builder, personal enable/disable settings and MCP CRUD; iteration 1 adds custom checks and migrates all current Jev checks to a common provider-neutral definition format. Scope below.
- [~] T53 Shared Jev foundation (built foundation; awaiting production confirmation): scene-scoped typed questions, reusable answer cache, private shared-key access, request/option limits, user and anonymous-demo rate limits, spend accounting, timeouts and safe fallback. Detailed boundaries below.
- [~] T54 Jev craft checks and Verify cascade (built; awaiting production confirmation): scene/sequel, value shift, MICE nesting and midpoint misbelief, plus setups/payoffs and continuity. Combine atomic answers in code; route uncertain scenes to the user's AI. Includes the pending T42 visual nesting work.
- [~] T55 Live Write and sandbox hints: opt-in panel beside the active scene, two-second debounce, stale-response protection and dismissible notes in Write and /try. Built; awaiting production confirmation. Never edits prose.
- [ ] Scrivener import (T36 follow-up): remaining import format; Word import is complete.
- [ ] T44 Series bible: share characters, places and glossary across books.
- [ ] T45 German, then Spanish: localized interface and per-story language through MCP. Related to T52; localization remains separate.
- [ ] T46 Monetisation (later): early-supporter lifetime deal via Gumroad or Paddle once beta feedback settles.
- [ ] T50 Current-manuscript authorship percentages: human / AI / unknown word attribution across edits, paste/import, AI changes, deletion, undo and restore; tracked provenance, never AI detection.

### Medium effort — implementation

- [~] T56 Jev ladder nudges: score premise/stakes and other readiness gaps with Plotter/Hybrid/Pantser context; amber only for likely gaps, silence for weak evidence.
- [~] T57 Beta-comment triage: categorize and grade feedback, then summarize repeated concerns by chapter for the author.
- [~] T58 Related-search reranking: use Jev relevance scores to reorder semantic hits; preserve Exact results and existing permissions.
- [~] T59 Catch-up staleness: assess whether each scene still matches its outline before asking an LLM to rebuild it.
- [~] T60 Calibration from author feedback: record acceptance/dismissal labels, assess checks in aggregate, and tune thresholds by check and visibility.
- [ ] T20 follow-up: make event insertion between world positions atomic so failures cannot leave partial shifts.
- [ ] T25 Shared/showcase view counts: define unique vs repeated, signed-in vs anonymous, and story vs chapter views first.
- [ ] T42 Evaluation overview: all-checks summary and Run all, with readiness/provider requirements defined first. Visual nesting is grouped under T54, not counted twice.
- [ ] T43 Shareable authorship disclosure: package the existing report for agents, publishers and contests. Accurate word percentages remain T50.
- [ ] T52 Latin-script language support: define accented-text/punctuation improvements and validate Jev on the intended v1 languages before promising language-specific checks. Planned on the public roadmap.

### Low effort — wording / decisions

- [ ] Image disclaimer: clarify additional allowed-content/permission wording. Format/size guidance is shipped; the broader disclaimer remains pending clarification.

### Configuration and production confirmation — built, not new coding

- [~] T51 Shared Jev: replace the Render TYPESAFE_API_KEY placeholder if still needed, redeploy, and confirm Noticed → read prose uses the shared reader without a personal connection. Configuration completion has not been confirmed in this task record.
- [~] T20 Walkthrough: Timeline, Settings and MCP setup; actual connection/copy/revocation behaviour and narrow-screen layout.
- [~] T23 Images: manager filters and usage links, right-click picker and clipboard actions, inline thumbnails/removal, scene/Catch up thumbnails, enlarged reading previews, resizing large phone photos, alt-text nudges, all export placements, retained history and permanent-story cleanup.
- [~] T22/T48/T49 Search: exact/related results, destination links and agent/review evidence prompts.
- [~] T24 Beta readers: invitations/access, frozen rounds, private conversations and polls.
- [~] T27/T32/T40/T41 Roadmap and landing follow-ups: vertical condensed Delivered, hero rings, current Upcoming cards and craft copy. T42 built polish: definitions, dates, stale-review actions, automatic refresh and item links.
- [~] T28–T34/T47 Site copy and onboarding: privacy/pricing, hero/differentiators, AI starter/client setup and how-to guides. Recent image-insertion tour samples also await confirmation; T35's core sandbox remains marked complete per user.
- [~] T37/T38 Funnel and feedback: account milestones, admin counts and private feedback flow.
- [~] Page link previews: distinct cards for Landing, Your stories, Roadmap, Shoutouts, Feedback and How to use; per-story public showcase metadata/image and generic private-page previews.

### Parked / superseded — do not restart automatically

- [ ] T14 Generate entry points: parked under D3; interaction/provider approach remains undecided.
- [ ] T11 First-run demo card and tab empty states: deferred/superseded by T35; only revisit if a specific onboarding gap is reported.

**Decisions (blockers)**
- D1 Grouping in §1 — **approved as proposed** (2026-10-11), plus an ASSISTANT group (D2); revisit if it feels wrong on screen.
- D2 In-app assistant — **keep** (2026-10-11): users bring their own API key, so no cost; it serves writers without an MCP client. T18 becomes "make it discoverable".
- D3 Generation buttons — **later** (2026-10-11); T14 parked. Likely engine: in-app assistant (own key) and/or copy-prompt.
- D4 Dark palette — **neutral grey** (2026-10-11): charcoal greys, green only as accent.

**Tranche 1 — biggest change in feel**
- [x] T1 (357ce79) Header: Title · stats · [Share] · [Download ▾] (Manuscript .docx / .md, Full backup .json, one line each). Versions + Authorship leave the header. `web/src/pages/StoryWorkspace.tsx`. Needs D1.
- [x] T2 (92f2045) Design sidebar groups PLAN (levels) · VIEWS (Timeline, Grid) · WORLD (Places, Glossary) · REVIEW (Agent changes + badge, Versions, Who wrote what, Catch up). Mode moves into Premise with POV/Framework. `StoryWorkspace.tsx`. Needs D1.
- [x] T2b (8f438a1) Revise T2 after seeing it on prod (user feedback 2026-10-11: Views/World/Review sit at the same level as Plan, not under it; headings too faint; lots of unused space on the right). Decided layout: keep **Write · Read · Design** as main tabs and add a full-width **second nav row** directly under them: `Timeline · Grid │ Places · Glossary │ Agent changes (badge) · History · Catch up` (+ Story assistant). The Design sidebar then holds only the 8 PLAN levels, with a more prominent heading. These views must open from any tab, not only Design. `StoryWorkspace.tsx` (`*_VIEW` constants, `workspace-nav`).
- [x] T2c (a7f9132) Merge Versions + Who wrote what into one **History** item: one dialog/page with tabs `Versions | Who wrote what`. `StoryVersions.tsx`, `AuthorshipPanel.tsx`.
- [x] T2d (e40af4b) User feedback: Plan sidebar showed beside Timeline/Grid. Plan is now the first item in the views row (sibling); the levels sidebar + Insights render only on Plan; every other view is full width. Plan remembers the last level.
- [x] T2e (b8f9907) User feedback: the row showed everywhere but always jumped to Design. Split: **reference side panel** (Timeline · Places · Glossary · Assistant) toggled from the tab bar in every mode; **Design pages** row (Plan · Grid │ Agent changes · History · Catch up) only in Design. Timeline has a compact vertical mode; scene click jumps within the current mode. Read's duplicate timeline toggle removed in the workspace (shared readers keep it). Insights hide while a panel is open.
- [x] T3 (7b0c9cc) Design → Scenes: drop the prose editor; show the scene card + "Open in Write". `web/src/components/SceneEditor.tsx`, `StoryWorkspace.tsx`. Needs D1.
- [x] T4 (a947a4c) Health panel: plain wording, no rule codes, quiet warning style, per-finding "Fix in <level> →" link, count badge on the tab. Fixes the turning-point confusion (§6). `api/src/storytool/domain/health.py` messages + the health panel component.
- [x] T5 (77e8c14, 9614608) Readable option labels with one-line descriptions for POV / Framework / Mode, plus one reusable ⓘ help component; then apply it to jargon (levels, beats, threads, turning points, pantser/plotter). `StoryWorkspace.tsx:354-355`.
- [x] T6 (cca74b0) Replace "Live · checks for changes every 5 seconds" with a quiet dot that speaks only on change; remove Read's "Refresh story".
- [x] T7 (c8f760a, via T15) Token migration for the workspace shell (header, sidebar, panels): Tailwind palette classes → `index.css` tokens (C1, partial).

**Tranche 2 — friction**
- [x] T8 (c48a0d2, 7dc48a9) Read: no repeated blurb; context panel closed by default. `SharedStoryReader.tsx` (`StoryReader`).
- [x] T9 (cc2af78) Write: collapse empty Epigraph / Opening / Closing note into "+ Add epigraph / note". `StoryWriter.tsx`.
- [x] T10 (8916eee, 082fc20) Library cards: Delete into a ⋯ menu; last edited + word count instead of the "complete" bar; mark examples/tutorial; New story ▾ (Blank / From backup); on-palette tutorial CTA. `web/src/pages/StoryList.tsx`.
- [ ] T11 (deferred 2026-10-12: superseded by T35's no-signup sandbox and demo tour) First run: "Start with the demo" card; empty state per tab saying what it is for.
- [x] T12 (109a37e; the workspace Timeline stays the editing tool) One shared read-only timeline component for app / shared reader / showcase (C2).
- [x] T13 (ca3ce1e library 30 s; a46fb64 workspace 15 s) Polling: library 5 s → refetch on focus or 30 s (`StoryList.tsx:45,47`); same for workspace activity (C4).
- [ ] T14 (parked, D3 = later) "Generate" entry points after Design and in Chapters/Scenes (§6).

**Tranche 3 — finish**
- [x] T15 (c8f760a) Full token migration + new dark palette (C1). Needs D4.
- [x] T16 (836ca39) Landing: reorder to write → plan → share; sell the public showcase.
- [x] T17 (3a3ce8a) Dead code: `api.listAIObservations`, unused exported types in `web/src/api/client.ts` (C5).
- [x] T18 (f0ed5bc; tab-bar Assistant button since b8f9907) Make the in-app assistant discoverable: own ASSISTANT sidebar group, obvious "add your API key" step (`AuthoringAssistant.tsx`, `UserSettings.tsx`).
- [x] T19 (c48a0d2 + follow-ups; verified by the user 2026-10-12) Mobile pass.
- [~] T20 (code audit 2026-10-12; visual walkthrough still pending) Story timeline in depth, Settings, MCP setup. No local tests/browser automation by request.
  - Timeline: world/read order, person/place filters, scene/event links, inline fields, cast confirmation, loading/retry and mutation error feedback exist. Follow-up: insertion between adjacent world positions shifts entries through separate API calls before creating the event; a failure can leave a partial shift (`web/src/components/StoryTimeline.tsx:56`). Needs an atomic operation, not an unrelated fix in this batch.
  - Settings: encrypted provider keys, connection testing, OAuth scopes/revocation and masked seven-day manual tokens are present. Follow-up built: manual-token loading/empty/error/retry and revocation errors now have feedback; OAuth/Claude/ChatGPT guidance leads, with manual tokens in an expandable section (`web/src/pages/UserSettings.tsx`). Visual layout and actual connection behaviour await the user's check.
  - MCP setup: all guides, source links, URL/config/prompt copy actions, clipboard error feedback and keyboard tabs retained. T33/T34 simplify the starter request and put Claude/ChatGPT first with other clients expandable. Check narrow screens, expansion/collapse, keyboard focus, copy actions and the first critique in production (`web/src/components/MCPSetup.tsx`).
- [x] T21 (shipped: b3cd031, d6fb88e, 62634d6, 7df0897, 631723f, a20e041, 426cda0; marked done per user 2026-10-14) Story evaluation systems. Separate from live health findings: an on-demand engine + its own Evaluate page; fields are inputs only, nothing is checked until the user runs an evaluator.
  - Engine `domain/evaluation/`: pluggable evaluators (id, name, required inputs, run → findings + visual data). Adding one = one file.
  - API: list evaluators with readiness (missing inputs); run one. Deterministic results computed on request.
  - LLM evaluators: one package (instructions + relevant inputs + result schema). Run via MCP (`run_evaluation` → agent → `submit_evaluation`) or, with an API key, directly through `domain/ai/runner.py`. Same result format.
  - LLM reports are saved and versioned (dated, tied to the story fingerprint, history kept, flagged stale when the fingerprint changes).
  - Step 1 (built): engine + API + scene/sequel rhythm + MICE nesting. MICE spans are derived from scene links (first to last scene, reading order); only `Thread.mice` is stored, no `scene_thread.role`.
  - Step 2 (built, awaiting tests + prod check): Evaluate tab in the Design views row (after Catch up), `web/src/components/StoryEvaluation.tsx`. Pick an evaluator, run, findings link back to the scene or Threads. Missing MICE categories: fill them in the tab, or ask an AI (copy MCP prompt / in-app assistant) to propose them into Agent changes. The thread editor stays unchanged (user: "do not clutter thread").
  - Step 3a (built, awaiting tests + prod check): MICE AI review. Package `GET evaluations/mice_nesting/package`; reports `POST/GET evaluations/mice_nesting/reports` (one row per run in `evaluation_report`, stale when the editing fingerprint changes, 409 on submit if stale); key-based run `POST .../ai-review`; MCP `get_evaluation_package` / `submit_evaluation_report`. Agent tokens may POST only `.../evaluations/{id}/reports` (`domain/auth/access.py`). Verdicts works / consider / needs_change (1-2 fixes), shown in the Evaluate tab with links to threads and scenes.
  - Step 3b (built, awaiting user's prod check; no local tests by request): value shift versus prose (`value_shift`) and misbelief at midpoint (`misbelief_midpoint`). Same MCP/key-based report flow. Value shift reads drafted, placed scenes with both emotional values. Misbelief uses recorded character misbeliefs and scenes/chapters linked to explicitly marked midpoint beats, plus neighbouring scenes; no guessed midpoint. Verdicts link to scenes/characters.
  - Step 3b input assistance (built, awaiting user's prod check; no local tests by request): both new evaluators offer copy-agent prompts and key-based proposals for missing inputs, like MICE. Prose is included; existing values are preserved, unsupported inputs remain blank. Accept in Agent changes before running the review against a fresh package.
  - Out: Save the Cat / Story Grid by name (trademark), genre-driven switching (later).
- [x] T22 (fa4996f; built 2026-10-13; awaiting production visual confirmation) One search modal contains the query, readable context/field filters and results (`web/src/components/StorySearch.tsx`). It automatically runs literal and semantic search as the user types, shows text matches first and adds related results without duplicates or a Match selector. Search remains available centrally in Write/Read/Design and in the library's left section. Active reference panel/current section scope and owner-only library scope are preserved, as are refresh/re-entry, destination links and save protection. Agent conversations, review/history pages and shared-reader search remain outside this release.
  - Literal case-insensitive names/phrases, escaped wildcard characters, bounded field excerpts, one result per entity and paginated destinations with save protection (`api/src/storytool/domain/search/{controller,service}.py`). Story ownership and agent prose scopes apply. No manuscript is downloaded for browser filtering.
  - Cloudflare `@cf/baai/bge-small-en-v1.5` configured in Render; small credential-backed inference passed, 384 dimensions. Fixed indexing/text-search failures caused by JSON null in nullable list fields (`domain/search/service.py`): 10 affected production stories had no index. Pending indexes return a normal status; text results remain usable and semantic results retry automatically. No production data was edited for this fix. Production visual confirmation remains pending.
- [~] T23 (built 2026-10-14; awaiting production confirmation) Inline manuscript illustrations and reference images for characters, places, glossary entries and scenes. Private Neon storage; immutable files plus versioned captions/alt text and attachments. Upload preview/progress/cancel/retry and a reusable story picker. Caps confirmed by user: 5 MB per image, 50 images and 100 MB per story, counting historical files; still JPEG/PNG/WebP up to 20 megapixels. Owner/shared/showcase/frozen beta reading access, image-preserving backups and independent imports; Word/EPUB/PDF embed images, HTML embeds data, Markdown packages assets in ZIP, plain text retains descriptions. Migration `f7a2c9d5e801` verified on an expiring Neon branch; API generation, static types and focused lint passed. No tests/builds or manual deployment. Private bucket created. User manually set the five Render storage variables (presence verified read-only) and started redeploying. Approved cleanup now queues retained file keys transactionally on permanent story purge and removes them after commit, with retries; live/trashed stories and version restores never enqueue cleanup. Migration `a9d3f1b6c802` verified on the expiring Neon check branch. No manual deployment triggered by the agent. Removed library images are archived for history and still count toward caps. No production UI confirmation yet.
  - Guide/demo update (built 2026-10-14; awaiting production check): landing images section and Read/export copy; How to use Images section covers upload limits, insertion, reference attachments, previews, deletion/history and portable exports. Discover more adds a fifth Images step with a local sample illustration, editable preview caption, delete/restore and Read preview. Export and sharing previews use that sample; HTML embeds it and plain text preserves its description/caption at the same position. Main six-step sandbox writing tour and saved sandbox draft are unchanged. Static checks only; no tests/builds or manual deployment.
  - Follow-up (built 2026-10-14; awaiting production check): Images manager in the story header in Write/Read/Design. Delete confirms current placement/attachment counts, flushes unsaved drafts and atomically removes all current uses with scene revisions and a recovery version; historical files and beta rounds remain intact. Read images open a larger in-app preview with caption, Escape/Close/backdrop dismissal and an original-image link. All manuscript formats share image block ordering, including image markers within paragraphs; Markdown packages assets and plain text keeps descriptions/captions at the same position. API types regenerated; static checks only, no tests/builds or manual deployment.
- [x] T24 (d20800e, b2a0709, d253560, bacfee1; built 2026-10-13; awaiting user production check; no local tests/builds) Beta readers alongside existing read sharing: frozen manuscript rounds, signed-in invite links with approval by default or optional automatic admission, link disable/rotation and independent reader revocation. Private reader/author conversation threads have quoted passages, open/resolved state and protected stable URLs. Per-story polls cover draft/open/closed/archived, full CRUD, one editable response per reader, optional named/anonymous results and reader result visibility. Changing questions/options after responses creates a new version; deletion confirms loss of responses. Reader-reported chapter progress stays separate from view counts (T25). Migration `c8a6e4f2d901`; Dedicated Beta readers button beside Share opens beta management, with beta polls below reader management; admitted rounds appear in Shared with you. Generated API types only; no tests, builds or manual deployment.
- [ ] T25 (new, mechanics unclear, 2026-10-12) Viewer count on shared/showcase stories. Define what counts as a view (unique signed-in viewer, anonymous, per story or per chapter) before building.
- [x] T26 (e9d88ff; marked complete per user 2026-10-13; no local tests) EPUB/HTML/TXT and submission PDF built. PDF: 12pt Times, double-spaced prose, one-inch Letter margins, title/byline/word-count page, running page headers, scene-break markers, chapter page breaks. Optional Glossary/Timeline/Places appendices use compact spacing and separate pages; timeline keeps world order distinct from reading order. PDF omits planning premise and undrafted-chapter markers. Standard PDF fonts support Latin-script text; unsupported characters fail explicitly instead of being replaced (`domain/story/manuscript_pdf.py`, `backup.py`, `DownloadMenu.tsx`). Author name comes from Settings for all manuscript formats. prose:read enforced for PDF. MOBI skipped; Markdown/.docx already existed. No local tests.
- [x] T27 (9f67e00, a7c5b18, cc20b2f; 2026-10-12, awaiting prod check) "On the horizon" roadmap at `/roadmap` (site nav + landing hero link) and Shoutouts at `/thanks` (banner above WRITE on the landing page). Shoutouts are stored in the `shoutout` table, public read via `/api/shoutouts`; editing inline on `/thanks` only for `STORYTOOL_ADMIN_EMAILS` (`domain/site/shoutouts.py`).

- [~] T27 follow-up (2026-10-14): Delivered keeps its vertical dated timeline; similar entries condensed into single lines with subtle rings on hero feature titles. Awaiting user production confirmation.

**Writer onboarding and positioning — agreed backlog (2026-10-12)**
- [x] T28 (f3a7b81; built, awaiting user's prod check) Privacy page `/privacy` and homepage no-training answer/link. Explains stored drafts/AI history, encrypted keys, optional AI and separate client/provider policies, sharing, Trash/deletion, and operational logs that can include AI summaries. Verified against `domain/ai/{models,runner,controller,credentials}.py`, `domain/auth/controller.py`, `domain/story/controller.py`; no blanket provider guarantee. Public refresh path included in `frontend.py`. Internal task, not a public roadmap card.
  - Visibility follow-up built from the user's screenshot: pricing/privacy are readable, bordered cards below the primary buttons (14px titles / 13px details), side by side on desktop and stacked on phones. Existing help/roadmap links retained (`web/src/pages/Landing.tsx`, `web/src/index.css`). Privacy also explains product feedback and internal usage counts. Awaiting user's prod check.
- [x] T29 (7853260; built, awaiting user's prod check) Pricing page `/pricing` and homepage link: user confirmed "Free during beta; future pricing undecided". External AI client/API charges remain separate. Public refresh path included in `frontend.py`. Internal task, not a public roadmap card.
- [x] T30 (94da02a; built, awaiting user's prod check) Sharpened hero for novel writers: plan, write and keep a novel consistent, with existing AI or none (`web/src/pages/Landing.tsx`). Wording/arrangement approved by the user. Internal task.
- [x] T31 (827e0ab; built, awaiting user's prod check) Homepage differentiators below the hero/banners: authorship, MICE thread nesting, scene/sequel rhythm. Existing feature-grid styling; writer benefits, no competitor claims (`web/src/pages/Landing.tsx`). Internal task.
- [x] T32 (47a7224, bacfee1) Public roadmap refreshed 2026-10-13 (`web/src/pages/Roadmap.tsx`): search, automatic report refresh, Word import, PDF, pen names and the newer craft reviews added to Delivered. Word's card now covers remaining Scrivener support; stale PDF/search cards removed. Every release must update Delivered and upcoming cards (`AGENTS.md`). Awaiting the user's production check.
- [x] T33 (72b0d93; built, awaiting user's prod check) Starter prompt: "Read my story and tell me what's weakest in Act 2." MCP instructions handle discovery, story selection, IDs/fingerprints and evidence; critique alone does not authorize edits/apply/restore (`web/src/components/MCPSetup.tsx`, `api/src/storytool/mcp_server.py`). Public roadmap: easier first AI conversation.
- [x] T34 (c0d773d; built, awaiting user's prod check) Claude then ChatGPT by default; other clients expandable, with all guides/restrictions, copy actions, source links and keyboard navigation retained (`web/src/components/MCPSetup.tsx`). Arrangement approved by the user. Public roadmap: grouped with T33.
- [x] T35 Try before signing up: guided browser-local Last Lantern sandbox. Effort: High. Marked complete per user 2026-10-14 (64600bd). [DESIGN.md §9](DESIGN.md#9-try-before-signing-up--guided-sandbox-t35). `/try` reuses Write/Read/Design through an IndexedDB API adapter and pinned static seed; hidden account/AI/sharing/export features, local Exact search, six real-event tour steps, skip/free play, mobile coach sheet, reset and seven-day expiry. Keep flushes writing, signs in through the existing Google flow, restores with the existing backup importer, preserves You history and navigates to the edited scene. User-scoped import markers make retries idempotent. Admin funnel tracks step drop-off, keeping/imports and signup conversion, with nonblocking queued browser events. No migration, local tests/builds, browser automation or manual deployment. Targets: tour completion >50%, sandbox → signup >15%. Production checks: all six steps, mobile/keyboard, return/skip/reset, storage failure, sign-in/import retry and carried-over prose/history. Static assets still use the existing site hosting; sandbox editing does not wait for backend API responses.
  - Follow-up complete per user 2026-10-14 (64600bd): primary homepage tour button, Previous/Next with action readiness (typing never advances automatically), Discover more previews for Catch up/Evaluate/exports/sharing, Write with AI guide with connection steps/quickstart/copyable prompts, and sticky navigation with measured tour offsets. TypeScript no-emit checked; no local tests/builds or manual deployment.
- [x] T36 (e9d88ff, 19c801d; confirmed by user 2026-10-13) Library → Create ▾ → From Word (.docx): creates a new story using the entered title or filename. Body prose only; Heading 1 starts chapters, with one scene per chapter; no headings means one chapter. Body/table text is kept in order with simplified formatting; images/comments/headers/footers excluded. Tracked changes must be accepted/rejected before import; upload/unpacked-size limits enforced. Import records authorship, an initial version and the first-scene milestone (`domain/story/docx_import.py`, `StoryList.tsx`). Two optional generated prompts: organize chapters/scenes while preserving exact wording/order, and populate all supported story components from prose. Existing MCP read/schema/prose/proposal operations suffice; stage before author approval, no new tools (`components/importPrompts.ts`). Scrivener later; JSON backup restore stays separate.
  - UX correction (19c801d; confirmed by user 2026-10-13): native modal covers selection, progress, named result and both prompt actions. Imported Word stories appear first with an Imported badge and permanent Import prompts entry. Import provenance is derived from existing authorship records; no new migration (`WordImportDialog.tsx`, `StoryList.tsx`, story controller/schemas). No local tests.
- [x] T37 (6ee1aac; built, awaiting user's prod check; no local tests by request) Internal funnel tracking approved by the user. Random browser UUID in local storage; deduplicated visit and account milestones in `funnel_event`. Signup means a new StoryTool account through Google sign-in; first scene means an author-created scene via UI or applied proposal (samples/scaffold/undo/restore excluded); AI means a saved provider connection or approved OAuth grant. Admin counts on Feedback show visits → new accounts → those accounts with a first scene → those also connected to AI, regardless of connection order. Existing accounts before tracking are outside this cohort. No manuscript text, prompts or IPs in analytics rows; no external analytics. Savepoint-isolated telemetry failures preserve author operations (`domain/site/funnel.py`, `db/plugin.py`, `domain/auth/{controller,oauth}.py`, `domain/ai/controller.py`, `web/src/api/visitor.ts`). Migration `a4e8c2d6f901` follows `d9e4b2c7f1a5`; not applied manually or tested locally.
- [x] T38 (6ee1aac, 3a0d4da; built, awaiting user's prod check; no local tests by request) Product feedback only: signed-in `/feedback`, a message with optional bug/suggestion/other category, private storage and admin-only latest-feedback list. Story review/commenting remains separate (Evaluate / T24). Navigation and public refresh path added; admins see funnel counts on the same page (`domain/site/feedback.py`, `web/src/pages/Feedback.tsx`). Same migration as T37.
  - Follow-up built: Feedback is the rightmost navigation link with a subtle theme-colored pill. The existing `/mcp` server has `product_feedback(message, category?)`, which only submits through the same validated/private REST endpoint and returns an acknowledgement/id. Valid connections can submit without selecting a story or requesting manuscript-edit permissions; no feedback-reading/admin APIs are allowed for delegated clients (`web/src/App.tsx`, `web/src/index.css`, `api/src/storytool/{mcp_server.py,domain/auth/access.py}`). Awaiting user's prod check; no local tests.
- [x] T39 (e9d88ff; marked complete per user 2026-10-13; no local tests) Author name/pen name in Settings, separate from Google profile name. Browser-owned `/api/auth/profile` saves/clears it; all manuscript exports use it as byline, with Word/EPUB/HTML/PDF author metadata. Blank means no byline or automatic real-name fallback. Migration `b6f0d8a2c413` adds nullable `app_user.author_name` after `a4e8c2d6f901`; not applied manually or tested locally (`domain/auth/{models,controller}.py`, `UserSettings.tsx`, manuscript export modules).

**User feedback — tasks only (2026-10-12)**

- [x] T49 (b132427; built; awaiting production check) Evaluate's visible copied prompts now explicitly use search_story and read_scene_prose: MICE input filling, value-shift/misbelief input assistance, and AI reviews. Distinguish Exact/Related, handle indexing/limited coverage, verify scene evidence and refresh the package if the story changes. Roadmap updated. No local tests/builds.

- [x] T48 (526241b; built; awaiting production check) Search integration: read-only MCP `search_story(q, context, mode, story_id?, field?, entity?, offset, limit)` forwards to scoped REST search, returns bounded excerpts/pagination and exact/related mode. Connect AI explains passage retrieval. Existing AI Evaluate packages gain scene evidence for thread setups/payoffs, character misbeliefs, scene goals/outcomes and motifs (12 queries, five hits per mode/query; skipped/paginated coverage explicit). Meaning embeddings batched once, no read lock held across provider requests; disabled/indexing/unavailable meaning search does not block reviews. Story fingerprint rechecked after retrieval. MCP packages include prose evidence only with prose:read; report reads require prose permission because evidence may quote prose. UI results show Exact/Related labels. Roadmap updated; no local tests/builds.

- [x] T47 (8836138; built 2026-10-13; awaiting production check) Requested site-guide batch: Privacy names Cloudflare and discloses background embedding of prose/story details and query embedding only while meaning search is enabled (provider hostname/enabled flag verified read-only). Homepage Yours to keep lists Word/Markdown/PDF/EPUB/HTML/plain text and Word import; one Search card links to How to use. How to use covers Type/Field filters, Related meaning matches, exports/import, and explicit Step 1–5 numbering. Connect AI uses a native /#mcp anchor with layout-time fragment scrolling. Sleeping-server notes removed; current domain retained per user. Roadmap Delivered updated. No local tests/builds; no deployment triggered.

**2. Landing page touch-ups — T40**
- [x] Update "Yours to keep." Add EPUB, HTML, plain text, PDF and Word import. Built in T47; awaiting production check.
- [x] Point the Connect AI nav link at the MCP section, not the top of the page. Built in T47; awaiting production check.
- [~] Built 2026-10-14; awaiting production confirmation: added Misbelief at midpoint and Value shift versus prose to the craft section.

**3. Roadmap — T41**
- [x] Misbelief and Value shift added to Delivered on 2026-10-13; awaiting production confirmation.
- [~] Updated 2026-10-14; awaiting production confirmation: current remaining cards are Scrivener support, Latin-script language support and shared-story view counts; sandbox and images have shipped. DOCX import, search, beta readers/commenting and PDF export remain in Delivered; this batch added to Delivered.

**4. Evaluate tab polish — T42**
- [~] Already implemented in all three input/review buttons: native tooltips explain missing provider connections or missing inputs. Retained; awaiting production confirmation.
- [~] Built 2026-10-14; awaiting production confirmation: "Story edited since this review. Re-run?" with assistant re-run (when connected) and an agent-prompt action.
- [ ] Draw thread nesting visually instead of printing <Idea><Event> tags. Grouped with T54 Jev MICE evaluation; do not count as a separate implementation task.
- [~] Built 2026-10-14; awaiting production confirmation: one-line MICE and misbelief definitions credit Orson Scott Card / Mary Robinette Kowal and Lisa Cron.
- [~] Built 2026-10-14; awaiting production confirmation: current and historical reviews use dates such as "12 Oct 2026, 2:09 PM" in the viewer’s local time.
- [x] (08dd32f) Refresh reports automatically: every 15 seconds while Evaluate is open, plus on window focus. Manual refresh retained (`web/src/components/StoryEvaluation.tsx:207`); awaiting production confirmation.
- [ ] Add an all-checks summary with a Run all button.
- [~] Built 2026-10-14; awaiting production confirmation: scene findings retain exact scene selection; thread and character review links now scroll to and focus the specific item in Plan. Story-wide findings open the story plan.

**5. Bigger bets (later)**
- [ ] T43 Package the authorship report as a shareable summary for AI disclosure to agents, publishers and contests.
- [ ] T44 Series bible: shared characters, places and glossary across books.
- [ ] T45 German, then Spanish: a localized interface, plus a per-story language setting passed through MCP so the AI stays in that language.
- [ ] T46 Monetisation: an early-supporter lifetime deal through Gumroad or Paddle once beta feedback settles.

**Authorship percentages — requested 2026-10-14**
- [ ] T50 Show current manuscript word percentages attributed to human writing, AI (app assistant + MCP, with an optional breakdown), and unknown origin (pasted/imported text or text predating tracking). Effort: High. Existing authorship records identify field edits, not retained words; accurate percentages need text-span attribution across typing, paste, AI edits, deletion, undo and restore. Preserve mixed origins when part of a scene changes; do not label a whole scene human after a small manual edit. Percentages cover current prose and total 100%; describe them as tracked provenance, not AI detection. Keep unknown text unknown unless reliable origin evidence exists. Related to T43, but separate from the shareable disclosure summary.

- [~] T23 image library follow-up (2026-10-14): dedicated story Images route with All/Manuscript/Reference/Unused filters, named captioned thumbnails, editing/deletion and chapter/scene/planning usage links. Existing insertion and attachment pickers retained. Privacy explains image storage, sharing, retained history and permanent-story cleanup. Awaiting production confirmation; no tests/builds or browser checks.

- [~] T23 contextual insertion follow-up: removed passage Insert image link; right-click/Shift+F10 offers insertion and Cut/Copy/Paste/Select all. Compact picker preserves the chosen position, inserts saved thumbnails directly and supports upload preview/progress/cancel/retry. Scene Design and Catch up show manuscript/reference thumbnails and scene-filtered library links. Guided-tour step 2 opens an interactive insertion sample; guide and Delivered updated. Awaiting production confirmation; no tests/builds/browser checks.

- [~] T23 Write thumbnails follow-up: raw manuscript image markers now display as in-place thumbnail widgets with name/caption, enlarged preview and placement-only removal. Saving/export markers retained; duplicate previews below the passage removed. Guide and Delivered updated. Static checks only; awaiting production confirmation.

- [~] Write menu: Find emojis opens https://emojidb.org/ in a new tab, with arrow-key navigation retained. Awaiting production check.

- [~] T51 Shared Jev Noticing (built; awaiting key configuration and production confirmation): enable Jev-based story Noticing for all users using the owner’s shared Jev credential rather than requiring individual connections. Implementation must add a server-only Render environment variable for the owner to populate; never expose its value to clients, logs or documentation. Shared Jev now takes priority over personal reader connections when the site key is configured; existing authoring connections stay unchanged. Noticed identifies the site-provided reader. Render TYPESAFE_API_KEY added with REPLACE_WITH_YOUR_JEV_KEY (ignored until replaced); STORYTOOL_NOTICING_BACKEND set to jev. Uses the existing server-only key setting. Read prose remains on demand with deterministic fallback. Privacy, guide and Delivered updated; no tests/builds or manual deployment.

- [~] Page link previews: server-rendered Open Graph/Twitter tags and distinct branded PNG thumbnails for Landing, Your stories/Library, Roadmap, Shoutouts, Feedback and How to use. Enabled, non-trashed public showcases use public titles/blurbs and their first valid manuscript illustration; private routes use generic Stories cards. No private metadata exposed. Awaiting production/social-client confirmation; no tests/builds/browser checks.

- [~] T23 upload follow-up: shared browser preparation downsizes large JPEG/PNG/WebP files to WebP at up to 2,400 px before upload, retaining aspect ratio/orientation, retry/cancellation and the 5 MB server cap. Both upload flows accept original files above 5 MB and softly prompt for optional alt text. Awaiting production confirmation; static checks only.
- [ ] T52 Latin-script language support: added to Upcoming per user request; improve language-aware handling of accented text and punctuation. Roadmap/task documentation only; no language feature implemented.

## Jev expansion — requested tasks, not implemented (2026-10-14)

These tasks are derived from the user-supplied plan. Model limits, pricing, claimed latency,
SDK mock support and provider retention policies are planning assumptions to verify during
T53; they are not verified product promises. Keep existing shipped Jev Noticing (T51) separate.

- [ ] **T53 — Shared Jev foundation (High).** Ask one scene and many atomic typed questions per call; combine answers in code. Cache answers by scene content hash plus model, question/rubric version and relevant context/options/mode, so changed story inputs cannot reuse stale answers. Handle the proposed state/request token caps, scene chunking and choice-option ceiling; use staged scoring/selection for oversized option lists. Add shared-key spend/rate controls per user and for anonymous /try, bounded parallel calls, timeout/fallback and latency measurement from Render/India. Verify the direct TypeSafe API's retention policy before updating privacy claims; verify pricing/limits and whether the SDK's mock evaluation model supports offline threshold checks. No dependency on users supplying keys for shared features.
- [ ] **T54 — Craft evaluation and uncertainty cascade (High; depends on T53).** Run the four existing craft checks on scene-level Jev answers: scene/sequel classification, value pairs and start/end charge, thread opens/closes, and protagonist misbelief. Aggregate runs, shifts, the MICE stack and the midpoint curve in code; add setup/payoff matching and character/place continuity. Winning option descriptions become prewritten hints, not generated prose. High-confidence findings display directly; uncertain findings offer Verify with your AI, sending only the relevant scenes/evidence to the author's Claude/ChatGPT flow. Include visual MICE nesting from T42. Findings remain advisory, not automatic story changes.
- [~] **T55 — Live writing hints, including /try (High; depends on T53).** About two seconds after typing stops, assess only the current scene for POV/tense slips, showing/telling, dialogue beats, unknown names and the scene's turn. Use paragraph-level scores where needed, discard stale responses after edits, and show dismissible margin notes without touching prose. Demonstrate live hints in The Last Lantern without signup or a personal key, under the anonymous limits from T53. Sub-second responses are a target to measure, not a guarantee.
- [~] **T56 — Mode-aware ladder nudges (Medium; depends on T53).** Use small rubrics for premise specificity, stakes/cost and readiness gaps. Include Plotter/Hybrid/Pantser in context so questions can be stricter for Plotters. Show amber only when the gap is likely; low-confidence results remain quiet, particularly in Hybrid mode. Keep nudges advisory.
- [~] **T57 — Beta feedback triage (Medium; depends on T53).** Classify comments as confusion, pacing, character, typo or praise; score severity and summarize repeated concerns by chapter, such as multiple readers reporting confusion. Count distinct readers accurately, preserve original comments and their private access boundaries, and present classifications as suggestions.
- [~] **T58 — Related-search reranking (Medium; depends on T53).** Score relevance of already-retrieved Related passages against the query. Rerank within the existing authorized result set; preserve literal matches, pagination/coverage and usable results if Jev fails. Include query/context in cache keys rather than treating this as a scene-only answer.
- [~] **T59 — Outline mismatch detection (Medium; depends on T53).** Ask whether each outline still matches its scene before a Catch up LLM call. Mark likely stale summaries/beats with uncertainty, reuse unchanged answers, and retain the staged-proposal/author-approval flow. Include outline changes in cache invalidation.
- [~] **T60 — Calibration and feedback labels (Medium; depends on the relevant Jev surfaces).** Record dismissals/acceptances as labels linked to the check/model/rubric version, and tune thresholds from aggregate outcomes. Do not treat confidence as a guarantee about an individual answer. The supplied plan proposes competing thresholds (0.75 for cascade, 0.7 for hints, 0.8 for nudges, 0.85 for Evaluate); reconcile them by check and visibility, then make them configurable. Use offline/mock cases if the SDK supports them; do not bill network calls merely to unit-test threshold logic.

**Suggested sequence:** T53 → T54 → T55 → T56 → T57 → T60. T58 and T59 can follow
once T53 is ready. Validate the T52 languages before marketing multilingual Jev checks.

### Jev execution plan — active

- T53.1: provider-neutral question/answer validation, Jev and compatible local adapters, reusable HTTP connections. No SDK types in evaluation contracts.
- T53.2: persistent per-question cache and independent atomic budget reservations; wire shared Noticed into the service. Hash state, context/rubrics and provider/model; no raw prose/key in cache or usage rows. Validate migration on an expiring Neon branch.
- T54: implement scene evidence and aggregators in a separate evaluation provider; then add Evaluate display/visual MICE and the uncertain-scene Verify workflow in a second commit.
- T55: saved-story hint API/cache and stale-response protection first; then margin UI and protected anonymous sandbox access.
- T56: rubric scoring first, then mode-aware quiet nudges.
- T57: private comment classification first, then distinct-reader/chapter summaries.
- T58: bounded Related-result reranker with retrieval fallback, Exact results preserved.
- T59: outline-aware mismatch cache and indicators, retaining staged Catch up proposals.
- T60: acceptance/dismissal labels and configurable per-check thresholds; offline threshold verification only when allowed.

T53 verification sources (2026-10-14): [official model limits/pricing](https://docs.typesafe.ai/models)
and [direct API privacy policy](https://typesafe.ai/legal/privacy-policy). The documented 32k
limit includes state plus the longest question; 64k includes all questions. Price is $0.042
per million input tokens, output free. Direct API policy forbids training on Input; it does
not promise general zero retention. [Enterprise ZDR requires account setup](https://typesafe.ai/enterprise).
No live model calls/latency measurements or local tests/builds have been run.

T53.1 pushed as `88000fd`. T53.2 adds persistent per-question cache and atomic user/global
budget reservations in separate transactions, independent of author writes/checkpoints.
Cache includes actor/provider/model/state/rubric; alias requests have a short TTL. Network
responses are validated against closed options and bounded probabilities. Oversized states
fail safely rather than silently truncating prose; request packing uses conservative byte
ceilings below documented token limits. Large choice sets can score candidates before a
bounded final choice. Shared Noticed uses the service; compatible local models use the same
contract. Anonymous actor controls are ready for T55's protected sandbox endpoint, which is
not yet implemented. Actual tokens, failures and round-trip duration are recorded without
raw prose/keys; no billed latency measurements were made during development.
Migration `b2f7d4c9e503` applied and column counts verified on expiring branch
`br-floral-pond-b4o21270` (expires 2026-10-14 13:09 UTC), never production. Static checks only;
no local tests/builds or manual deployment. T54–T60 remain pending. Each UI task needs the
user's production confirmation.

T54: shared typed reader is primary Run for four craft checks; outline checks and deep-review
packages retained. Added authored-thread setups/payoffs and cast/place continuity. Atomic
scene answers drive rhythm runs, value charge, certain MICE stack/spans and word-positioned
misbelief curves. Missing metadata/coverage and uncertainty are explicit. Native verification
uses selected scenes (up to 20) and implicated thread/protagonist-belief subjects only; the
user explicitly approved this extra context after automatic review rejected a broader payload.
Foreign IDs/changed stories are rejected; reports are saved for re-entry. Copy prompts support
external clients. No author locks held across calls. Static checks only; no tests/builds, billed
calls or manual deployment. T55 onward remain pending.

T55 built: opt-in compact hints beside the active scene (stacked on narrow screens), two-second
debounce, draft-only payload, stale-response suppression and local hash-bound dismissals.
Same UI in /try; signed server-issued cookie, bounded socket-peer requests/issuance and
persisted anonymous/global spend caps. Known names only accompany the current scene; long
scenes fail explicitly rather than truncate. Atomic POV, tense, dialogue, unknown-name and
turn questions plus paragraph showing/telling scores. Provider-neutral service; prose untouched.
User approved placement and opt-in default. Static checks only; production UX/latency pending.

T56 built: cached four-level atomic readiness rubrics, mode-aware instructions, amber only
when gap probability and confidence reach 0.8. Weak evidence is neutral; Pantser makes no
scoring calls. Fixed minimum-count gates no longer drive the ladder UI. Every level remains
reachable. User explicitly approved premise, character goals and outline-summary transfer
after automatic approval rejected the broader initial payload. No prose/private notes sent.
Static checks only; awaiting production confirmation.

T57 built: per-comment cached category/severity questions, submitted reader messages only,
owner-only access, no reader identifiers/quotes/manuscript sent to the provider. Distinct-reader
chapter/category counts exclude uncertain answers; changed feedback rejects the result.
Approved inline Group feedback controls filter the original conversations and label scores.
These are code-generated counts, not Jev-generated prose summaries. Static checks only;
production confirmation pending.

T58 built: batch relevance scores over the bounded Related result page (story and Library),
short title/excerpt payload, per-question cache and shared budgets. Exact search unchanged.
All candidates and pagination preserved; weak scores/provider failures retain original order.
Also corrected T55 panel borders to the existing theme token. Static checks only; no network
model calls or local tests/builds. Awaiting production confirmation.

T59 built: per-scene cached outline-match and assigned-beat nouls before the deep catch-up
call. Only scene prose plus its assigned summary/cast/place/POV/beat definitions are sent.
High-confidence mismatches flag named stale beats; uncertain/unavailable coverage is explicit.
A confident match removes the timestamp-only catch-up reason. Full-scene status/reason maps
prevent omitted worklist pages looking clean. Existing staged proposals and apply guards stay
in place; read results mark concurrent changes stale. Static checks only; awaiting production
confirmation. T60 remains.

Evaluate follow-up: removed generic “The scene reading is uncertain” finding cards. A low
confidence answer alone offers no revision or verification target; uncertainty now remains
on concrete craft observations. User's production example exposed the unhelpful card.
Awaiting production confirmation; no local tests/builds.

T60 built: Useful/Dismiss actions on live hints and Evaluate findings, linked to cached
answers verified against the current user or signed sandbox session. Repeated labels upsert
once per answer unit/check; numeric labels survive answer-cache expiry, with 90-day reports
and bounded older-label cleanup. No prose, keys or reader-comment bodies in labels. Admin
Feedback page aggregates by provider/model/rubric/check; suggestions need >=100 signed-in
labels and >=5 reviewers, exclude anonymous evidence and never silently change or lower
policy. These are preference labels, not objective correctness claims. Model/rubric-scoped
JSON thresholds support future local models without carrying Jev calibration across them.
Defaults reconciled: hints .7, nudges .8, craft findings .85; beta grouping .75 and Related
scoring .7 have separate configurable checks. Rubric versions must be bumped when check
instructions/aggregation change. Migration c4e9a1b7d602 applied on expiring test branch
br-floral-pond-b4o21270 only; cache=11 columns, feedback=13. No production SQL, billed model
calls, local tests/builds or manual deployment. Production UX/latency and threshold tuning
from future real feedback remain unverified. T53–T60 implementation is built, not user-confirmed.


- [~] T54/T55 usefulness fix: value charges now assess the same selected value at both ends, with a meaningful-change guard against flat-scene warnings. Findings show observations, quoted passages and next steps; passage links open Write. Live hints read bounded sections instead of rejecting ordinary scenes by paragraph count, preserve partial results, and require a located passage before displaying an issue. New craft-v2/hints-v2 rubrics separate feedback from earlier readings. Static checks only; production quality and UX await user confirmation.

- [~] Evaluate finding-card design: tighter spacing, inline confidence and a single wrapping action row; Useful/Dismiss use accessible icons. Existing evidence, passage links and verification actions retained. Awaiting production visual confirmation.

- [~] Evaluate findings use a keyboard-focusable vertical scroll area capped at half the viewport height; shorter lists keep their natural height. Awaiting production visual confirmation.

- [~] Live hints stay sticky beside the active scene on the right, with bounded internal scrolling and a focus-mode offset. Narrow layouts retain the right column. Awaiting production visual confirmation.

- [~] Live hints add contextual coherence: flag an unrelated sentence only after confident scene/paragraph and sentence selection; quote source text with an existing passage link and advice. Connected memories, metaphors and intentional digressions are allowed. Uses provider-neutral typed decisions and hints-v3 feedback. No beat/plot/arc context added. Static checks only; model quality awaits production confirmation.

- [~] Coherence refinement: assess each sentence against its surrounding paragraph, using scene context and allowing connected digressions; hints-v4 separates the changed rubric. Awaiting production quality confirmation.

## T61 — User-built typed validators (High; foundation built)

- Goal: any signed-in user can build private advisory checks without writing code, and enable or disable them for themselves. Use the existing provider-neutral reader so Jev can later be replaced by a compatible local model.
- Simple form builder: name, question, input scope (sentence/paragraph/scene or explicitly selected planning context), answer type (yes/no probability, choice or rubric score), option/level descriptions, finding condition and confidence threshold, advice, and enabled state. Offer templates and a sample preview before saving; no prose rewriting.
- Validator CRUD: persisted, owned, versioned definitions and per-user enablement; expose create/list/get/update/delete through the API and MCP tools with existing ownership and scope protections. Validate bounded questions/options/rubrics and allowed input fields; no executable user code or arbitrary data access.
- Iteration 1: author and run custom coherence checks using current-scene text, supporting passage links, saved advice and Useful/Dismiss feedback. Then convert all current Jev-backed checks (Noticing, Evaluate, live hints, ladder, beta triage, Related reranking and Catch up) to the same definition format as built-in templates. Preserve each surface's behavior, permissions, approved context, budgets, cache and feedback; keep cross-scene aggregation such as MICE stacks in application code.
- Definition edits invalidate cached answers by version/hash; changing an enabled validator must not reuse old findings. Built-in templates retain stable identities; personal edits use private copies.
- Acceptance: a nontechnical user and an MCP client can both manage a validator; only its owner can edit it; disabling it prevents further runs; a custom check shows source evidence without editing prose; migrated built-ins retain existing behavior.
- Current state: private saved definitions, API/MCP CRUD and the simple form builder are built. Execution of custom checks and migration of existing checks remain pending; current checks retain their existing behavior.

- [~] Live-hint card design: disclosure under About live hints, highlighted source passage, quieter advice and one wrapping row for the passage link plus Useful/Dismiss icons. Reading/error/retry and feedback behavior retained. User screenshot confirms the apple sentence was detected and highlighted; new design awaits production confirmation.

- [~] Evaluate visual refinement: findings capped at 56rem width/45vh height, surface-filled cards with colored status borders/badges, separated action footer and accented scene links. Redundant nesting verification sentence is represented by the Verify badge/actions. Awaiting production visual confirmation.

- [~] Value-shift readings explain inferred safety/trust/belonging/freedom/control/understanding changes and give revision questions; scores and reader metadata move into optional details. Tentative readings are labelled, and similar conditions are not treated as proof of a flat scene. Existing scene navigation retained. Awaiting production quality/visual confirmation.

- [~] Evaluate uncertain findings grouped under a collapsed Needs verification section with a count; confident findings remain visible and both groups retain bounded scrolling, evidence and all actions. Awaiting production visual confirmation.

- [~] Thread names in Evaluate findings are bold accent-colored links to the associated scene, preserving existing scene/verification actions. Hint-panel movement paused without changes. Awaiting production visual confirmation.

- [~] Live hints use a fixed overlay aligned 12px inside the writer outer right edge, including focus mode; prose no longer reserves a hint column. The overlay tracks scroll/resize, stays below navigation and scrolls internally. Existing reading, feedback and passage actions retained. Awaiting production visual confirmation.

- [~] Live-hint overlay clears the Write toolbar, placing it below the Live hints button while retaining right-edge alignment and scroll behavior. Awaiting production visual confirmation.


T61.1 foundation built: `domain/decisions/validators.py` defines sentence/paragraph/scene
questions, typed noul/choice/score triggers, probability thresholds, advice and personal enabled
settings. Owner-filtered CRUD returns version/hash metadata and paginated lists; edits/deletes
lock the definition and reject stale expected_version with 409. New MCP list/get/create/update/
delete tools use validators:read/write scopes; OAuth consent is explicit and unchecked by default.
Existing/manual tokens gain no validator access. Saving/enabling definitions makes no model calls;
execution and the builder are not wired yet. Definitions are provider-neutral and never executable.
Migration d7a2c9e5f103 creates the indexed nine-column table; migration-generated DDL applied
successfully only on temporary Neon branch br-orange-haze-b49hmvy8, expiring 2026-10-14 16:00 UTC.
No production SQL, local tests/builds, billed model calls or manual deployment. App/OpenAPI import,
Ruff, TypeScript and scoped frontend lint passed. Production CRUD/consent confirmation pending.


- [~] T61.2 form builder: dedicated `/checks` page linked from Settings, saved/paginated private checks, named edit/save/delete actions and enable preferences. Yes/no, choice and rating forms preserve option identities and validate triggering answers; templates and an appearance preview help authors start. Saving uses expected versions, preserves drafts on errors/conflicts, and provides reload; unsaved edits prompt on link navigation/refresh. Direct refresh is routed by the backend. Custom execution remains explicitly pending in the UI. Static TypeScript/frontend lint/Ruff checks only; no tests/builds, model calls or migration. Awaiting production visual confirmation.
