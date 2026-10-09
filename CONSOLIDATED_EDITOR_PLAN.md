# Consolidated writing workspace

Status: initial writing workspace implemented. The current workspace is retained under
Design, with a separate Write tab over the same data. Later structural operations below
remain a roadmap, not available controls.

The initial release provides continuous chapter presentation using growing per-scene
CodeMirror editors, optional chapter/scene titles, draft-first creation, scene breaks at
the end, next-chapter flow, collapsible navigation/context, Focus mode, serialized saves,
conditional prose writes, and browser-tab draft recovery. It remembers the tab and chapter;
cursor-position restoration, cursor-based splitting, merging, atomic/idempotent initial
creation, passage AI, and new MCP tools remain follow-up work. Browser-tab recovery uses
session storage scoped to the account and story; signing out clears those drafts.

## Outcome

An author opens a story, names a chapter if they want, and starts writing immediately. They can continue through scene breaks and into the next chapter without visiting a separate creation form. Planning, context, and AI remain available beside the manuscript.

The reading/writing order is chapter and scene order, not chronological event order. Flashbacks stay exactly where the author tells them; the global timeline continues to show when events occur in the world.

## Current friction

- `StoryWorkspace.tsx` starts every story on Premise. Chapters and Scenes are separate ladder views.
- A new scene inherits the chapter selected in the Chapters view. The author cannot see or change that selection directly in the scene creation flow.
- `SceneEditor.tsx` edits one scene at a time in a fixed-height, internally scrolling CodeMirror surface. Selecting another scene replaces the writing surface.
- Scene creation and metadata precede prose. The persistent ladder and insights panel consume manuscript space.
- Prose buffers live inside the scene component. Saving is debounced and a revision is requested on blur; the consolidated editor needs explicit handling for navigation, requests in flight, and server changes.

## Navigation and entry

Introduce primary story workspaces: **Write**, **Plan**, **Timeline**, and **Assistant**. Keep Versions and Export accessible in the story toolbar. The existing hierarchy becomes the Plan workspace rather than surrounding every writing session.

Write is a direct entry in every mode. Remember the last workspace, chapter, and cursor position per story on this device. On first open, Plotter can start in Plan and Hybrid/Pantser in Write. A visible Write action always allows drafting; readiness findings never prevent writing.

The library offers **Continue writing**, opening the remembered chapter. Opening a scene from a timeline, finding, or AI proposal navigates to that exact passage in Write.

## Writing flow

1. For an empty story, show an editable `Chapter 1` title and a manuscript placeholder: “Start writing your story…”. No scene name, act, POV, beat, or summary is required.
2. Do not create database entities merely because the page was opened. Persist a chapter on a committed title or the first prose save; create its initial scene when prose is first saved. Retain the draft while creation is pending and make retry idempotent.
3. A chapter is displayed as one continuous writing surface. Existing scenes remain separate records underneath it, with subtle boundary markers. There is no Save/Open action between adjacent scenes.
4. **Insert scene break** at the cursor splits the current passage and continues in the new scene. A scene name is optional and can be added later. Plain Enter always inserts a paragraph; typing `***` stays normal Markdown unless the author explicitly converts it into a structural break.
5. **Next chapter** below the manuscript adds an editable chapter heading and focuses the new writing area. Keyboard users can invoke the same action from a command menu. The previous draft is retained and saved during the transition.
6. Removing a structural boundary is an explicit **Merge with previous scene** action, with a preview of links and notes affected. Backspace at a boundary must not silently delete a scene or its history.
7. Existing unattached scenes appear under **Unfiled writing** in the navigator. They remain editable and can be moved into a chapter explicitly; opening Write must not silently reorganize an existing story.

## Layout and visual design

Desktop: a slim story toolbar, a collapsible chapter navigator on the left, and a centered manuscript. A context drawer on the right is closed by default. Use the current warm ivory/forest green theme and matching dark palette.

The manuscript has roughly 65–75 characters per line, comfortable serif prose around 18 px, and generous line spacing. Titles are edited in place. The page has one main vertical scroll instead of a short prose box with its own scrollbar. Long chapters use measured rendering/loading so typing does not require mounting an editor for every scene in the book.

The toolbar contains chapter navigation, save state, manuscript word count, Focus, and Context. Secondary actions live in a clearly labelled menu. Scene labels and boundaries are quiet; red warnings and completeness badges do not interrupt prose.

Focus hides the navigator, context, and general site navigation. A visible Exit focus button and Escape restore them. Word count/save state remain available.

Mobile: use the full writing width. Chapters and Context open in drawers rather than permanent columns; opening one closes the other. Account for the on-screen keyboard, safe areas, and comfortable touch targets. All actions work without hover or drag gestures.

## Context, structure, and authoring modes

The context drawer follows the scene containing the cursor, with its chapter identified at the top. Its sections are: **Scene**, **Chapter brief**, **Notes**, and **Suggestions**.

Scene exposes title, POV, characters, location, story time, goal/conflict/outcome, and links to beats, threads, and arc stages. Chapter exposes title, act, summary, POV, and chapter beat assignments. Defaults remain unassigned unless explicitly chosen; do not guess an act simply from the last act in the story.

Plotter can show the selected chapter's beat/arc brief by default in Context. Pantser starts with Context closed and offers optional inference after writing. Hybrid shows existing links and allows incomplete structure. The writing surface itself stays consistent across modes.

