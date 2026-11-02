"""Every feature and limit an access tier can switch, and the requests each one covers.

A feature is a kind of *new use*: starting a beta round, running a check, uploading an image.
Reading, editing what already exists, deleting, Trash, versions, settings, Markdown/text/zip
export and backups are deliberately never listed, so no tier can stop an author reaching or
taking out their own words (DESIGN.md: export is first-class).

Every feature is available and every limit is at its default until a tier says otherwise.
"""

import re
from dataclasses import dataclass

_ID = r"[0-9a-fA-F-]{36}"
_STORY = r"/api/stories/" + _ID


@dataclass(frozen=True, slots=True)
class Feature:
    key: str
    name: str
    description: str


@dataclass(frozen=True, slots=True)
class Limit:
    key: str
    name: str
    description: str
    default: int | None
    """None means unlimited."""


_FEATURES = (
    Feature("mcp", "Connected AI (MCP)", "Any request from a connected AI client."),
    Feature("ai.assistant", "In-app assistant", "Ask the assistant to propose changes."),
    Feature("ai.review", "AI reviews", "Run a craft check's AI review with a connected key."),
    Feature("shared_reader", "Shared reader", "Checks read by the site-provided scene reader."),
    Feature("beta_readers", "Beta readers", "Start a new beta-reading round."),
    Feature("sharing", "Private sharing", "Share a story with a reader by email."),
    Feature("showcase", "Public showcase", "Publish or change a public showcase link."),
    Feature("images", "Images and covers", "Upload images or set a cover."),
    Feature("import", "Manuscript import", "Import Word, Scrivener, EPUB or text manuscripts."),
    Feature("export.formatted", "Formatted export", "Export as Word, PDF, EPUB or HTML."),
    Feature("setups", "Setups and payoffs", "Mark setups and payoffs, and link them."),
    Feature("dialogue_speakers", "Dialogue speakers", "Fill in or set who speaks each line."),
)
_LIMITS = (Limit("stories.max", "Stories", "Active stories an account can own.", None),)

# (feature, methods, path pattern). The first match wins; checks are added from the registry.
_ROUTES: tuple[tuple[str, frozenset[str], re.Pattern[str]], ...] = tuple(
    (feature, frozenset(methods.split()), re.compile(pattern))
    for feature, methods, pattern in (
        ("ai.assistant", "POST", _STORY + r"/ai/propose"),
        ("ai.review", "POST", _STORY + r"/evaluations/[^/]+/ai-review"),
        ("shared_reader", "POST", _STORY + r"/evaluations/(?:[^/]+/shared-reader|scene-reader)"),
        ("beta_readers", "POST", r"/api/beta/manage/[0-9a-fA-F-]{36}/rounds"),
        ("sharing", "PUT", _STORY + r"/shares"),
        ("showcase", "PUT POST", _STORY + r"/showcase(?:/rotate)?"),
        ("images", "POST PUT", _STORY + r"/images(?:/cover)?"),
        ("import", "POST", r"/api/imports/(?:[a-z0-9]+(?:/uploads)?|uploads/" + _ID + "/import)"),
        ("export.formatted", "GET", _STORY + r"/manuscript\.(?:docx|pdf|epub|html)"),
        ("setups", "POST", _STORY + r"/setups/(?:marks|links)"),
        ("dialogue_speakers", "POST", _STORY + r"/dialogue/(?:populate|speakers)"),
    )
)
_CHECK = re.compile(_STORY + r"/evaluations/([a-z0-9_]+)")
# Requests that create a story, for `stories.max`.
_CREATES_STORY = re.compile(
    r"/api/stories|/api/backups/import|/api/imports/(?!uploads$)[a-z0-9]+"
    r"|/api/imports/uploads/[0-9a-fA-F-]{36}/import"
    r"|/api/shared-stories/[0-9a-fA-F-]{36}/import"
)


def features() -> tuple[Feature, ...]:
    """The fixed features plus one per check in the evaluation registry (`check.<id>`)."""
    from storytool.domain.evaluation import all_evaluators

    checks = tuple(
        Feature(f"check.{e.id}", f"Check: {e.name}", "Run this check in Check my story.")
        for e in all_evaluators()
    )
    return _FEATURES + checks


def limits() -> tuple[Limit, ...]:
    return _LIMITS


def feature_keys() -> set[str]:
    return {f.key for f in features()}


def limit_keys() -> set[str]:
    return {limit.key for limit in _LIMITS}


def features_for(method: str, path: str, *, delegated: bool) -> list[str]:
    """The features a request needs: `mcp` for any AI-client request, plus the route's own."""
    needed = ["mcp"] if delegated else []
    path = path.rstrip("/")
    for feature, methods, pattern in _ROUTES:
        if method in methods and pattern.fullmatch(path):
            needed.append(feature)
            break
    else:
        check = _CHECK.fullmatch(path)
        if method == "GET" and check:
            needed.append(f"check.{check.group(1)}")
    return needed


def creates_story(method: str, path: str) -> bool:
    return method == "POST" and bool(_CREATES_STORY.fullmatch(path.rstrip("/")))
