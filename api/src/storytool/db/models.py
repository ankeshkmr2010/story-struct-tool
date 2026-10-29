"""Single import point for every mapped model.

Alembic autogenerate only sees tables that have been imported. Keeping one module means
adding an entity never silently produces an empty migration.
"""

from storytool.domain.ai.models import AgentToken, AIConnection, AIRun, StoryObservation
from storytool.domain.auth.models import User, UserSession
from storytool.domain.auth.oauth_models import MCPClient, MCPConsent, MCPGrant, MCPToken
from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.decisions.models import (
    DecisionBudget,
    DecisionCache,
    DecisionFeedback,
    DecisionValidator,
)
from storytool.domain.evaluation.reports import EvaluationReport
from storytool.domain.glossary import GlossaryEntry
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
from storytool.domain.search.models import SearchChunk, SearchIndex
from storytool.domain.site.feedback import ProductFeedback
from storytool.domain.site.funnel import FunnelEvent
from storytool.domain.site.roadmap import RoadmapItem
from storytool.domain.site.shoutouts import Shoutout
from storytool.domain.story.authorship import FieldAuthorship
from storytool.domain.story.beta import (
    BetaMember,
    BetaMessage,
    BetaPoll,
    BetaRound,
    BetaThread,
    BetaVote,
)
from storytool.domain.story.goals import StoryDay, StoryGoal, WritingGoal, WritingSprint
from storytool.domain.story.image_models import ImageBlob, ImageDeletion, StoryImage
from storytool.domain.story.library import LibraryCard, WritingDay
from storytool.domain.story.models import Story
from storytool.domain.story.sharing import StoryShare
from storytool.domain.story.showcase import StoryShowcase
from storytool.domain.story.story_import import ImportUpload
from storytool.domain.story.workspace import WorkspacePosition
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
    "BetaMember",
    "BetaMessage",
    "BetaPoll",
    "BetaRound",
    "BetaThread",
    "BetaVote",
    "Chapter",
    "Character",
    "DecisionBudget",
    "DecisionCache",
    "DecisionFeedback",
    "DecisionValidator",
    "EvaluationReport",
    "Event",
    "FieldAuthorship",
    "FunnelEvent",
    "GlossaryEntry",
    "ImageBlob",
    "ImageDeletion",
    "ImportUpload",
    "LibraryCard",
    "Location",
    "MCPClient",
    "MCPConsent",
    "MCPGrant",
    "MCPToken",
    "ProductFeedback",
    "Relationship",
    "RoadmapItem",
    "Scene",
    "SceneCharacterMention",
    "SceneRevision",
    "SearchChunk",
    "SearchIndex",
    "Shoutout",
    "Story",
    "StoryDay",
    "StoryGoal",
    "StoryImage",
    "StoryObservation",
    "StoryShare",
    "StoryShowcase",
    "StoryVersion",
    "Suggestion",
    "Thread",
    "User",
    "UserSession",
    "WorkspacePosition",
    "WritingDay",
    "WritingGoal",
    "WritingSprint",
    "chapter_beat",
    "event_character",
    "scene_arc_advance",
    "scene_beat",
    "scene_thread",
)
