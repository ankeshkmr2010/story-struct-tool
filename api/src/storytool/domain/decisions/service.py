"""Provider-neutral per-question caching and atomic, independent spend reservations."""

import asyncio
import hashlib
import json
import logging
import time
import weakref
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from storytool.config import get_settings
from storytool.domain.decisions.models import DecisionBudget, DecisionCache
from storytool.domain.decisions.types import Answer, Provider, Question, Result

logger = logging.getLogger("storytool.decisions")
_locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
_gate = asyncio.Semaphore(4)


@dataclass(frozen=True)
class Actor:
    key: str
    user_id: UUID | None = None

    @classmethod
    def user(cls, user_id: UUID) -> "Actor":
        return cls(hashlib.sha256(f"user:{user_id}".encode()).hexdigest(), user_id)

    @classmethod
    def anonymous(cls, server_identity: str) -> "Actor":
        # Callers must use a server-issued identity, never a client-selected quota key.
        return cls(hashlib.sha256(f"anonymous:{server_identity}".encode()).hexdigest())


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


class DecisionUnavailable(Exception):
    """Missing coverage, not an authoring failure; callers retain usable local results."""


class DecisionService:
    def __init__(self, db: AsyncSession, actor: Actor, provider: Provider) -> None:
        if db.bind is None:
            raise DecisionUnavailable("Database unavailable")
        # Never commit the author's transaction or roll back their edits for derived data.
        self.sessions = async_sessionmaker(db.bind, expire_on_commit=False)
        self.actor = actor
        self.provider = provider

    async def evaluate(self, *, model: str, state: dict, questions: dict[str, Question]) -> Result:
        if not questions:
            return Result(model=model, answers={})
        state_json = canonical(state)
        scope = canonical(
            {
                "actor": self.actor.key,
                "provider": self.provider.identity,
                "model": model,
                "contract": 1,
                "state": state_json,
            }
        )
        keys = {
            name: hashlib.sha256((scope + canonical(question.model_dump())).encode()).hexdigest()
            for name, question in questions.items()
        }
        lock_key = hashlib.sha256((scope + canonical(sorted(keys.values()))).encode()).hexdigest()
        lock = _locks.setdefault(lock_key, asyncio.Lock())
        try:
            async with lock:
                return await self._evaluate(model, state, state_json, questions, keys)
        except DecisionUnavailable:
            raise
        except Exception as error:
            logger.warning("Scene reader unavailable (%s)", type(error).__name__)
            raise DecisionUnavailable("Scene reader temporarily unavailable") from None

    async def choose_large(
        self, *, model: str, state: dict, instructions: str, options: dict[str, str]
    ) -> Result:
        from storytool.domain.decisions.types import Choice, Score

        if len(options) <= 255:
            return await self.evaluate(
                model=model,
                state=state,
                questions={"choice": Choice(instructions=instructions, criteria=options)},
            )
        if "none" not in options:
            raise DecisionUnavailable("Large option sets require a none option")
        candidates = {
            hashlib.sha256(label.encode()).hexdigest(): label
            for label in options
            if label != "none"
        }
        screening = await self.evaluate(
            model=model,
            state=state,
            questions={
                key: Score(
                    instructions=f"For this question: {instructions}\n"
                    f"How well does this option fit the state? "
                    f"Option data: {canonical({label: options[label]})}",
                    criteria=["Does not fit", "Weak fit", "Plausible fit", "Strong fit"],
                )
                for key, label in candidates.items()
            },
        )
        ranked = sorted(
            candidates,
            key=lambda key: (
                screening.answers[key].score or 0,
                screening.answers[key].confidence or 0,
            ),
            reverse=True,
        )[:254]
        shortlist = {candidates[key]: options[candidates[key]] for key in ranked}
        shortlist["none"] = options["none"]
        result = await self.evaluate(
            model=model,
            state=state,
            questions={"choice": Choice(instructions=instructions, criteria=shortlist)},
        )
        return result.model_copy(
            update={
                "input_tokens": screening.input_tokens + result.input_tokens,
                "cached": screening.cached + result.cached,
            }
        )

    async def _evaluate(
        self,
        model: str,
        state: dict,
        state_json: str,
        questions: dict[str, Question],
        keys: dict[str, str],
    ) -> Result:
        now = datetime.now(UTC)
        async with self.sessions() as db:
            rows = await db.execute(
                select(
                    DecisionCache.fingerprint,
                    DecisionCache.answer,
                    DecisionCache.model,
                    DecisionCache.actor_key,
                    DecisionCache.provider,
                ).where(
                    DecisionCache.fingerprint.in_(keys.values()), DecisionCache.expires_at > now
                )
            )
            cached = {row.fingerprint: row for row in rows}
            legacy = [
                row.fingerprint for row in cached.values() if not row.actor_key or not row.provider
            ]
            if legacy:
                await db.execute(
                    update(DecisionCache)
                    .where(DecisionCache.fingerprint.in_(legacy))
                    .values(actor_key=self.actor.key, provider=self.provider.identity)
                )
                await db.commit()
        answers = {}
        missing = {}
        for name, question in questions.items():
            row = cached.get(keys[name])
            if row is not None:
                answer = Answer.model_validate(row.answer)
                answer.check_question(question)
                answers[name] = answer
            else:
                missing[name] = question
        cached_count = len(answers)
        total_tokens = 0
        result_model = next(iter(cached.values())).model if cached else model
        # Conservative UTF-8 byte ceilings are upper bounds, not a tokenizer estimate.
        # Leave headroom under TypeSafe's 32k state+longest and 64k total token budgets.
        state_size = len(state_json.encode())
        batches: list[dict[str, Question]] = []
        batch: dict[str, Question] = {}
        size = state_size
        for name, question in missing.items():
            question_size = len(canonical(question.model_dump()).encode()) + len(name.encode()) + 32
            if state_size + question_size > 30000:
                raise DecisionUnavailable(
                    "Scene or question exceeds the reader's safe context limit"
                )
            if batch and size + question_size > 60000:
                batches.append(batch)
                batch = {}
                size = state_size
            batch[name] = question
            size += question_size
        if batch:
            batches.append(batch)
        for batch in batches:
            reservation = (
                state_size
                + len(
                    canonical(
                        {name: question.model_dump() for name, question in batch.items()}
                    ).encode()
                )
                + 512
            )
            async with _gate:
                reservation_day = await self._reserve(reservation)
                started = time.monotonic()
                try:
                    async with asyncio.timeout(get_settings().decision_timeout_seconds):
                        result = await self.provider.evaluate(
                            model=model, state=state, questions=batch
                        )
                    if set(result.answers) != set(batch):
                        raise ValueError("Incomplete decision response")
                    for name, answer in result.answers.items():
                        answer.check_question(batch[name])
                    await self._record(
                        batch,
                        keys,
                        result,
                        int((time.monotonic() - started) * 1000),
                        model,
                        reservation_day,
                    )
                except Exception:
                    await self._record_failure(
                        int((time.monotonic() - started) * 1000), reservation_day
                    )
                    raise
            answers.update(result.answers)
            total_tokens += result.input_tokens
            result_model = result.model
        return Result(
            model=result_model,
            answers=answers,
            input_tokens=total_tokens,
            cached=cached_count,
            cache_keys=keys,
        )

    async def _reserve(self, tokens: int) -> date:
        settings = get_settings()
        now = datetime.now(UTC)
        minute = now.replace(second=0, microsecond=0)
        global_actor = hashlib.sha256(b"shared-reader-budget").hexdigest()
        limits = [
            (global_actor, None, settings.decision_global_daily_tokens, 600),
            (
                self.actor.key,
                self.actor.user_id,
                settings.decision_user_daily_tokens
                if self.actor.user_id
                else settings.decision_anonymous_daily_tokens,
                settings.decision_user_calls_per_minute
                if self.actor.user_id
                else settings.decision_anonymous_calls_per_minute,
            ),
        ]
        async with self.sessions.begin() as db:
            # Consistent lock order; both reservations succeed or neither is charged.
            for actor, owner, daily_limit, minute_limit in sorted(limits):
                await db.execute(
                    insert(DecisionBudget)
                    .values(
                        actor=actor,
                        user_id=owner,
                        day=now.date(),
                        minute=minute,
                        minute_calls=0,
                        calls=0,
                        reserved_tokens=0,
                        input_tokens=0,
                        failures=0,
                        latency_ms=0,
                    )
                    .on_conflict_do_nothing(index_elements=["actor", "day"])
                )
                budget = await db.scalar(
                    select(DecisionBudget)
                    .where(DecisionBudget.actor == actor, DecisionBudget.day == now.date())
                    .with_for_update()
                )
                if budget is None:
                    raise DecisionUnavailable("Reader budget unavailable")
                if budget.minute != minute:
                    budget.minute = minute
                    budget.minute_calls = 0
                if (
                    budget.reserved_tokens + tokens > daily_limit
                    or budget.minute_calls >= minute_limit
                ):
                    raise DecisionUnavailable("Shared reader usage limit reached; try later")
                budget.minute_calls += 1
                budget.calls += 1
                budget.reserved_tokens += tokens
        return now.date()

    async def _record(
        self,
        questions: dict[str, Question],
        keys: dict[str, str],
        result: Result,
        latency: int,
        requested_model: str,
        reservation_day: date,
    ) -> None:
        settings = get_settings()
        now = datetime.now(UTC)
        ttl = settings.decision_cache_days * 86400
        if model_alias(requested_model) or model_alias(result.model):
            ttl = min(ttl, 900)
        async with self.sessions.begin() as db:
            # Expired answers contain no raw state; remove in bounded batches.
            expired = select(DecisionCache.id).where(DecisionCache.expires_at < now).limit(100)
            await db.execute(delete(DecisionCache).where(DecisionCache.id.in_(expired)))
            for name in questions:
                statement = insert(DecisionCache).values(
                    fingerprint=keys[name],
                    actor_key=self.actor.key,
                    provider=self.provider.identity,
                    user_id=self.actor.user_id,
                    answer=result.answers[name].model_dump(),
                    model=result.model,
                    expires_at=now + timedelta(seconds=ttl),
                )
                await db.execute(
                    statement.on_conflict_do_update(
                        index_elements=["fingerprint"],
                        set_={
                            "actor_key": self.actor.key,
                            "provider": self.provider.identity,
                            "answer": statement.excluded.answer,
                            "model": result.model,
                            "expires_at": statement.excluded.expires_at,
                        },
                    )
                )
            await self._metrics(db, result.input_tokens, latency, False, reservation_day)

    async def _record_failure(self, latency: int, reservation_day: date) -> None:
        # Reservations are not refunded: timeouts can still have been billed by the provider.
        async with self.sessions.begin() as db:
            await self._metrics(db, 0, latency, True, reservation_day)

    async def _metrics(
        self, db: AsyncSession, tokens: int, latency: int, failed: bool, reservation_day: date
    ) -> None:

        actors = [self.actor.key, hashlib.sha256(b"shared-reader-budget").hexdigest()]
        await db.execute(
            update(DecisionBudget)
            .where(DecisionBudget.actor.in_(actors), DecisionBudget.day == reservation_day)
            .values(
                input_tokens=DecisionBudget.input_tokens + tokens,
                latency_ms=DecisionBudget.latency_ms + latency,
                failures=DecisionBudget.failures + int(failed),
            )
        )


def model_alias(model: str) -> bool:
    return model.endswith(("-latest", "-preview"))
