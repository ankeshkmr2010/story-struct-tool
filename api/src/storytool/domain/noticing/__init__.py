"""Noticing: inferring structure from prose, deterministically and optionally with Claude.

The LLM here is confined to *noticing* -- reporting what is already on the page. It cannot
propose prose or plot, and that is enforced by the response schema rather than by
instruction. See `types.py` for why.
"""

from storytool.domain.noticing.deterministic import DeterministicNoticer
from storytool.domain.noticing.factory import build_noticer, describe_noticer
from storytool.domain.noticing.types import (
    CharacterNotice,
    KnownBeat,
    KnownCharacter,
    Noticer,
    SceneNotices,
    StructureNotice,
    UnknownNameNotice,
)

__all__ = (
    "CharacterNotice",
    "DeterministicNoticer",
    "KnownBeat",
    "KnownCharacter",
    "Noticer",
    "SceneNotices",
    "StructureNotice",
    "UnknownNameNotice",
    "build_noticer",
    "describe_noticer",
)
