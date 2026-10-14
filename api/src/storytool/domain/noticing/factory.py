"""Chooses a noticer. Degrades rather than failing."""

import logging

from storytool.config import get_settings
from storytool.domain.noticing.deterministic import DeterministicNoticer

logger = logging.getLogger(__name__)


def build_noticer() -> object:
    """Jev, Claude, or deterministic, per configuration and available credentials.

    Deliberately silent-but-logged rather than an error: a missing key should cost the author
    a little inference quality, never the ability to write.
    """
    settings = get_settings()
    deterministic = DeterministicNoticer()
    backend = settings.resolved_noticing_backend

    if backend == "jev":
        from storytool.domain.decisions.providers import shared_provider
        from storytool.domain.noticing.jev import JevNoticer

        provider, model = shared_provider()
        return JevNoticer(client=provider, model=model, deterministic=deterministic)

    if backend == "claude":
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

    logger.info("Using deterministic noticing (no model credentials configured)")
    return deterministic


def describe_noticer() -> dict[str, object]:
    """Surfaced through the API so the author can see what is actually reading their prose."""
    settings = get_settings()
    backend = settings.resolved_noticing_backend
    model = {
        "jev": settings.decision_model or settings.jev_model,
        "claude": settings.noticing_model,
        "deterministic": None,
    }[backend]
    return {
        "noticer": "local"
        if backend == "jev" and settings.decision_provider == "local"
        else backend,
        "model": model,
        "claude_available": settings.claude_noticing_available,
        "jev_available": settings.shared_reader_available,
    }
