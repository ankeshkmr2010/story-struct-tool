"""Feedback on owned derived answers; calibration never silently changes policy."""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from litestar import Controller, Request, get, post
from litestar.exceptions import ClientException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.decisions.hint_controller import sandbox_identity
from storytool.domain.decisions.models import DecisionCache, DecisionFeedback, DecisionValidator
from storytool.domain.decisions.service import Actor
from storytool.domain.site.shoutouts import require_admin

CHECKS = {
    "hint.coherence",
    "hint.pov",
    "hint.tense",
    "hint.dialogue",
    "hint.unknown_name",
    "hint.turn",
    "hint.telling",
    "evaluate.scene_rhythm",
    "evaluate.value_shift",
    "evaluate.mice_nesting",
    "evaluate.misbelief_midpoint",
    "evaluate.setups_payoffs",
    "evaluate.continuity",
}


class DecisionLabelIn(BaseModel):
    check_code: str = Field(max_length=100)
    evidence_keys: list[Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]] = Field(
        min_length=1, max_length=256
    )
    probability: float = Field(ge=0, le=1, allow_inf_nan=False)
    outcome: Literal["accepted", "dismissed"]
    rubric_version: (
        Annotated[
            str,
            Field(
                max_length=40,
                pattern=r"^(?:hints-v[1-4]|craft-v[12]|hints-custom-v[12]-r[1-9]\d{0,9})$",
            ),
        ]
        | None
    ) = None

    @field_validator("check_code")
    @classmethod
    def known_check(cls, value: str) -> str:
        if value not in CHECKS:
            if not value.startswith("hint.custom."):
                raise ValueError("Unknown feedback check")
            identifier = value.removeprefix("hint.custom.")
            if str(UUID(identifier)) != identifier:
                raise ValueError("Invalid personal check ID")
        return value


class CalibrationBand(BaseModel):
    lower: float
    labels: int
    accepted: int


class CalibrationOut(BaseModel):
    check_code: str
    model: str
    provider: str
    rubric_version: str
    labels: int
    accepted: int
    reviewers: int
    anonymous_labels: int
    threshold: float
    suggested_threshold: float | None = None
    override_key: str
    bands: list[CalibrationBand]


async def save_label(db: AsyncSession, actor: Actor, data: DecisionLabelIn) -> None:
    if data.check_code.startswith("hint.custom."):
        validator = (
            await db.scalar(
                select(DecisionValidator).where(
                    DecisionValidator.id == UUID(data.check_code.removeprefix("hint.custom.")),
                    DecisionValidator.user_id == actor.user_id,
                )
            )
            if actor.user_id
            else None
        )
        if validator is None or data.rubric_version not in {
            f"hints-custom-v1-r{validator.version}",
            f"hints-custom-v2-r{validator.version}",
        }:
            raise ClientException(
                status_code=409,
                detail="This personal check changed. Read again before recording feedback.",
            )
    keys = sorted(set(data.evidence_keys))
    rows = (
        await db.scalars(
            select(DecisionCache).where(
                DecisionCache.fingerprint.in_(keys), DecisionCache.actor_key == actor.key
            )
        )
    ).all()
    if len(rows) != len(keys) or len({(row.provider, row.model) for row in rows}) != 1:
        raise ClientException(
            status_code=409,
            detail=(
                "This reading has expired or changed model. Read again before recording feedback."
            ),
        )
    row = rows[0]
    family = "hints" if data.check_code.startswith("hint.") else "craft"
    version = data.rubric_version or f"{family}-v1"
    if not version.startswith(family + "-"):
        raise ClientException(detail="Feedback rubric does not match this check")
    basis = "|".join(keys) if version.endswith("-v1") else version + "|" + "|".join(keys)
    unit = hashlib.sha256(basis.encode()).hexdigest()
    statement = insert(DecisionFeedback).values(
        actor_key=actor.key,
        user_id=actor.user_id,
        unit=unit,
        check_code=data.check_code,
        provider=row.provider,
        model=row.model,
        rubric_version=version,
        probability=data.probability,
        accepted=data.outcome == "accepted",
    )
    await db.execute(
        statement.on_conflict_do_update(
            constraint="one_decision_label",
            set_={
                "accepted": statement.excluded.accepted,
                "probability": statement.excluded.probability,
                "updated_at": datetime.now(UTC),
            },
        )
    )
    expired = (
        select(DecisionFeedback.id)
        .where(DecisionFeedback.updated_at < datetime.now(UTC) - timedelta(days=90))
        .limit(100)
    )
    await db.execute(delete(DecisionFeedback).where(DecisionFeedback.id.in_(expired)))


