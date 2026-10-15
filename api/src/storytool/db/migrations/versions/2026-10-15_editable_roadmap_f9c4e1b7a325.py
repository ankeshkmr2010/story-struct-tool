"""Admin-editable roadmap, preserving the existing public timeline."""
# ruff: noqa: E501 -- Preserve seeded product copy verbatim.

from datetime import UTC, date, datetime
from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa
from alembic import op

revision = "f9c4e1b7a325"
down_revision = "e8b3d0a6f214"
branch_labels = None
depends_on = None

SEED = [
    {
        "title": "Scrivener support",
        "description": "Import a manuscript from Scrivener. Word (.docx) import is already available.",
        "status": "planned",
        "hero": False,
        "delivered_on": None,
    },
    {
        "title": "Latin-script language support",
        "description": "Language-aware support for stories written in Latin-script languages, including "
        "accented text and punctuation.",
        "status": "planned",
        "hero": False,
        "delivered_on": None,
    },
    {
        "title": "View counts on shared stories",
        "description": "See how many people have read the stories you share.",
        "status": "exploring",
        "hero": False,
        "delivered_on": None,
    },
    {
        "title": "Cream light mode and editable roadmap",
        "description": "a softer cream palette and admin controls to add roadmap items, edit details, "
        "highlight hero features and move work through Exploring, Planned, In progress "
        "and Delivered.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-15",
    },
    {
        "title": "Pick up where you left off",
        "description": "reopen a story across devices in your last Write, Read or Design view, with your "
        "chapter, scene and position remembered privately.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-15",
    },
    {
        "title": "Custom real-time writing checks",
        "description": "build private checks without coding, try samples with character counts, and get "
        "dismissible live-hint cards with your current paragraph first, contributing "
        "sentences and clear count-review details; manage checks yourself or through your "
        "connected AI.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-14",
    },
    {
        "title": "Images in your story",
        "description": "illustrations and reference art with captions, inline Write thumbnails, "
        "right-click insertion, scene links and portable exports. Large photos shrink "
        "before upload, with a gentle alt-text prompt. A dedicated page manages usage and "
        "safe deletion; guided samples show the flow.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-14",
    },
    {
        "title": "Try before signing up",
        "description": "a guided writing sandbox with local search and History, plus interactive feature "
        "demos and sample downloads. Tours support Previous, Next and resume; sign in to "
        "keep your edits.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-14",
    },
    {
        "title": "Writing and reader guides",
        "description": "AI quickstart prompts, images and exports, plus beta rounds, private reader "
        "conversations and polls.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-14",
    },
    {
        "title": "Jev Noticing for everyone",
        "description": "spot sentences that do not fit, review scene craft, guide planning, group reader "
        "feedback, improve related search and flag stale outlines, with practical advice "
        "and no personal key needed.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-14",
    },
    {
        "title": "Evaluate polish",
        "description": "a bounded findings scroll area with narrower, color-coded cards and "
        "plain-language scene-change interpretations, collapsed uncertain findings, icon "
        "feedback, inline actions and right-edge live-hint overlays below the writing "
        "controls, credited craft definitions, review dates, stale-review actions and "
        "findings and highlighted thread names that open the relevant planning item.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-14",
    },
    {
        "title": "Site navigation and link previews",
        "description": "sticky navigation, a direct tour entry and custom thumbnails for Landing, Your "
        "stories, Roadmap, Shoutouts, Feedback and How to use. Enabled public showcases "
        "use their own title and first manuscript image.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-14",
    },
    {
        "title": "Beta readers and polls",
        "description": "frozen manuscript rounds with controlled invitations, private passage "
        "conversations and versioned polls, managed together from Beta readers.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "Search for your connected AI",
        "description": "bounded exact and related search, with passage evidence for craft reviews and "
        "prompts that guide agents to verify their findings.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "Search, export and AI guides",
        "description": "instructions for library and meaning search, Word import, manuscript formats and "
        "AI connections, with meaning-search privacy explained.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "Search your story and library",
        "description": "one search window for saved prose and planning details, with exact and optional "
        "related matches, readable filters and links to matching passages.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "Automatic review refresh",
        "description": "reviews submitted by AI clients appear while Evaluate is open, with manual "
        "refresh still available.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "Word manuscript import",
        "description": "bring a .docx manuscript into a new story, then write, read or build its outline "
        "from the imported prose.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "Submission PDF export",
        "description": "export a manuscript with a title page, double-spaced prose, running page headers "
        "and optional reference appendices.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "Your author name",
        "description": "set a pen name in Settings and use it as the byline in manuscript exports.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "More craft reviews",
        "description": "review value shifts against scene prose and a character\u2019s misbelief at the "
        "midpoint. Use the feedback to decide what to revise.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-13",
    },
    {
        "title": "Easier AI setup",
        "description": "Claude and ChatGPT first, other clients available on demand, and a starter "
        "prompt in plain writing language.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-12",
    },
    {
        "title": "Product feedback",
        "description": "send private bug reports and suggestions about StoryTool from the signed-in "
        "Feedback page.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-12",
    },
    {
        "title": "On-demand craft checks",
        "description": "check scene/sequel rhythm and MICE thread nesting in Evaluate; get an AI review "
        "of your MICE threads. Suggestions to consider, never rules to obey.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-12",
    },
    {
        "title": "EPUB, HTML and plain-text export",
        "description": "take your manuscript out as an e-book, a web page or plain text.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-12",
    },
    {
        "title": "Public story showcase",
        "description": "an opt-in, read-only page anyone can open: manuscript, story context and "
        "timeline.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-11",
    },
    {
        "title": "Catch-up outline",
        "description": "an AI agent builds the outline from prose you have already written; keep all, "
        "some or none.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-11",
    },
    {
        "title": "Backup, restore and Word export",
        "description": "download a full backup or a .docx manuscript, and restore any backup into your "
        "library.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-11",
    },
    {
        "title": "Who wrote what",
        "description": "see which changes came from you or an AI in the authorship report under History.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-11",
    },
    {
        "title": "Review inbox for AI edits",
        "description": "see, accept or dismiss every change an AI agent proposes, filtered by status and "
        "source.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-10",
    },
    {
        "title": "Story grid",
        "description": "every scene at a glance with status, POV, place, time, goal, conflict, outcome "
        "and word count.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-10",
    },
    {
        "title": "Scene snapshots",
        "description": "preview and restore earlier drafts of any scene.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-10",
    },
    {
        "title": "Epigraphs and chapter notes",
        "description": "an opening quote plus opening and closing notes for each chapter.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-10",
    },
    {
        "title": "Sharing with readers",
        "description": "share a story read-only, and optionally let readers import their own copy.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-09",
    },
    {
        "title": "Continuous chapter writer",
        "description": "write a whole chapter on one scrolling page, plus focused reading and an EmojiDB "
        "shortcut in the right-click menu.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-09",
    },
    {
        "title": "Glossary",
        "description": "keep your story\u2019s terms, aliases and definitions in one place.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-09",
    },
    {
        "title": "Connect your AI",
        "description": "sign your AI assistant in to one story or your whole library, and revoke it any "
        "time.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-09",
    },
    {
        "title": "Trash",
        "description": "deleted stories wait in Trash until you restore them or delete them for good.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-09",
    },
    {
        "title": "Accounts, timelines and the assistant",
        "description": "Google sign-in, story timelines and an in-app AI assistant.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-08",
    },
    {
        "title": "Whole-story versions",
        "description": "automatic checkpoints, and a safe restore that keeps the draft you replaced.",
        "status": "delivered",
        "hero": True,
        "delivered_on": "2026-10-08",
    },
    {
        "title": "Places and continuity",
        "description": "track where scenes happen and get flagged when the timeline contradicts itself.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-06",
    },
    {
        "title": "Chapters, scenes and prose",
        "description": "write scenes inside chapters, with revisions, annotations, progress and Markdown "
        "export.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-05",
    },
    {
        "title": "Noticing",
        "description": "suggestions drawn from what you write, so the plan can follow the draft.",
        "status": "delivered",
        "hero": False,
        "delivered_on": "2026-10-05",
    },
]


def upgrade():
    table = op.create_table(
        "roadmap_item",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer()),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("hero", sa.Boolean(), nullable=False),
        sa.Column("delivered_on", sa.Date()),
        sa.Column("sort_key", sa.Float(), nullable=False),
        sa.CheckConstraint(
            "status IN ('exploring', 'planned', 'in_progress', 'delivered')", name="roadmap_status"
        ),
    )
    now = datetime.now(UTC)
    rows = []
    for index, item in enumerate(SEED):
        row = dict(item)
        row["delivered_on"] = (
            date.fromisoformat(row["delivered_on"]) if row["delivered_on"] else None
        )
        rows.append(
            dict(
                row,
                id=uuid5(NAMESPACE_URL, f"storytool-roadmap:{index}:{row['title']}"),
                created_at=now,
                updated_at=now,
                sort_key=(index + 1) * 100,
            )
        )
    op.bulk_insert(table, rows)


def downgrade():
    op.drop_table("roadmap_item")
