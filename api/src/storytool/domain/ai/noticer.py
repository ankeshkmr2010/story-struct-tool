from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai.credentials import decrypt_key
from storytool.domain.ai.models import AIConnection
from storytool.domain.noticing.factory import build_noticer, describe_noticer


async def user_noticer(db: AsyncSession, user_id: UUID) -> tuple[object, dict[str, object]]:
    connections = list(
        (
            await db.execute(
                select(AIConnection).where(
                    AIConnection.user_id == user_id, AIConnection.provider.in_(["jev", "anthropic"])
                )
            )
        ).scalars()
    )
    chosen = next((row for row in connections if row.provider == "jev"), None)
    chosen = chosen or next((row for row in connections if row.provider == "anthropic"), None)
    if chosen is None:
        return build_noticer(), describe_noticer()
    from storytool.domain.noticing.deterministic import DeterministicNoticer

    fallback = DeterministicNoticer()
    if chosen.provider == "jev":
        from typesafe_sdk import AsyncTypeSafeClient

        from storytool.domain.noticing.jev import JevNoticer

        noticer: object = JevNoticer(
            client=AsyncTypeSafeClient(api_key=decrypt_key(chosen.encrypted_key)),
            model=chosen.model,
            deterministic=fallback,
        )
    else:
        from anthropic import AsyncAnthropic

        from storytool.domain.noticing.claude import ClaudeNoticer

        noticer = ClaudeNoticer(
            client=AsyncAnthropic(api_key=decrypt_key(chosen.encrypted_key)),
            model=chosen.model,
            fallback=fallback,
        )
    return noticer, {
        "noticer": "jev" if chosen.provider == "jev" else "claude",
        "model": chosen.model,
        "claude_available": any(row.provider == "anthropic" for row in connections),
        "jev_available": any(row.provider == "jev" for row in connections),
    }
