"""Single import point for every mapped model.

Alembic autogenerate only sees tables that have been imported. Keeping one module means
adding an entity never silently produces an empty migration.
"""

from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread

__all__ = (
    "Act",
    "Arc",
    "ArcStage",
    "Beat",
    "Character",
    "Event",
    "Relationship",
    "Story",
    "Thread",
)
