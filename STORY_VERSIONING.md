# Whole-story versions

Open **Versions** beside **Export .md** in a story header.

- **Save named version** freezes the current saved story with a label.
- Automatic checkpoints are created during edits, at most once per minute.
- The latest 50 automatic checkpoints are retained. Named, initial, restored,
  and recovery versions are retained, including while a story is in Trash. Permanent deletion
  from Trash removes the story and its versions from the active database.
- AI apply/undo batches get additional checkpoints before and after changes.
- Existing stories get their first baseline immediately before their first
  versioned edit. The feature does not reconstruct edits made before deployment.

A version contains story fields, characters, relationships, arcs and stages,
acts, beats, threads, chapters, scenes and prose, locations, events and timeline
ordinals, scene/beat/thread/arc links, cast mentions (including rejected ones),
annotations, scene prose revisions, and persisted suggestions/dismissals.

Account ownership, fork lineage, sign-in sessions, provider connections/API keys,
agent tokens, AI conversations/proposal activity, and other whole-story versions
are outside the snapshot. Reader observations are cleared on restore and can be
regenerated; health, continuity, chapter briefs and word counts are derived again.

Select a version for a before/after preview, then choose **Restore this version**.
The current saved draft is first frozen in a recovery version. Restore atomically
replaces the story graph, preserving entity IDs and restoring deleted entities and
their links. An edit after preview causes a conflict; refresh the preview to proceed.
Existing AI plans/undo batches are superseded because they refer to a different
working graph. Conversation history is kept.

Checkpoints and authored writes share one database transaction. A checkpoint
failure rolls back the edit and returns an actionable error; restore failures
roll back both the graph replacement and the recovery entry.

Automatic checkpoints are not one snapshot per keystroke and do not replace an
external backup. Save a named version whenever you want an exact milestone.
Only data saved to the server is included.

API: `/api/stories/{story_id}/versions` (GET list / POST named snapshot),
`/{version_id}/preview` (GET), `/{version_id}/restore` (POST with the preview's
`expected_fingerprint`). All routes enforce the story owner's authenticated session.

Migration: `a3b47d98e612` adds `story_version`; no existing authored tables are
rewritten. Versions use schema format 1 to support future snapshot migrations.
