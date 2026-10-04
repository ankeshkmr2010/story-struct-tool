# StoryTool — Design

A structural planning and writing tool for fiction. Authors build a story from premise
down to scene, and the tool guarantees that **nothing is ever created cold**: each level
is pre-scaffolded by the level above it, and every lower entity carries upward references
to what it fulfills.

The payoff: opening Chapter 7 shows a brief — its act, the beat it owes, the arc it
advances, its thread, its emotional shift — computed entirely from relationships, with
no duplicate data entry.

---

## 1. Core principles

1. **Flagged, never blocked.** Any entity can be created at any time, incomplete.
   There is no "placeholder" type — a placeholder is simply an incomplete entity.
2. **Gating is advisory and computed.** The API never refuses a write for structural
   reasons. `readiness` is a derived property the UI chooses how strictly to honour.
   This is what makes the three authoring modes one engine instead of three products.
3. **Derived state is never stored.** Completeness, readiness, `is_fulfilled`,
   word counts, arc current-stage and story status are all computed. Stored copies drift.
4. **Upward references are the architecture.** Scene→Beat, Scene→ArcStage, Scene→Thread,
   Chapter→Act. Every generated brief and health finding is a traversal of these edges.

### The unifying mechanism

Each entity type declares which fields make it *real*:

```python
Character.complete_when = ("name", "role", "want", "need")
Scene.complete_when     = ("goal", "conflict", "outcome", "pov_character_id")
```

One declaration drives three features, none of them stored:

- **completeness** — per entity; defines what a placeholder is.
- **readiness** — per level; a pure function of complete entities above it.
- **health findings, tier 1** — entity-level gaps fall straight out of completeness.

**Tier 2 health findings** are graph-level rules ("Thread B has no scenes in Act 3"),
a registry of pure functions **scoped by level** so that validation stays meaningful
in early phases when chapters and scenes do not yet exist.

---

## 2. Authoring modes

One data engine, three client policies over the same `readiness` signal.

| Mode | Policy |
| --- | --- |
| Plotter | UI honours `readiness` strictly; next level dimmed until current is ready |
| Hybrid *(default)* | Shows readiness as a nudge; commit at any level, any time |
| Pantser | Ignores readiness; infers structure upward from written scenes |

---

## 3. Levels

1. Premise · 2. Arc skeleton · 3. Characters · 4. Acts · 5. Beats
6. Threads · 7. Chapters · 8. Scenes

`World`, `Location` and `Theme` sit **outside** the ladder — reference data, not
scaffolding — and never participate in readiness gating.

---

## 4. Corrections to the original brief

The brief was internally inconsistent in eight places. Dispositions:

| # | Issue | Resolution |
| --- | --- | --- |
| 1 | "Lock next level" vs "never block creation" | Gating advisory only; computed `readiness`, enforced by UI policy |
| 2 | Beat fulfilment had 3 sources of truth | Two join tables `chapter_beat` / `scene_beat` with real FKs; `is_fulfilled` derived |
| 3 | "Scene advances arc" had no field | New `scene_arc_advance(scene_id, arc_stage_id)` edge |
| 4 | Scene had no prose field | Full editor in scope; Markdown `content` + separate annotation table |
| 5 | `Scene.thread_id` singular | `scene_thread(scene_id, thread_id, is_primary)` many-to-many |
| 6 | `Arc.current_stage`, `Story.status` stored | Derived |
| 7 | `Event.story_time` as datetime | `sort_ordinal` int + `display_label` text — only order matters |
| 8 | Framework mapping undefined | Seeded beats are ordinary editable rows; `framework_position` a loose string |

Dropped denormalised list columns (`Thread.scene_ids`, `Chapter.scene_ids`,
`World.locations`): the FK lives on the child plus a `sort_key` float — reorder by
taking the midpoint. `Story.thematic_statement` dropped; `Theme` owns it.

**Framework templates** live in code, not tables. Selecting a framework seeds ordinary
`Beat` rows — that seeding *is* the pre-scaffolding rule made concrete. Switching
framework mid-story is **additive and non-destructive**: seed what's missing, delete
nothing. A story carrying beats from two frameworks is valid, not an error.
v1 ships **3-act** (default) and **Save the Cat** (15 beats). Hero's Journey is a
character-arc shape, so it belongs on `Arc.stages`, not the beat library.

---

## 5. Entities added beyond the brief

- `entity_mention(scene_id, entity_type, entity_id, source)` — `source` is
  `manual | inferred | confirmed`. **This table is Pantser mode.** A deterministic pass
  string-matches known names in prose and writes `inferred` rows for the author to
  confirm. `Scene.characters_present` becomes a view over it.
