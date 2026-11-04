"""Library import actions survive reload and later edits for every manuscript format."""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import create_engine

from storytool.domain.story.controller import StoryController
from storytool.domain.story.models import Story
from storytool.domain.story.story_import import ADAPTERS


async def test_library_recognizes_all_manuscript_imports_after_later_edits() -> None:
    owner = uuid4()
    now = datetime.now(UTC)
    manuscript_labels = [f"Imported {adapter.label}" for adapter in ADAPTERS.values()]
    labels = [*manuscript_labels, "Restored from backup", "Imported copy", "You"]
    records = [
        Story(
            id=uuid4(),
            user_id=owner,
            title=label,
            created_at=now,
            updated_at=now,
            structure_framework="three_act",
            authoring_mode="hybrid",
        )
        for label in labels
    ]
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE field_authorship (story_id BLOB, origin TEXT, actor_label TEXT)"
        )
        for record in records:
            connection.exec_driver_sql(
                "INSERT INTO field_authorship VALUES (?, ?, ?)",
                (record.id.bytes, "author" if record.title == "You" else "import", record.title),
            )
            connection.exec_driver_sql(
                "INSERT INTO field_authorship VALUES (?, 'author', 'You')", (record.id.bytes,)
            )

        class Session:
            async def execute(self, statement):
                return SimpleNamespace(all=lambda: [(record.id, 10) for record in records])

            async def scalars(self, statement):
                return connection.execute(statement).scalars().all()

        class Stories:
            async def get_many(self, *filters):
                return records

        result = await StoryController.list_stories.fn(
            StoryController(owner=None),
            stories=Stories(),
            request=SimpleNamespace(scope={"state": {"storytool_user_id": owner}}),
            db_session=Session(),
        )

    engine.dispose()
    assert {story.title for story in result if story.prose_imported} == set(manuscript_labels)
    assert all(story.word_count == 10 for story in result)