class DecisionFeedbackController(Controller):
    path = "/api/decisions/feedback"
    tags = ["noticing"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(status_code=204, summary="Record useful/dismissed feedback on this user's cached reading")
    async def label(
        self, request: Request, db_session: AsyncSession, data: DecisionLabelIn
    ) -> None:
        await save_label(db_session, Actor.user(request.scope["state"]["storytool_user_id"]), data)


class SandboxFeedbackController(Controller):
    path = "/api/site/try/hints/feedback"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(status_code=204, summary="Record feedback on this sandbox session's cached hints")
    async def label(
        self, request: Request, db_session: AsyncSession, data: DecisionLabelIn
    ) -> None:
        from urllib.parse import urlsplit

        if (
            urlsplit(request.headers.get("origin", "")).netloc.lower()
            != request.headers.get("host", "").lower()
        ):
            raise ClientException(status_code=403, detail="Use this site's own origin")
        identity, cookie = sandbox_identity(request)
        if cookie is not None or not data.check_code.startswith("hint."):
            raise ClientException(
                status_code=409, detail="Read this scene again before recording feedback."
            )
        await save_label(db_session, Actor.anonymous(identity), data)


class DecisionCalibrationController(Controller):
    path = "/api/admin/decisions/calibration"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get(summary="Aggregate reader feedback by model/check/rubric (admin only)")
    async def report(self, request: Request, db_session: AsyncSession) -> list[CalibrationOut]:
        await require_admin(request, db_session)
        dimensions = (
            DecisionFeedback.check_code,
            DecisionFeedback.provider,
            DecisionFeedback.model,
            DecisionFeedback.rubric_version,
        )
        cutoff = datetime.now(UTC) - timedelta(days=90)
        signed = DecisionFeedback.user_id.is_not(None)
        totals = (
            await db_session.execute(
                select(
                    *dimensions,
                    func.count(),
                    func.sum(case((DecisionFeedback.accepted, 1), else_=0)),
                    func.count(func.distinct(DecisionFeedback.user_id)),
                    func.sum(case((signed, 0), else_=1)),
                )
                .where(DecisionFeedback.updated_at >= cutoff)
                .group_by(*dimensions)
            )
        ).all()
        bucket = func.floor(DecisionFeedback.probability * 20) / 20
        rows = (
            await db_session.execute(
                select(
                    *dimensions,
                    bucket,
                    func.count(),
                    func.sum(case((DecisionFeedback.accepted, 1), else_=0)),
                )
                .where(DecisionFeedback.updated_at >= cutoff, signed)
                .group_by(*dimensions, bucket)
            )
        ).all()
        groups = {}
        for row in rows:
            groups.setdefault(tuple(row[:4]), []).append(
                CalibrationBand(lower=float(row[4]), labels=row[5], accepted=row[6])
            )
        result = []
        settings = get_settings()
        for row in totals:
            check, provider, model, version = row[:4]
            default = (
                settings.decision_hint_probability
                if check.startswith("hint.")
                else settings.decision_evaluation_confidence
            )
            threshold = settings.decision_threshold(check, model, provider, version, default)
            bands = sorted(groups.get(tuple(row[:4]), []), key=lambda band: band.lower)
            suggested = None
            # Feedback is preference, not objective ground truth. Never lower the policy
            # from observed-only displayed answers; require broad signed-in evidence.
            if row[6] >= 5:
                target = 0.8 if check.startswith("hint.") else 0.9
                for step in range(10, 20):
                    candidate = step / 20
                    considered = [band for band in bands if band.lower >= candidate]
                    count = sum(band.labels for band in considered)
                    accepted = sum(band.accepted for band in considered)
                    if candidate >= threshold and count >= 100 and accepted / count >= target:
                        suggested = candidate
                        break
            result.append(
                CalibrationOut(
                    check_code=check,
                    provider=provider,
                    model=model,
                    rubric_version=version,
                    labels=row[4],
                    accepted=row[5],
                    reviewers=row[6],
                    anonymous_labels=row[7],
                    threshold=threshold,
                    suggested_threshold=suggested,
                    override_key=f"{provider}|{model}|{version}|{check}",
                    bands=bands,
                )
            )
        return result
