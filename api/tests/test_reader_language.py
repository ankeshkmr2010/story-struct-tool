"""Story-language AI reading: the shared reader is told a non-English story's language.

Pure: run with pytest --noconftest.
"""

import asyncio

from storytool.domain.decisions.service import with_language
from storytool.domain.decisions.types import Result
from storytool.domain.noticing.deterministic import DeterministicNoticer
from storytool.domain.noticing.jev import JevNoticer


def test_english_stories_are_sent_unchanged() -> None:
    state = {"scene": "She runs."}
    assert with_language(state, "en-US") is state
    assert with_language(state, "en-GB") is state
    assert with_language(state, None) is state


def test_other_languages_are_named_for_the_reader() -> None:
    state = with_language({"scene": "Elle court."}, "fr")
    assert state["scene"] == "Elle court."
    assert "French" in state["writing_language"]
    assert "Brazilian Portuguese" in with_language({}, "pt-BR")["writing_language"]
    assert with_language(state, "de") == state  # Never stacked or overwritten.


def test_jev_noticer_passes_the_language() -> None:
    seen: list[dict] = []

    class Client:
        async def evaluate(self, *, model: str, state: dict, questions: dict) -> Result:
            seen.append(state)
            return Result(model=model, answers={})

    noticer = JevNoticer(client=Client(), model="m", deterministic=DeterministicNoticer())
    asyncio.run(noticer.notice_scene("Elle court vers le port.", (), language="fr"))
    assert "French" in seen[0]["writing_language"]
