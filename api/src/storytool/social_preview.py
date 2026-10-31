"""Server-rendered link previews for the SPA and enabled public showcases."""

import re
from html import escape
from urllib.parse import quote
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.story.image_models import ImageBlob, StoryImage
from storytool.domain.story.images import IMAGE_REF
from storytool.domain.story.models import Story
from storytool.domain.story.showcase import StoryShowcase

PAGES = {
    "/": (
        "Your novel’s memory, for you and your AI",
        "For novelists: cast, world, timeline and chapters in one place, "
        "with Claude, ChatGPT, Gemini or no AI at all.",
        "landing",
    ),
    "/library": ("Your stories", "Your stories and writing workspace.", "stories"),
    "/roadmap": (
        "On the horizon",
        "What StoryTool is building next and what has shipped.",
        "roadmap",
    ),
    "/thanks": ("Shoutouts", "The people and ideas that helped shape StoryTool.", "shoutouts"),
    "/about": ("About the developer", "Who builds StoryTool, and why.", "landing"),
    "/feedback": ("Feedback", "Share a bug, an idea or a better way to use StoryTool.", "feedback"),
    "/how-to-use": ("How to use StoryTool", "Your guide to writing with StoryTool.", "how-to-use"),
}


async def preview_metadata(db: AsyncSession, path: str, token: str | None) -> dict[str, str]:
    base = get_settings().public_url.rstrip("/")
    page = "/library" if path.startswith(("/stories/", "/shared/")) else path
    title, description, card = PAGES.get(page, PAGES["/"])
    result = {
        "title": f"{title} — StoryTool",
        "description": description,
        "url": base + quote(path, safe="/"),
        "image": f"{base}/branding/social-{card}.png",
        "width": "1200",
        "height": "630",
        "alt": f"StoryTool: {title}",
    }
    if not path.startswith("/showcase/") or not token:
        return result
    result.update(title="Story showcase — StoryTool", image=f"{base}/branding/social-stories.png")
    story = (
        await db.execute(
            select(Story.id, Story.title, Story.blurb)
            .join(StoryShowcase, StoryShowcase.story_id == Story.id)
            .where(
                StoryShowcase.token == token,
                StoryShowcase.enabled.is_(True),
                Story.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if story is None:
        return result
    result.update(
        title=f"{story.title} — StoryTool",
        description=(story.blurb or "Read this public story showcase on StoryTool.")[:400],
        alt=f"Public story showcase: {story.title}",
    )
    # A cover the author chose to show publicly is the best preview image.
    cover = (
        await db.execute(
            select(StoryImage.id, StoryImage.alt, ImageBlob.width, ImageBlob.height)
            .join(ImageBlob, StoryImage.blob_id == ImageBlob.id)
            .where(
                StoryImage.story_id == story.id,
                StoryImage.role == "cover",
                StoryImage.show_public.is_(True),
                StoryImage.archived.is_(False),
            )
        )
    ).one_or_none()
    if cover:
        result.update(
            image=f"{base}/api/showcase/{quote(token, safe='')}/images/{cover.id}/file",
            width=str(cover.width),
            height=str(cover.height),
            alt=cover.alt or f"Cover of {story.title}",
        )
        return result
    candidates = await db.scalars(
        select(Scene.content)
        .outerjoin(Chapter, Scene.chapter_id == Chapter.id)
        .where(Scene.story_id == story.id, Scene.content.is_not(None))
        .order_by(Chapter.sort_key, Chapter.number, Chapter.id, Scene.sort_key, Scene.id)
    )
    for content in candidates:
        for _, image_id in IMAGE_REF.findall(content or ""):
            # Only resolve valid IDs belonging to the currently enabled public story.
            try:
                identifier = UUID(image_id)
            except ValueError:
                continue
            image = (
                await db.execute(
                    select(StoryImage.id, StoryImage.alt, ImageBlob.width, ImageBlob.height)
                    .join(ImageBlob, StoryImage.blob_id == ImageBlob.id)
                    .where(StoryImage.story_id == story.id, StoryImage.id == identifier)
                )
            ).one_or_none()
            if image:
                result.update(
                    image=f"{base}/api/showcase/{quote(token, safe='')}/images/{image.id}/file",
                    width=str(image.width),
                    height=str(image.height),
                    alt=image.alt or f"Illustration from {story.title}",
                )
                return result
    return result


def preview_html(html: str, metadata: dict[str, str]) -> str:
    title = escape(metadata["title"])
    html = re.sub(r"<title>.*?</title>", lambda _: f"<title>{title}</title>", html, flags=re.DOTALL)
    html = re.sub(r'<meta name="description"[^>]*>', "", html)
    tags = [f'<meta name="description" content="{escape(metadata["description"], quote=True)}" />']
    for prop, key in [
        ("og:title", "title"),
        ("og:description", "description"),
        ("og:url", "url"),
        ("og:image", "image"),
        ("og:image:width", "width"),
        ("og:image:height", "height"),
        ("og:image:alt", "alt"),
        ("twitter:title", "title"),
        ("twitter:description", "description"),
        ("twitter:image", "image"),
        ("twitter:image:alt", "alt"),
    ]:
        attribute = "name" if prop.startswith("twitter:") else "property"
        tags.append(f'<meta {attribute}="{prop}" content="{escape(metadata[key], quote=True)}" />')
    tags.extend(
        [
            '<meta property="og:type" content="website" />',
            '<meta property="og:site_name" content="StoryTool" />',
            '<meta name="twitter:card" content="summary_large_image" />',
        ]
    )
    return html.replace("</head>", "\n".join(tags) + "\n</head>")
