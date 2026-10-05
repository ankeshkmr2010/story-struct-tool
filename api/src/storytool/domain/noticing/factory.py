"""Chooses a noticer. Degrades rather than failing."""

import logging

from storytool.config import get_settings
from storytool.domain.noticing.deterministic import DeterministicNoticer

logger = logging.getLogger(__name__)


def build_noticer() -> object:
    """Claude when credentials are configured, deterministic otherwise.

    Deliberately silent-but-logged rather than an error: a missing API key should cost the
    author a little inference quality, never the ability to write.
    """
    settings = get_settings()
    deterministic = DeterministicNoticer()

    if not settings.noticing_use_claude:
        return deterministic
    if not settings.anthropic_api_key:
        logger.info("No ANTHROPIC_API_KEY set; using deterministic noticing only")
        return deterministic

    try:
        from anthropic import AsyncAnthropic

        from storytool.domain.noticing.claude import ClaudeNoticer
    except ImportError:
        logger.warning("anthropic SDK unavailable; using deterministic noticing")
        return deterministic

    return ClaudeNoticer(
        client=AsyncAnthropic(api_key=settings.anthropic_api_key),
        model=settings.noticing_model,
        fallback=deterministic,
    )


def describe_noticer() -> dict[str, object]:
    """Surfaced through the API so the author can see what is actually reading their prose."""
    settings = get_settings()
    return {
        "noticer": "claude" if settings.claude_noticing_available else "deterministic",
        "model": settings.noticing_model if settings.claude_noticing_available else None,
        "claude_available": settings.claude_noticing_available,
    }
