"""Dialogue voice: do two characters sound alike?

Deterministic first. Quoted dialogue is attributed from speech tags ("said Maya") or a line of
action that names exactly one character; anything else stays unattributed rather than guessed.
Each character with enough lines gets a voice profile (sentence length, vocabulary range, everyday
words, questions and exclamations, contractions, favourite openings and repeated phrases), and
close pairs become findings with their own lines as evidence.

The shared reader (Jev) can refine it (`refine_with_reader`): it picks the speaker of untagged
lines among the scene's characters, kept only above the confidence floor, and is asked whether a
flagged pair reads as two distinct voices. Counting stays in code; Jev only judges. English only
for now: the everyday-word list and speech verbs are English.
"""

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from storytool.domain.evaluation.engine import (
    EvaluationFinding,
    EvaluationResult,
    Evaluator,
    register,
)
from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity
from storytool.domain.prose_scan import Passage, excerpt_around, paragraph_spans, visible_text

MIN_LINES = 10
FLAG = 0.88
# Below this a pair is not shown at all; on real stories the shared reader heard pairs under it
# as distinct voices, so they were noise.
NEAR = 0.85
QUOTES = re.compile(
    r"“([^”\n]+)”"
    r"|\"([^\"\n]+)\""
    r"|‘((?:[^’\n]|(?<=\w)’(?=\w))+?)’"  # noqa: RUF001 (curly quotes are the point)
    r"|(?<!\w)'((?:[^'\n]|(?<=\w)'(?=\w))+?)'(?!\w)"
)
SPEECH = re.compile(
    r"\b(said|says|asked|asks|replied|whispered|shouted|muttered|called|answered|added|cried|"
    r"snapped|told|murmured|yelled|sighed|laughed|insisted|admitted|demanded|began|went on)\b",
    re.IGNORECASE,
)
WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")  # noqa: RUF001
EVERYDAY = [
    "the",
    "a",
    "an",
    "and",
    "but",
    "or",
    "so",
    "i",
    "you",
    "we",
    "it",
    "that",
    "this",
    "not",
    "no",
    "yes",
    "just",
    "well",
    "like",
    "really",
    "very",
    "oh",
    "what",
    "why",
    "how",
    "is",
    "are",
    "was",
    "be",
    "do",
    "can",
    "will",
    "would",
    "me",
    "my",
    "your",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "now",
    "then",
    "there",
    "here",
    "all",
    "some",
    "maybe",
    "please",
    "sorry",
    "yeah",
    "okay",
    "um",
    "uh",
    "right",
    "look",
    "listen",
    "know",
    "think",
    "mean",
    "never",
    "always",
]


@dataclass
class Line:
    scene_id: UUID
    text: str
    passage: Passage
    paragraph_text: str
    speaker: UUID | None = None
    by_reader: bool = False


@dataclass
class Voice:
    character_id: UUID
    name: str
    lines: list[Line] = field(default_factory=list)


def _names(g: StoryGraph) -> dict[str, UUID]:
    """Every way the text can name a character: full name, a unique first name, aliases."""
    variants: dict[str, set[UUID]] = {}
    for character in g.characters:
        names = {character.name, *(character.aliases or [])}
        first = character.name.split()[0] if character.name else ""
        if len(first) >= 3:
            names.add(first)
        for name in names:
            if name and name.strip():
                variants.setdefault(name.strip(), set()).add(character.id)
    return {name: next(iter(ids)) for name, ids in variants.items() if len(ids) == 1}


def _mentioned(text: str, names: dict[str, UUID]) -> set[UUID]:
    return {
        character
        for name, character in names.items()
        if re.search(rf"(?<!\w){re.escape(name)}(?!\w)", text)
    }


