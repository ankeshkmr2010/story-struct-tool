"""The writing language of a story: its own setting, else its author's account language."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.enums import DEFAULT_LANGUAGE


async def story_language(session: AsyncSession, story_id: UUID) -> str:
    from storytool.domain.auth.models import User
    from storytool.domain.story.models import Story

    story = await session.get(Story, story_id)
    language = story.language if story else None
    if language is None and story is not None and story.user_id is not None:
        language = await session.scalar(select(User.language).where(User.id == story.user_id))
    return language or DEFAULT_LANGUAGE
