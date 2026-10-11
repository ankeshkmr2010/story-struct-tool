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

---

## Proposed order

1. **Tranche 1 — biggest change in feel**: header + Download menu (§1); sidebar regrouping (§1);
   remove prose duplicate in Design → Scenes (§2); developer text and Health noise (§3);
   token migration for the workspace shell (C1, partial).
2. **Tranche 2 — friction**: Read/Write clean-ups and library cards (§3); first-run path and
   jargon (§4); merge timeline renderers (C2); polling (C4).
3. **Tranche 3 — finish**: full token migration (C1); landing reorder (§4); dead code (C5);
   assistant decision (C6); mobile.

**Open decisions:** keep or remove the in-app assistant · approve the grouping above ·
pick the starting tranche.
