"""Jev and compatible local-model HTTP adapters. Domain checks never import an SDK."""

import hashlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from litestar import Litestar

from storytool.config import get_settings
from storytool.domain.decisions.types import Answer, Question, Result

_http: httpx.AsyncClient | None = None


def http_client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=20, follow_redirects=False)
    return _http


@asynccontextmanager
async def decisions_lifespan(app: Litestar) -> AsyncIterator[None]:
    yield
    global _http
    if _http is not None:
        await _http.aclose()
        _http = None


class HTTPProvider:
    """Local adapters accept model/state/questions and return model/answers/usage.

    A different local wire format can implement Provider instead; no changes to scoring,
    cache or callers are required. Credentials are passed as headers, never state.
    """

    def __init__(self, endpoint: str, api_key: str | None, name: str) -> None:
        self.endpoint = endpoint
        self.api_key = api_key
        self.identity = name + ":" + hashlib.sha256(endpoint.encode()).hexdigest()

    async def evaluate(self, *, model: str, state: dict, questions: dict[str, Question]) -> Result:
        response = await http_client().post(
            self.endpoint,
            headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
            json={
                "model": model,
                "state": state,
                "questions": {
                    key: question.model_dump(exclude_none=True)
                    for key, question in questions.items()
                },
            },
        )
        response.raise_for_status()
        payload = response.json()
        if set(payload.get("answers", {})) != set(questions):
            raise ValueError("Provider did not answer exactly the requested questions")
        answers = {}
        for key, value in payload["answers"].items():
            # The score legend is request-owned advice, not provider-generated text.
            answer = Answer.model_validate(
                {field: value[field] for field in Answer.model_fields if field in value}
            )
            answer.check_question(questions[key])
            answers[key] = answer
        return Result(
            model=payload.get("model", model),
            answers=answers,
            input_tokens=payload.get("usage", {}).get("input_tokens", 0),
        )


def shared_provider() -> tuple[HTTPProvider, str]:
    settings = get_settings()
    if settings.decision_provider == "local":
        if not settings.decision_endpoint or not settings.decision_model:
            raise ValueError("Local decision endpoint and model are required")
        return HTTPProvider(
            settings.decision_endpoint, settings.decision_api_key, "local"
        ), settings.decision_model
    if not settings.jev_noticing_available:
        raise ValueError("Shared reader not configured")
    return HTTPProvider(
        "https://api.typesafe.ai/v1/systemone", settings.typesafe_api_key, "typesafe"
    ), settings.decision_model or settings.jev_model