def extract(g: StoryGraph) -> list[Line]:
    """Every quoted line in reading order, attributed where the text makes the speaker clear."""
    names = _names(g)
    lines: list[Line] = []
    for scene in g.scenes_in_reading_order():
        for number, (offset, paragraph) in enumerate(paragraph_spans(scene.content), start=1):
            visible = visible_text(paragraph)
            quotes = list(QUOTES.finditer(visible))
            if not quotes:
                continue
            outside = QUOTES.sub(" ", visible)
            mentioned = _mentioned(outside, names)
            speaker = next(iter(mentioned)) if len(mentioned) == 1 else None
            for match in quotes:
                text = next(group for group in match.groups() if group is not None).strip()
                if not WORD.search(text):
                    continue
                start, end = match.span()
                lines.append(
                    Line(
                        scene_id=scene.id,
                        text=text,
                        passage=Passage(
                            scene_id=scene.id,
                            paragraph=number,
                            find=paragraph[start:end],
                            start=offset + start,
                            end=offset + end,
                            excerpt=excerpt_around(paragraph, start, end),
                        ),
                        paragraph_text=paragraph,
                        # A tag or a single named character in the paragraph settles it.
                        speaker=speaker
                        if speaker and (SPEECH.search(outside) or outside.strip())
                        else None,
                    )
                )
    return lines


def _sentences(text: str) -> list[str]:
    return [part for part in re.split(r"(?<=[.!?…])\s+", text) if WORD.search(part)]


def profile(lines: list[Line]) -> dict[str, Any]:
    words = [
        w.lower().replace("’", "'")  # noqa: RUF001
        for line in lines
        for w in WORD.findall(line.text)
    ]
    sentences = [s for line in lines for s in _sentences(line.text)]
    count = Counter(words)
    total = max(len(words), 1)
    sample = words[:400]
    openers = Counter(
        WORD.findall(line.text)[0].lower() for line in lines if WORD.findall(line.text)
    )
    opener, opener_count = openers.most_common(1)[0] if openers else ("", 0)
    phrases: Counter[str] = Counter()
    for line in lines:
        tokens = [w.lower() for w in WORD.findall(line.text)]
        seen = {" ".join(tokens[i : i + n]) for n in (2, 3) for i in range(len(tokens) - n + 1)}
        phrases.update(seen)
    tics = [
        phrase
        for phrase, used in phrases.most_common(20)
        if used >= 3 and not all(part in EVERYDAY[:9] for part in phrase.split())
    ][:3]
    return {
        "lines": len(lines),
        "sentence_words": sum(len(WORD.findall(s)) for s in sentences) / max(len(sentences), 1),
        "range": len(set(sample)) / max(len(sample), 1),
        "questions": sum(line.text.rstrip().endswith("?") for line in lines) / max(len(lines), 1),
        "exclamations": sum(line.text.rstrip().endswith("!") for line in lines)
        / max(len(lines), 1),
        "contractions": sum("'" in w for w in words) / total,
        "everyday": [count[w] / total for w in EVERYDAY],
        "opener": opener if opener_count / max(len(lines), 1) >= 0.3 else "",
        "tics": tics,
    }


def similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    dot = sum(x * y for x, y in zip(a["everyday"], b["everyday"], strict=True))
    norm = math.sqrt(sum(x * x for x in a["everyday"])) * math.sqrt(
        sum(y * y for y in b["everyday"])
    )
    cosine = dot / norm if norm else 0.0
    longest = max(a["sentence_words"], b["sentence_words"], 1)
    gaps = [
        abs(a["sentence_words"] - b["sentence_words"]) / longest,
        abs(a["questions"] - b["questions"]),
        abs(a["exclamations"] - b["exclamations"]),
        min(1.0, abs(a["contractions"] - b["contractions"]) * 3),
        min(1.0, abs(a["range"] - b["range"]) * 2),
    ]
    return 0.5 * cosine + 0.5 * (1 - sum(gaps) / len(gaps))


def reasons(a: dict[str, Any], b: dict[str, Any]) -> list[str]:
    out = []
    if (
        abs(a["sentence_words"] - b["sentence_words"])
        / max(a["sentence_words"], b["sentence_words"], 1)
        < 0.15
    ):
        out.append(
            "both average about "
            f"{round((a['sentence_words'] + b['sentence_words']) / 2)} words a sentence"
        )
    if a["opener"] and a["opener"] == b["opener"]:
        out.append(f"both often start with “{a['opener'].capitalize()}”")
    shared = [tic for tic in a["tics"] if tic in b["tics"]]
    if shared:
        out.append(f"both repeat “{shared[0]}”")
    if abs(a["questions"] - b["questions"]) < 0.08 and min(a["questions"], b["questions"]) >= 0.2:
        out.append("both ask a lot of questions")
    # Only a habit worth naming when both are unusual: most characters contract at similar rates.
    rates = (a["contractions"], b["contractions"])
    if min(rates) >= 0.08:
        out.append("both use a lot of contractions")
    elif max(rates) <= 0.005:
        out.append("neither uses contractions")
    return out or ["very similar everyday words and rhythm"]