- `suggestion` — dismissible, deduplicated nudges. Without persistence the tool nags
  forever, which would make Pantser mode insufferable.
- `scene_revision` — prose snapshots, debounced on blur/interval, never per keystroke.
- `annotation` — comments/highlights on prose; see anchoring below.
- `arc_stage` — a real table, not a list of strings, so scenes can point at a stage.

### Annotation anchoring

Stored as `(start_offset, end_offset, quoted_text)`. CodeMirror 6's position mapping
re-anchors live decorations through edits automatically; the `quoted_text` search is the
fallback for changes made in other sessions. If the text is gone, the annotation is
marked **orphaned** rather than silently relocated — a visibly broken annotation beats
one quietly pointing at the wrong sentence.

---

## 6. Versioning, sharing, forking

**Model: working state + named snapshots.** The live story stays mutable; authors
explicitly save named versions (serialised graph in JSONB); a fork deep-copies from a
snapshot with remapped IDs and `parent_story_id` set.

Rejected: full event sourcing — true git semantics, but it taxes every subsequent
feature and forces every read to reconstruct a log. Authors want "snapshot before I
rewrite Act 2" and "fork this story", not rebasing.

`user_id` and `parent_story_id` are on the root tables from the **first migration**,
even though auth and forking ship later. Cheap now, brutal to retrofit.

**Open:** whether sharing is public signup or a private URL for a handful of writers.
This changes how much auth, rate limiting and moderation is warranted, and raises an
unresolved ownership question — if someone forks your novel's structure, who owns it?

---

## 7. Stack

**Backend** — Python 3.12, **Litestar**, SQLAlchemy 2.0 + advanced-alchemy, Alembic,
Pydantic DTOs, `uv`.

Litestar over FastAPI: typed layered DI for the service modules, `advanced-alchemy`
providing repository/service/pagination rather than hand-rolling them, native SSE for
streaming LLM responses, built-in session auth. Accepted cost: a far smaller community
than FastAPI's.

**No SQLModel.** It conflates table model with API schema, which breaks exactly where
this design lives — `completeness`, `readiness`, `is_fulfilled`, `word_count` and the
Chapter Context Brief are all derived, not columns. Plain declarative models plus
separate DTOs let the API expose computed shapes cleanly.

**Database — Postgres 16 + pgvector, in dev and prod both.** Not SQLite-in-dev:
pgvector is needed for the retrieval layer, JSONB+GIN for snapshots and lore, and
dev/prod parity matters most around Alembic (SQLite's absent `ALTER TABLE` makes
migrations that pass locally and fail in prod). Since we're Dockerised anyway, local
Postgres costs one Compose service.

**UUIDv7 primary keys** — time-sortable so they index well, non-enumerable in URLs, and
generated client-side so deep-copying a graph for a fork cannot collide on a sequence.

**Frontend** — React + TypeScript + Vite, TanStack Query (server-state + cache
invalidation is ~all this app does; Redux would be ceremony), React Router, Tailwind +
shadcn/ui. Types generated from Litestar's OpenAPI schema via `openapi-typescript`, so
Pydantic stays the single source of truth. `dnd-kit` for reorder, **CodeMirror 6** for
prose, **React Flow** for the relationship graph and beat timeline.

React over server-rendered HTMX: the visual views a story tool grows — corkboard, beat
timeline, relationship web — are the part that cannot be bolted onto HTMX later.

**Not tRPC.** API-first was a stated goal; tRPC couples the client to backend function
signatures and makes the API hard for anything else to consume.

**Deploy** — multi-stage Docker, single image, Litestar serving the built frontend from
the same origin: no CORS, one domain, and httpOnly session cookies instead of tokens in
`localStorage` — a real security gain for an app holding unpublished manuscripts.

---

## 8. Phases

| Phase | Scope | Status |
| --- | --- | --- |
| **0** | Skeleton: uv + Litestar + SQLAlchemy + Alembic, Story CRUD, completeness framework, Vite/React app, type generation, Compose | **done** |
| **1** | Levels 1–6 + readiness engine + level-scoped validation + ladder UI | **done** |
| **2** | Levels 7–8, join tables, **Chapter Context Brief**, health dashboard | next |
| **3** | Editor: Markdown prose, autosave, revisions, annotations, compile/export | |
| **4** | Pantser: deterministic mention-matching, suggestion engine; then LLM assists behind the same interface, degrading to deterministic with no API key | |

Phase 1 deliberately precedes the editor, accepting that the flagship brief lands last.

**Open decisions:** Railway vs Fly; OAuth vs email+password; public vs private sharing.