Separate draft status from structural completeness. “Missing POV and outcome” belongs in Context/Plan; a chapter containing prose should not be prominently labelled “placeholder” while someone is writing.

AI works on a selected passage, current scene, or chapter. Suggestions and proposed changes appear in the drawer; the author reviews before applying. Preserve the consent for sharing prose and the existing proposal/version workflow. AI-created changes must not replace a dirty local draft silently.

## Document model and APIs

Keep prose stored in the existing Scene records. A chapter is a composed view over ordered scenes, not a second editable copy of their text. This preserves current exports, timeline/arc links, revisions, whole-story versions, and MCP references.

Use a single chapter editor session with stable scene IDs and structural boundary metadata. Boundary labels are editor decorations, not saved prose. Persist changed scenes only. Implement the first slice using the current CodeMirror stack; evaluate a different rich text editor only if formatting requirements justify a migration.

Existing chapter/scene creation, ordering, metadata, prose, and brief APIs can support the initial workspace. Add an aggregate chapter-manuscript read if needed to avoid fetching every scene's content individually. Keep ownership and permissions enforced server-side.

Add transactional domain operations for starting a draft, splitting a scene, and merging scenes. Splits must partition text correctly, preserve reading order, and remap annotations. Notes spanning a split need an explicit preserved representation. Existing beat/thread/arc links remain on the original scene unless the author requests copies; location, time, and POV can be carried forward visibly. Timeline events pointing to a scene must be considered in the preview.

For a merge, retain the earlier scene ID and combine text in order. Preview link unions, differing POV/location/time, and event references; require choices where metadata conflicts. Preserve a recovery version, map annotations, and keep removed-scene history recoverable. Do not implement a merge as two unrelated client requests.

Before increasing editing concurrency, add conditional prose saves using an expected revision/hash checked under the existing story write lock. The current prose PUT has no client expected-version guard. Reuse the same checks for browser and MCP writes.

## Save and recovery behavior

- Keep draft state outside individual mounted scene editors, keyed by story and scene (or a temporary creation ID).
- Serialize writes per scene, coalesce pending edits, and never let an older response mark a newer draft as saved. “Saved” means all current edits were acknowledged.
- Show Saving, Saved, Offline/Not saved, and Save failed consistently; include Retry without dismissing the draft.
- Flush on explicit navigation and use a leave-page warning while unsaved. Do not depend solely on blur or an unload network request.
- Persist crash-recovery drafts in browser storage scoped to user/story. Explain that shared-device drafts remain on the device, clear on sign-out, and offer recovery/discard on return. Test privacy and storage failure behavior.
- When a refetch, another tab, MCP operation, or version restore changes server text, compare against the base revision. Preserve the local buffer and offer a comparison/recovery flow rather than resetting it automatically.
- Keep whole-story checkpoints and meaningful scene revisions. Split/merge/restore operations create a recovery version. An undo across a saved structural change must use the domain operation and its version checks, not just a local editor undo.

## MCP impact

No additional MCP endpoint is needed. Continue using the deployed `/mcp` endpoint. The browser uses authenticated app HTTP APIs; it does not call MCP to type or save.

Current MCP chapter/scene/prose tools remain compatible. Add tools for chapter-manuscript reading, scene splitting, and merging when those domain operations exist. They must share ownership checks, scoped permissions, conditional writes, previews, and recovery behavior with the app. Return affected scene IDs and a concise change summary so clients can continue coherently.

## Delivery order

1. **Writing workspace and save foundation:** Write/Plan navigation, chapter navigator, editable chapter title, continuous chapter surface, optional scene names, Context drawer, mobile/Focus layouts, draft retention, serialized saves, and conflict guards. Keep existing planning screens accessible. This slice must allow a brand-new story to receive prose without mandatory structure forms.
2. **Structural editing:** transactional start/split/merge operations, next-chapter flow, boundary keyboard behavior, annotation mapping, recovery checkpoints, and the corresponding MCP tools.
3. **Assistance and polish:** passage-based AI review in Context, writing-position restoration, efficient long-chapter rendering, and updated tutorial/help content. Later consider a whole-book writing view; the initial design keeps a chapter as the loaded editing unit.

Do not ship a visual redesign alone while leaving the one-scene selector workflow as the only writing surface. The first release must include continuous chapter writing and safe saving.

## Acceptance scenarios

- Create a fresh story, name a chapter or skip naming, and type immediately without supplying scene/beat/act/POV fields.
- Edit a seeded multi-scene chapter in order without changing a scene dropdown. Add a break and keep typing at the correct position.
- Advance to the next chapter without losing the last few keystrokes; a failed create/save retains the draft and retries without duplicate chapters/scenes.
- Navigate away during debounce/in-flight saving; handle slow requests, offline/reconnect, reload recovery, and another client changing the same scene.
- Existing timeline events, arc links, annotations, exports, revisions, and versions survive normal writing and reviewed split/merge operations.
- Keyboard and screen reader users can identify chapter titles/boundaries and perform every structural action; no trapped focus in drawers/Focus mode.
- Both themes remain legible on desktop and 320/390 px mobile widths, including when the software keyboard is open.
- Long chapters remain responsive. Record performance with an agreed manuscript-size fixture before claiming support for full novels in one editor.

## Recommendation

Build a continuous chapter manuscript with optional scene boundaries and a context drawer. Keep scenes as the underlying narrative units. Prioritize saving/recovery alongside the layout; exposing an AI tool is useful once the same operation is safe for a human editor.
