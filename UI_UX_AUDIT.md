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
- [ ] T3 Design → Scenes: drop the prose editor; show the scene card + "Open in Write". `web/src/components/SceneEditor.tsx`, `StoryWorkspace.tsx`. Needs D1.
- [ ] T4 Health panel: plain wording, no rule codes, quiet warning style, per-finding "Fix in <level> →" link, count badge on the tab. Fixes the turning-point confusion (§6). `api/src/storytool/domain/health.py` messages + the health panel component.
- [ ] T5 Readable option labels with one-line descriptions for POV / Framework / Mode, plus one reusable ⓘ help component; then apply it to jargon (levels, beats, threads, turning points, pantser/plotter). `StoryWorkspace.tsx:354-355`.
- [ ] T6 Replace "Live · checks for changes every 5 seconds" with a quiet dot that speaks only on change; remove Read's "Refresh story".
- [ ] T7 Token migration for the workspace shell (header, sidebar, panels): Tailwind palette classes → `index.css` tokens (C1, partial).

**Tranche 2 — friction**
- [ ] T8 Read: no repeated blurb; context panel closed by default. `SharedStoryReader.tsx` (`StoryReader`).
- [ ] T9 Write: collapse empty Epigraph / Opening / Closing note into "+ Add epigraph / note". `StoryWriter.tsx`.
- [ ] T10 Library cards: Delete into a ⋯ menu; last edited + word count instead of the "complete" bar; mark examples/tutorial; New story ▾ (Blank / From backup); on-palette tutorial CTA. `web/src/pages/StoryList.tsx`.
- [ ] T11 First run: "Start with the demo" card; empty state per tab saying what it is for.
- [ ] T12 One shared read-only timeline component for app / shared reader / showcase (C2).
- [ ] T13 Polling: library 5 s → refetch on focus or 30 s (`StoryList.tsx:45,47`); same for workspace activity (C4).
- [ ] T14 (parked, D3 = later) "Generate" entry points after Design and in Chapters/Scenes (§6).

**Tranche 3 — finish**
- [ ] T15 Full token migration + new dark palette (C1). Needs D4.
- [ ] T16 Landing: reorder to write → plan → share; sell the public showcase.
- [ ] T17 Dead code: `api.listAIObservations`, unused exported types in `web/src/api/client.ts` (C5).
- [ ] T18 Make the in-app assistant discoverable: own ASSISTANT sidebar group, obvious "add your API key" step (`AuthoringAssistant.tsx`, `UserSettings.tsx`).
- [ ] T19 Mobile pass.
- [ ] T20 Audit the parts not yet walked: Story timeline in depth, Settings, MCP setup.
