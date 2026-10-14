"""The only contract evaluation code needs; no provider SDK types escape adapters."""

from typing import Annotated, Literal, Protocol, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Probability = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["noul", "choice", "score"]
    instructions: str = Field(min_length=1, max_length=8000)
    criteria: dict[str, str] | list[str] | None = None

    @model_validator(mode="after")
    def checked(self) -> Self:
        if self.type == "choice" and not (
            isinstance(self.criteria, dict) and 1 <= len(self.criteria) <= 255
        ):
            raise ValueError("Choice requires 1-255 options")
        if self.type == "score" and not (
            isinstance(self.criteria, list) and 2 <= len(self.criteria) <= 10
        ):
            raise ValueError("Score requires 2-10 rubric levels")
        if (
            self.type == "noul"
            and self.criteria is not None
            and not (isinstance(self.criteria, dict) and set(self.criteria) <= {"true", "false"})
        ):
            raise ValueError("Noul criteria may describe true and false only")
        return self


class Noul(Question):
    type: Literal["noul"] = "noul"


class Choice(Question):
    type: Literal["choice"] = "choice"


class Score(Question):
    type: Literal["score"] = "score"


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["noul", "choice", "score"]
    noul: Probability | None = None
    choice: str | None = None
    score: Annotated[float, Field(allow_inf_nan=False)] | None = None
    confidence: Probability | None = None
    probabilities: dict[str, Probability] = Field(default_factory=dict)

    def check_question(self, question: Question) -> None:
        if self.type != question.type:
            raise ValueError("Answer type does not match its question")
        if self.type == "noul":
            if self.noul is None:
                raise ValueError("Missing yes/no probability")
            return
        if self.confidence is None:
            raise ValueError("Missing confidence")
        criteria = question.criteria
        labels = (
            set(criteria)
            if isinstance(criteria, dict)
            else {str(index) for index in range(len(criteria or []))}
        )
        if not self.probabilities or set(self.probabilities) != labels:
            raise ValueError("Probabilities do not cover the requested options")
        if abs(sum(self.probabilities.values()) - 1) > 0.02:
            raise ValueError("Probabilities must sum to one")
        if self.type == "choice" and self.choice not in labels:
            raise ValueError("Answer is outside the requested choices")
        if self.type == "score" and not (
            self.score is not None and 0 <= self.score <= len(labels) - 1
        ):
            raise ValueError("Score is outside the requested rubric")


class Result(BaseModel):
    model: str
    answers: dict[str, Answer]
    input_tokens: int = Field(default=0, ge=0)
    cached: int = 0

    @property
    def nouls(self) -> dict[str, Answer]:
        return {key: answer for key, answer in self.answers.items() if answer.type == "noul"}

    @property
    def choices(self) -> dict[str, Answer]:
        return {key: answer for key, answer in self.answers.items() if answer.type == "choice"}


class Provider(Protocol):
    identity: str

    async def evaluate(
        self, *, model: str, state: dict, questions: dict[str, Question]
    ) -> Result: ...
