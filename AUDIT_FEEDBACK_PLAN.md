# Audit feedback changes

Confirmed against current code: unconditional character need/completeness, missing plain
reference fields, generic sample goals/conflicts, planned event contradictions, rigid
readiness counts, and no field-level authorship. Recent scene-delete controls address part
of the deletion finding; timeline event deletion and agent delete proposals still need work.

- Share one role/arc-aware character requirement rule between completeness and health.
  Name/role identify every character; want/need are required for protagonists, antagonists,
  and positive/negative arcs. Wounds remain optional; no invented backstory.
- Add description, aliases, relation to protagonist, notes, minor role, scene notes,
  and story-level world/style rules and theme/motifs. Expose them in UI, schemas, snapshots,
  imports, and MCP so they need not be stuffed into premise/summary/voice.
- Treat planned/unwritten work as information rather than contradictions. Permit partial
  act scaffolds to reach beats; compute readiness coherently across prerequisites.
- Provide version-backed event deletion, and deletion in staged agent operations with
  explicit inspection/apply and recovery checkpoints. Do not delete Echoes entities from
  the audit's unspecific "safe to delete" count.
- Record field authorship from authenticated writes and applied proposals. Show author,
  assistant/MCP, restore, import/system origins without treating pre-existing content as
  proven human text. Keep private authorship history outside shared exports.
- Remove generic goal/conflict generation from future samples. Keep unknowns unknown;
  do not silently overwrite user-edited sample stories or Echoes.
- Direct agents to the lightweight state/fingerprint read instead of full editorial context
  when they only need a fresh write guard. Preserve permissions and stale-plan checks.

Ship additive migrations, test on a Neon branch, verify roles/readiness, copy/restore,
provenance, deletion rollback, and UI forms, then deploy. Existing prose is preserved.
