# StoryTool session entry point

At the start of a new session, read `MEMORY.md`, then `SESSION_HANDOFF.md`.
Read `CLAUDE.md` and follow its working rules; the user's current instructions take precedence.
For further context, read only the relevant sections of `.claude/context.md` and `UI_UX_AUDIT.md`.

Standing user rules:
- Keep token usage and replies lean. Read narrowly with `rg` and line ranges.
- Implement only the named scope. No extra scaffolding or opportunistic fixes.
- No side quests: do not add adjacent features, cleanup, roadmap/privacy copy, refactors,
  dependencies, or research unless the named task requires them. Necessary dependencies
  and API type generation are allowed only for that task.
- Use the minimum token pass: inspect only the files/functions needed, make the smallest
  change, and stop. Do not repeatedly reread, speculate, or broaden verification.
- "Add to tasks" or "mark done" means documentation/status edits only. Do not implement
  those tasks or change product pages. List unrelated findings briefly; leave them untouched.
- When the user says no local testing, run no tests or builds. Keep updates and final replies
  short; avoid repeated explanations and approval questions for already-authorized work.
- If intent, scope, or visual behaviour is unclear, ask first.
- The user does visual testing. No browser automation or screenshots; no subagents.
- Take one step at a time. Do not mark UI tasks confirmed until the user checks production.
- Check git state before editing/committing; preserve other agents' work.
- Push finished, authorized code without asking. The user handles manual Render deployment;
  do not trigger it unless explicitly requested. See the handoff's auto-deploy caveat.
- With every release, update `web/src/pages/Roadmap.tsx`: add shipped work to Delivered
  and update or remove its upcoming cards. Include this in the release before the final push.
- Never copy credentials into memory, tool output, commits, or chat.

Import UX retrospective (2026-10-13):
- I dismissed the user's separate-page concern and shipped a transient, disconnected panel.
  Design the complete flow: start, progress, named result, next actions, dismiss, re-entry.
- Essential actions must remain reachable after navigation/refresh; preserve imported-story
  context and identify imported stories visibly. Do not optimize only for a small code diff.
- Excess investigation and adjacent copy edits compounded the cost. Keep the minimum-token
  pass and named scope; record unrelated feedback as tasks rather than implementing it.
