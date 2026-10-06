"""Single import point for every mapped model.

Alembic autogenerate only sees tables that have been imported. Keeping one module means
adding an entity never silently produces an empty migration.
"""

from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.narrative.models import (
    Annotation,
    Chapter,
    Scene,
    SceneCharacterMention,
    SceneRevision,
    Suggestion,
    chapter_beat,
    scene_arc_advance,
    scene_beat,
    scene_thread,
)
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread
from storytool.domain.world.models import Location

__all__ = (
    "Act",
    "Annotation",
    "Arc",
    "ArcStage",
    "Beat",
    "Chapter",
    "Character",
    "Event",
    "Location",
    "Relationship",
    "Scene",
    "SceneCharacterMention",
    "SceneRevision",
    "Story",
    "Suggestion",
    "Thread",
    "chapter_beat",
    "scene_arc_advance",
    "scene_beat",
    "scene_thread",
)