def typical(lines: list[Line]) -> Line:
    """A line that shows the voice: 8+ words near their usual length, else the longest."""
    sized = sorted(lines, key=lambda line: len(WORD.findall(line.text)))
    usual = len(WORD.findall(sized[len(sized) // 2].text))
    full = [line for line in lines if len(WORD.findall(line.text)) >= 8]
    if not full:
        return sized[-1]
    return min(full, key=lambda line: abs(len(WORD.findall(line.text)) - max(usual, 8)))


def _quote(line: Line) -> str:
    text = " ".join(line.text.split())
    return text if len(text) <= 70 else text[:67].rsplit(" ", 1)[0] + "…"


def compare(
    names: dict[UUID, str],
    lines: list[Line],
    confirmed: dict[frozenset[UUID], float] | None = None,
) -> EvaluationResult:
    """Findings for close pairs. `confirmed` holds the reader's chance that a pair is distinct."""
    voices: dict[UUID, Voice] = {}
    for line in lines:
        if line.speaker in names:
            voices.setdefault(line.speaker, Voice(line.speaker, names[line.speaker])).lines.append(
                line
            )
    ready = [voice for voice in voices.values() if len(voice.lines) >= MIN_LINES]
    profiles = {voice.character_id: profile(voice.lines) for voice in ready}
    attributed = sum(1 for line in lines if line.speaker in names)
    findings: list[EvaluationFinding] = []
    pairs: list[dict[str, Any]] = []
    for index, a in enumerate(ready):
        for b in ready[index + 1 :]:
            score = similarity(profiles[a.character_id], profiles[b.character_id])
            if score < NEAR:
                continue
            key = frozenset({a.character_id, b.character_id})
            distinct = (confirmed or {}).get(key)
            # A problem only when the numbers say alike and the reader (if asked) agrees.
            uncertain = score < FLAG or (distinct is not None and distinct > 0.4)
            why = reasons(profiles[a.character_id], profiles[b.character_id])
            message = (
                f"{a.name} and {b.name} sound alike: {'; '.join(why)}. "
                f"{a.name}: “{_quote(typical(a.lines))}” {b.name}: “{_quote(typical(b.lines))}”"
            )
            if distinct is not None and distinct > 0.4:
                message += (
                    " The shared reader hears two distinct voices, so this is worth a look only."
                )
            findings.append(
                EvaluationFinding(
                    code="dialogue.similar_voices",
                    severity=Severity.INFO if uncertain else Severity.WARNING,
                    message=message,
                    entity_type="character",
                    entity_id=a.character_id,
                    passage=typical(a.lines).passage,
                    uncertain=uncertain,
                )
            )
            pairs.append(
                {"a": a.name, "b": b.name, "score": round(score, 2), "reader_distinct": distinct}
            )
    if len(ready) < 2:
        findings.append(
            EvaluationFinding(
                code="dialogue.too_few_lines",
                severity=Severity.INFO,
                message=(
                    f"{len(ready)} {'character has' if len(ready) == 1 else 'characters have'} "
                    f"{MIN_LINES} or more lines with a clear speaker, so voices cannot be compared "
                    f"yet. {len(lines) - attributed} of {len(lines)} lines have no clear speaker; "
                    "a speech tag (“said Maya”) settles one."
                ),
            )
        )
    return EvaluationResult(
        findings=tuple(findings),
        visual={
            "lines": len(lines),
            "attributed": attributed,
            "by_reader": sum(1 for line in lines if line.by_reader),
            "characters": [
                {"name": voice.name, "lines": len(voice.lines)}
                for voice in sorted(voices.values(), key=lambda v: -len(v.lines))
            ],
            "pairs": pairs,
        },
    )


def _missing(g: StoryGraph) -> list[str]:
    missing = []
    if not any(scene.content for scene in g.scenes_in_reading_order()):
        missing.append("Write prose with dialogue in a scene that is placed in a chapter")
    if len(g.characters) < 2:
        missing.append("Add at least two characters")
    return missing


def run_check(g: StoryGraph) -> EvaluationResult:
    return compare({c.id: c.name for c in g.characters}, extract(g))


@dataclass
class Prepared:
    """Everything the shared-reader pass needs, as plain values: the caller releases its database
    transaction before the remote calls, and ORM objects cannot be read after that."""

    names: dict[UUID, str]
    lines: list[Line]
    cast: dict[UUID, set[UUID]]
    scene_text: dict[UUID, str]


def prepare(g: StoryGraph) -> Prepared:
    return Prepared(
        names={c.id: c.name for c in g.characters},
        lines=extract(g),
        cast={scene: set(ids) for scene, ids in g.characters_in_scene().items()},
        scene_text={scene.id: scene.content or "" for scene in g.scenes},
    )


async def refine_with_reader(
    data: Prepared, service: Any, model: str, threshold: float
) -> EvaluationResult:
    """The deterministic result, with the shared reader attributing untagged lines (one call per
    scene, kept above `threshold`) and judging each close pair as distinct voices or not."""
    from storytool.domain.decisions.types import Choice, Noul

    lines, names = data.lines, data.names
    by_scene: dict[UUID, list[Line]] = {}
    for line in lines:
        if line.speaker is None:
            by_scene.setdefault(line.scene_id, []).append(line)
    for scene_id, pending in by_scene.items():
        options = {str(c): names[c] for c in data.cast.get(scene_id, set()) if c in names}
        if len(options) < 2:
            continue
        options["unclear"] = "The text does not make the speaker clear"
        questions = {
            f"line{index}": Choice(
                instructions=(
                    f"Who speaks this quoted line in the scene: “{line.text[:300]}”? Use only the "
                    "scene text: speech tags, who was addressed, turn-taking. If it is not clear, "
                    "answer unclear."
                ),
                criteria=options,
            )
            for index, line in enumerate(pending[:40])
        }
        result = await service.evaluate(
            model=model,
            state={"scene": data.scene_text.get(scene_id, "")[:20000]},
            questions=questions,
        )
        for index, line in enumerate(pending[:40]):
            answer = result.answers.get(f"line{index}")
            if (
                answer
                and answer.choice not in (None, "unclear")
                and (answer.confidence or 0) >= threshold
            ):
                line.speaker, line.by_reader = UUID(answer.choice), True
    first = compare(names, lines)
    confirmed: dict[frozenset[UUID], float] = {}
    voices: dict[UUID, list[Line]] = {}
    for line in lines:
        if line.speaker in names:
            voices.setdefault(line.speaker, []).append(line)
    by_name = {name: key for key, name in names.items()}
    for pair in first.visual["pairs"]:
        a, b = by_name[pair["a"]], by_name[pair["b"]]
        result = await service.evaluate(
            model=model,
            state={
                "first": [line.text for line in voices[a][:12]],
                "second": [line.text for line in voices[b][:12]],
            },
            questions={
                "distinct": Noul(
                    instructions=(
                        "These are lines of dialogue from two characters in one novel. Do they "
                        "read as two distinct voices, in word choice, rhythm and habits of speech?"
                    ),
                    criteria={
                        "true": "A reader could tell the speakers apart without speech tags.",
                        "false": (
                            "The lines could be swapped between the two without anyone noticing."
                        ),
                    },
                )
            },
        )
        answer = result.answers.get("distinct")
        if answer and answer.noul is not None:
            confirmed[frozenset({a, b})] = answer.noul
    return compare(names, lines, confirmed)


DIALOGUE_VOICE = register(
    Evaluator(
        id="dialogue_voice",
        name="Dialogue voice",
        description=(
            "Finds characters who sound alike: similar sentence length, everyday words, "
            "questions and exclamations, favourite openings and repeated phrases, with their "
            f"own lines as evidence. Each character needs {MIN_LINES} lines with a clear "
            "speaker; the shared reader, when available, can work out more speakers and "
            "double-check each pair. English for now."
        ),
        inputs=("scene.content", "character.name", "character.aliases"),
        missing=_missing,
        run=run_check,
        reads_prose=True,
    )
)
