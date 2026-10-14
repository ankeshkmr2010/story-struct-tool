"""Private, provider-neutral validator definitions; saving never runs a model."""

import hashlib
from datetime import UTC, datetime
from typing import Annotated, Literal, Self
from uuid import NAMESPACE_URL, UUID, uuid5

from litestar import Controller, Request, delete, get, patch, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.decisions.hints import HintInput, WritingHint
from storytool.domain.decisions.models import DecisionValidator
from storytool.domain.decisions.service import canonical
from storytool.domain.decisions.types import Probability, Question


class NoulTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["noul"] = "noul"
    expected: bool = True


class ChoiceTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["choice"] = "choice"
    matches: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(
        min_length=1, max_length=255
    )


class ScoreTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["score"] = "score"
    levels: list[Annotated[int, Field(ge=0, le=9)]] = Field(min_length=1, max_length=10)


class ProblemRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["problem"] = "problem"


class CountRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    type: Literal["count"] = "count"
    entity: Literal["characters"] = "characters"
    count_when: Literal["present", "speaking_or_acting", "driving_action"] = "present"
    criteria: str = Field(min_length=1, max_length=2000)
    limit: int = Field(ge=1, le=50)
    additional_names: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        default_factory=list, max_length=50
    )


class ComparisonRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    type: Literal["comparison"] = "comparison"
    first: str = Field(min_length=1, max_length=1000)
    second: str = Field(min_length=1, max_length=1000)
    relationship: str = Field(min_length=1, max_length=2000)


class RuleExample(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=4000)
    should_trigger: bool


class ValidatorDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    schema_version: Literal[1, 2] = 1
    name: str = Field(min_length=1, max_length=200)
    input_scope: Literal["sentence", "paragraph", "scene"] = "paragraph"
    question: Question
    trigger: Annotated[NoulTrigger | ChoiceTrigger | ScoreTrigger, Field(discriminator="type")]
    minimum_probability: Probability = 0.8
    advice: str = Field(min_length=1, max_length=2000)
    recipe: (
        Annotated[ProblemRecipe | CountRecipe | ComparisonRecipe, Field(discriminator="type")]
        | None
    ) = None
    highlight: Literal["sentence", "paragraph", "scene"] = "sentence"
    examples: list[RuleExample] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def valid_question_and_trigger(self) -> Self:
        question, trigger = self.question, self.trigger
        if isinstance(self.recipe, CountRecipe):
            question = Question(
                type="noul",
                instructions=(
                    f"Are there more than {self.recipe.limit} named characters meeting this "
                    f"criterion in the target passage? {self.recipe.criteria}"
                ),
                criteria=question.criteria if question.type == "noul" else None,
            )
            self.question = question
        elif isinstance(self.recipe, ComparisonRecipe):
            if (
                question.type != "noul"
                or not isinstance(trigger, NoulTrigger)
                or not trigger.expected
            ):
                raise ValueError("Comparison recipes use a Yes trigger")
            question = Question(
                type="noul",
                instructions=(
                    f"Compare {self.recipe.first} with {self.recipe.second} in the supplied "
                    f"passage. Does it show this mismatch: {self.recipe.relationship}? "
                    "Do not guess when either side is missing."
                ),
                criteria=question.criteria,
            )
            self.question = question
        if not question.instructions.strip():
            raise ValueError("A question is required")
        if question.type != trigger.type:
            raise ValueError("The trigger must match the question's answer type")
        criteria = question.criteria or []
        if isinstance(criteria, dict):
            if any(not key or len(key) > 100 for key in criteria):
                raise ValueError("Option IDs must contain 1-100 characters")
            descriptions = criteria.values()
        else:
            descriptions = criteria
        if any(not text.strip() or len(text) > 2000 for text in descriptions):
            raise ValueError("Option descriptions must contain 1-2000 characters")
        details = {
            "question": question.model_dump(),
            "recipe": self.recipe.model_dump() if self.recipe else None,
            "examples": [example.model_dump() for example in self.examples],
        }
        if len(canonical(details).encode()) > 24000:
            raise ValueError("Question, recipe and examples exceed the definition size limit")
        if isinstance(self.recipe, CountRecipe) and (
            question.type != "noul" or not isinstance(trigger, NoulTrigger) or not trigger.expected
        ):
            raise ValueError("Count recipes use a Yes trigger; the count is compared in code")
        if isinstance(trigger, ChoiceTrigger):
            if not set(trigger.matches) <= set(criteria):
                raise ValueError("Trigger choices must exist in the question")
            trigger.matches = list(dict.fromkeys(trigger.matches))
        if isinstance(trigger, ScoreTrigger):
            if any(level >= len(criteria) for level in trigger.levels):
                raise ValueError("Trigger levels must exist in the rubric")
            trigger.levels = sorted(set(trigger.levels))
        return self


class ValidatorCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    definition: ValidatorDefinition
    enabled: bool = False


class ValidatorUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    definition: ValidatorDefinition | None = None
    enabled: bool | None = None

    @model_validator(mode="after")
    def has_change(self) -> Self:
        if self.definition is None and self.enabled is None:
            raise ValueError("Supply a definition or enabled setting")
        return self


class ValidatorOut(BaseModel):
    id: UUID
    definition: ValidatorDefinition
    enabled: bool
    version: int
    definition_hash: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: DecisionValidator) -> "ValidatorOut":
        return cls(**{name: getattr(row, name) for name in cls.model_fields})


class RuleObservation(BaseModel):
    paragraph: int
    matched: bool | None
    names: list[str] = Field(default_factory=list)
    excluded: list[str] = Field(default_factory=list)
    uncertain: list[str] = Field(default_factory=list)
    count: int | None = None
    limit: int | None = None
    complete: bool = True


class ValidatorPreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    definition: ValidatorDefinition
    content: str = Field(min_length=1, max_length=30000)


class ValidatorPreviewOut(BaseModel):
    hints: list[WritingHint]
    observations: list[RuleObservation]
    warnings: list[str]


class ValidatorPage(BaseModel):
    items: list[ValidatorOut]
    total: int
    next_offset: int | None


def definition_hash(definition: dict) -> str:
    return hashlib.sha256(canonical(definition).encode()).hexdigest()


async def owned_validator(
    db: AsyncSession, user_id: UUID, identifier: UUID, *, lock: bool = False
) -> DecisionValidator:
    statement = select(DecisionValidator).where(
        DecisionValidator.id == identifier, DecisionValidator.user_id == user_id
    )
    if lock:
        statement = statement.with_for_update()
    row = await db.scalar(statement)
    if row is None:
        raise NotFoundException(detail="Validator not found")
    return row


def check_version(row: DecisionValidator, expected: int) -> None:
    if row.version != expected:
        raise ClientException(
            status_code=409, detail="Validator changed. Read it again before editing."
        )


class ValidatorController(Controller):
    path = "/api/validators"

    @post("/preview", status_code=200, summary="Try an unsaved rule on a user-supplied sample")
    async def preview_validator(
        self, request: Request, db_session: AsyncSession, data: ValidatorPreviewIn
    ) -> ValidatorPreviewOut:
        from litestar.exceptions import ServiceUnavailableException

        from storytool.config import get_settings
        from storytool.domain.decisions.custom_hints import read_custom_hints
        from storytool.domain.decisions.providers import shared_provider
        from storytool.domain.decisions.service import Actor, DecisionService

        if not get_settings().shared_reader_available:
            raise ServiceUnavailableException(detail="The shared reader is not configured")
        user_id = request.scope["state"]["storytool_user_id"]
        definition = data.definition.model_dump(mode="json")
        digest = definition_hash(definition)
        now = datetime.now(UTC)
        row = ValidatorOut(
            id=uuid5(NAMESPACE_URL, f"{user_id}:{digest}"),
            definition=data.definition,
            enabled=True,
            version=1,
            definition_hash=digest,
            created_at=now,
            updated_at=now,
        )
        provider, model = shared_provider()
        service = DecisionService(db_session, Actor.user(user_id), provider)
        await db_session.commit()
        hints, warnings, observations = await read_custom_hints(
            service, model, HintInput(content=data.content), [row]
        )
        return ValidatorPreviewOut(hints=hints, observations=observations, warnings=warnings)

    @get()
    async def list_validators(
        self, request: Request, db_session: AsyncSession, offset: int = 0, limit: int = 50
    ) -> ValidatorPage:
        if not 0 <= offset <= 100000 or not 1 <= limit <= 100:
            raise ClientException(detail="Invalid pagination")
        owner = DecisionValidator.user_id == request.scope["state"]["storytool_user_id"]
        total = await db_session.scalar(
            select(func.count()).select_from(DecisionValidator).where(owner)
        )
        rows = list(
            await db_session.scalars(
                select(DecisionValidator)
                .where(owner)
                .order_by(DecisionValidator.created_at, DecisionValidator.id)
                .offset(offset)
                .limit(limit)
            )
        )
        return ValidatorPage(
            items=[ValidatorOut.from_row(row) for row in rows],
            total=total or 0,
            next_offset=offset + len(rows) if offset + len(rows) < (total or 0) else None,
        )

    @get("/{validator_id:uuid}")
    async def get_validator(
        self, request: Request, db_session: AsyncSession, validator_id: UUID
    ) -> ValidatorOut:
        row = await owned_validator(
            db_session, request.scope["state"]["storytool_user_id"], validator_id
        )
        return ValidatorOut.from_row(row)

    @post()
    async def create_validator(
        self, request: Request, db_session: AsyncSession, data: ValidatorCreate
    ) -> ValidatorOut:
        definition = data.definition.model_dump(mode="json")
        row = DecisionValidator(
            user_id=request.scope["state"]["storytool_user_id"],
            definition=definition,
            enabled=data.enabled,
            version=1,
            definition_hash=definition_hash(definition),
        )
        db_session.add(row)
        await db_session.flush()
        return ValidatorOut.from_row(row)

    @patch("/{validator_id:uuid}")
    async def update_validator(
        self, request: Request, db_session: AsyncSession, validator_id: UUID, data: ValidatorUpdate
    ) -> ValidatorOut:
        row = await owned_validator(
            db_session, request.scope["state"]["storytool_user_id"], validator_id, lock=True
        )
        check_version(row, data.expected_version)
        if data.definition is not None:
            row.definition = data.definition.model_dump(mode="json")
            row.definition_hash = definition_hash(row.definition)
        if data.enabled is not None:
            row.enabled = data.enabled
        row.version += 1
        await db_session.flush()
        return ValidatorOut.from_row(row)

    @delete("/{validator_id:uuid}", status_code=200)
    async def delete_validator(
        self, request: Request, db_session: AsyncSession, validator_id: UUID, expected_version: int
    ) -> dict[str, UUID]:
        if expected_version < 1:
            raise ClientException(detail="A current version is required")
        row = await owned_validator(
            db_session, request.scope["state"]["storytool_user_id"], validator_id, lock=True
        )
        check_version(row, expected_version)
        await db_session.delete(row)
        await db_session.flush()
        return {"deleted_id": validator_id}
