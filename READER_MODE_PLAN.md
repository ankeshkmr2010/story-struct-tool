# Reader mode

Provide a read-only Read tab beside Write and Design, and the same reading surface for
shared stories. Both use the current saved manuscript in reading order, with unfiled
writing at the end. Changes in Write are flushed before opening Read.

The manuscript is continuous across chapters. Chapters and linked timeline events jump
to a passage rather than replace the document. Context remains a separate optional panel
for beats, arc stages, people, and places. Reading never mutates prose or structure.

Reading tools: scroll/pages selection, serif/sans font, 14–30 px size, relaxed/normal/wide
line spacing, text width, progress, chapter navigation, and Focus. Preferences persist on
the device. Reading positions store only passage IDs and offsets, scoped to the signed-in
account and story; manuscript text is not saved in browser storage.

Paged reading uses browser-measured CSS columns and a bounded viewport, with previous/next
buttons and ArrowLeft/Right or PageUp/Down while the reading area has focus. Font, spacing,
width, and viewport changes remeasure pages and retain the current passage where possible.
Normal links and interactive controls keep their native keyboard behavior. Escape exits
Focus and closes reading side panels.

The active workspace polls a lightweight story activity token every five seconds while
visible, then refetches story queries only when that token changes. The same applies to
shared reading, with permission rechecked on each poll. Unsaved prose uses serialized,
conditional saves; a conflicting remote edit opens a review flow instead of replacing the
buffer. Focused metadata inputs retain edits during refetches. Library lists also poll.

Saved sort_key controls chapter/scene order. Equal chapter keys fall back to chapter number,
then ID; equal scene keys fall back to ID. Design, Write, Read, exports, and move placement
use the same order. Explicit reordering remains authoritative even if chapter labels have
not yet been renumbered.

Owned reading uses an authenticated GET endpoint; shared reading keeps existing sharing
checks. Neither grants additional write/import rights. The owned reader endpoint requires
prose permission for MCP bearer access. Private annotations, old versions, and AI activity
remain outside the reading document.

Validation: continuous chapter transitions, visible prose preservation in both layouts,
page reflow and navigation at desktop/mobile widths, preference/position restoration,
Focus/Escape, context alignment, permission denial, shared-import controls, and existing
writer/library workflows. Deploy the app update; no database migration is needed.
