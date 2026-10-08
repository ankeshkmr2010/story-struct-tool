"""Single import point for every mapped model.

Alembic autogenerate only sees tables that have been imported. Keeping one module means
adding an entity never silently produces an empty migration.
"""

from storytool.domain.ai.models import AgentToken, AIConnection, AIRun, StoryObservation
from storytool.domain.auth.models import User, UserSession
from storytool.domain.auth.oauth_models import MCPClient, MCPConsent, MCPGrant, MCPToken
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
from storytool.domain.structure.models import Act, Beat, Event, Thread, event_character
from storytool.domain.versioning.models import StoryVersion
from storytool.domain.world.models import Location

__all__ = (
    "AIConnection",
    "AIRun",
    "Act",
    "AgentToken",
    "Annotation",
    "Arc",
    "ArcStage",
    "Beat",
    "Chapter",
    "Character",
    "Event",
    "Location",
    "MCPClient",
    "MCPConsent",
    "MCPGrant",
    "MCPToken",
    "Relationship",
    "Scene",
    "SceneCharacterMention",
    "SceneRevision",
    "Story",
    "StoryObservation",
    "StoryVersion",
    "Suggestion",
    "Thread",
    "User",
    "UserSession",
    "chapter_beat",
    "event_character",
    "scene_arc_advance",
    "scene_beat",
    "scene_thread",
)
