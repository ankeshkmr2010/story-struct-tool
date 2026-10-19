"""Smart consistency: misspelt names, sound-alikes and terms written more than one way.

Pure functions over the story graph; nothing is stored. One pass indexes every word of the
placed prose (reading order, through `prose_scan`), then four reports read that index:

- Names: capitalised words that resemble a character, place or glossary name or alias.
  Candidates come from Jaro-Winkler similarity (built for short names), edit distance and
  Double Metaphone (sound-alikes). Each is then weighed by how often the two spellings
  appear and by who is in the scenes where the variant appears -- the scene's POV, its
  confirmed character mentions, its place, or the known name written nearby. A rare variant
  beside a common name is a likely typo; two spellings in steady use may be two people.
- Spelling: words spelled for the other side of the Atlantic from the story's language.
- Hyphenation: one term written closed, open and hyphenated (lanternkeeper, lantern keeper,
  lantern-keeper).
- Capitalisation: one word capitalised in some mid-sentence uses and not in others.

Every finding says why it was raised, carries the passage of its first occurrence, and
offers remedies: replace every occurrence (verified edits), add an alias or character, or
keep both -- remembered in `story.consistency_exceptions` under the finding's key.
"""

import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from uuid import UUID

from metaphone import doublemetaphone
from rapidfuzz.distance import OSA, JaroWinkler

from storytool.domain.enums import Language
from storytool.domain.evaluation.engine import EvaluationFinding, FindingAction, TextEdit
from storytool.domain.graph import StoryGraph
from storytool.domain.health import Severity
from storytool.domain.noticing.deterministic import NOT_NAMES
from storytool.domain.prose_scan import NameSource, ProseMatch, scan
from storytool.domain.spelling_variants import preferred_spellings

__all__ = ("check", "name_sources", "resembled_name")

MAX_PER_SECTION = 60
JW_ALONE = 0.93
JW_WITH_SOUND = 0.85
TYPO_RATIO = 0.25
TWO_PEOPLE_RATIO = 0.5
_HYPHENS = "-\u2010"
_WORD = re.compile(r"[^\W\d_]+(?:[-\u2010][^\W\d_]+)*")
_PAIR = re.compile(r"(?=(?<![\w\u2010-])([^\W\d_]+)[ \t]+([^\W\d_]+)(?![\w\u2010-]))")
_OPENERS = "\"'\u201c\u2018([*_\u2014\u2013- \t"
_SENTENCE_END = ".!?\u2026\n"
_NOT_NAMES = frozenset(word.casefold() for word in NOT_NAMES)
# Closed and open forms that are different words, not inconsistent spellings.
_SEPARATE_WORDS = frozenset(
    """
    everyone anyone someone noone everybody anybody somebody nobody everything anything
    something nothing anyway anyways everyday maybe altogether already alright awhile sometime
    sometimes onto into upon cannot apart inside outside overall forever together however
    whatever whenever wherever himself herself itself myself yourself ourselves themselves
    without within another today tonight tomorrow nowadays
    """.split()  # noqa: SIM905 - a word list reads best as text
)
_FUNCTION_WORDS = frozenset(
    """
    the a an and or but of to in on at by for with from as is was are were be been it its he
    she they we you his her their our your this that these those not no so if then there
    """.split()  # noqa: SIM905
)
_LANGUAGE_NAMES = {Language.EN_US: "American English", Language.EN_GB: "British English"}


@dataclass(frozen=True, slots=True)
class _Word:
    match: ProseMatch
    sentence_start: bool

    @property
    def text(self) -> str:
        return self.match.text

    @property
    def fold(self) -> str:
        return self.match.text.casefold()

    @property
    def capitalised(self) -> bool:
        return self.match.text[0].isupper()

    @property
    def acronym(self) -> bool:
        return len(self.match.text) > 1 and self.match.text.isupper()


def _starts_sentence(text: str, start: int) -> bool:
    index = start - 1
    while index >= 0 and text[index] in _OPENERS:
        index -= 1
    return index < 0 or text[index] in _SENTENCE_END


def _words(text: str) -> Iterator[tuple[int, int, dict[str, str]]]:
    for found in _WORD.finditer(text):
        start = "1" if _starts_sentence(text, found.start()) else ""
        yield found.start(), found.end(), {"sentence_start": start}


class _Index:
    """Every word of the placed prose, grouped by lower-case form."""

    def __init__(self, g: StoryGraph) -> None:
        self.scenes = g.scenes_in_reading_order()
        self.by_fold: dict[str, list[_Word]] = defaultdict(list)
        self.lower: set[str] = set()
        for match in scan(self.scenes, _words):
            word = _Word(match, bool(match.details["sentence_start"]))
            self.by_fold[word.fold].append(word)
            if not word.capitalised:
                self.lower.add(word.fold)

    def scenes_with(self, fold: str) -> set[UUID]:
        return {word.match.scene.id for word in self.by_fold.get(fold, ())}


def name_sources(g: StoryGraph) -> list[NameSource]:
    return [
        *(NameSource("character", c.id, c.name, tuple(c.aliases or ())) for c in g.characters),
        *(NameSource("location", place.id, place.name) for place in g.locations),
        *(
            NameSource("glossary_entry", entry.id, entry.term, tuple(entry.aliases or ()))
            for entry in g.glossary_entries
        ),
    ]


def _canon_tokens(sources: Iterable[NameSource]) -> dict[str, tuple[NameSource, str]]:
    """Each word of every defined name or alias -> (its source, its written form)."""
    tokens: dict[str, tuple[NameSource, str]] = {}
    for source in sources:
        for value in (source.name, *source.aliases):
            for token in re.findall(r"[^\W\d_]+", value):
                tokens.setdefault(token.casefold(), (source, token))
    return tokens


def _codes(word: str) -> set[str]:
    return {code for code in doublemetaphone(word) if len(code) >= 2}


@dataclass(frozen=True, slots=True)
class _Likeness:
    edits: int
    similarity: float
    sounds_alike: bool

    def describe(self) -> str:
        parts = [
            "one letter different"
            if self.edits == 1
            else "two letters different"
            if self.edits == 2
            else f"{round(self.similarity * 100)}% alike"
        ]
        if self.sounds_alike:
            parts.append("sounds the same")
        return " and ".join(parts)


def _likeness(variant: str, known: str) -> _Likeness | None:
    if variant in {known + "s", known + "es"} or len(known) < 3:
        return None
    allowed = 1 if len(known) <= 6 else 2
    edits = OSA.distance(variant, known, score_cutoff=allowed + 1)
    similarity = JaroWinkler.normalized_similarity(variant, known)
    sounds = bool(_codes(variant) & _codes(known))
    if len(known) == 3 and not (sounds and edits <= 1):
        return None
    if edits <= allowed or similarity >= JW_ALONE or (sounds and similarity >= JW_WITH_SOUND):
        return _Likeness(edits, similarity, sounds)
    return None


def _best_match(
    fold: str, canon: dict[str, tuple[NameSource, str]]
) -> tuple[str, _Likeness] | None:
    best: tuple[str, _Likeness] | None = None
    for known in canon:
        if abs(len(known) - len(fold)) > 3:
            continue
        likeness = _likeness(fold, known)
        if likeness and (
            best is None
            or (likeness.sounds_alike, likeness.similarity)
            > (best[1].sounds_alike, best[1].similarity)
        ):
            best = (known, likeness)
    return best


def resembled_name(name: str, g: StoryGraph) -> str | None:
    """The defined name an unknown name most resembles, for noticing's wording."""
    canon = _canon_tokens(name_sources(g))
    for token in re.findall(r"[^\W\d_]+", name):
        fold = token.casefold()
        if fold in canon:
            continue
        match = _best_match(fold, canon)
        if match:
            source, _ = canon[match[0]]
            return source.name
    return None


def _match_case(source: str, target: str) -> str:
    if len(source) > 1 and source.isupper():
        return target.upper()
    if source[0].isupper():
        return target[0].upper() + target[1:]
    return target[0].lower() + target[1:]


def _replace(label: str, words: Iterable[_Word], target: str) -> FindingAction:
    edits = tuple(
        TextEdit(passage=w.match.passage, replacement=_match_case(w.text, target))
        for w in words
        if w.text != _match_case(w.text, target)
    )
    return FindingAction(kind="replace", label=label, value=target, edits=edits)


def _keep(key: str, label: str = "Keep as is") -> FindingAction:
    return FindingAction(kind="keep", label=label, value=key)


def _times(n: int) -> str:
    return "once" if n == 1 else f"{n}\u00d7"


def _present(source: NameSource, scene_ids: set[UUID], g: StoryGraph, index: _Index) -> int:
    """How many of these scenes the named entity is known to be in."""
    scenes = {scene.id: scene for scene in index.scenes}
    mentioned = {s for s, c in g.character_mentions if c == source.entity_id}
    written = set().union(*(index.scenes_with(t) for t in source.tokens()))
    count = 0
    for scene_id in scene_ids:
        scene = scenes[scene_id]
        if (
            scene_id in written
            or (source.entity_type == "character" and scene.pov_character_id == source.entity_id)
            or (source.entity_type == "character" and scene_id in mentioned)
            or (source.entity_type == "location" and scene.location_id == source.entity_id)
        ):
            count += 1
    return count


def _names(g: StoryGraph, index: _Index, kept: set[str]) -> list[EvaluationFinding]:
    canon = _canon_tokens(name_sources(g))
    if not canon:
        return []
    findings: list[EvaluationFinding] = []
    for fold, words in index.by_fold.items():
        capitalised = [w for w in words if w.capitalised and not w.acronym and "-" not in w.text]
        if (
            len(fold) < 3
            or fold in canon
            or fold in _NOT_NAMES
            or fold in index.lower
            or len(capitalised) != len(words)
        ):
            continue
        match = _best_match(fold, canon)
        if match is None:
            continue
        known, likeness = match
        key = f"name:{fold}~{known}"
        if key in kept:
            continue
        source, written = canon[known]
        variant = words[0].text
        n_variant = len(words)
        n_known = len(index.by_fold.get(known, ()))
        where = {w.match.scene.id for w in words}
        present = _present(source, where, g, index)
        ratio = n_variant / max(n_known, 1)
        context = (
            f"{source.name} is in {present} of the {len(where)} scenes where it appears"
            if len(where) > 1
            else f"{source.name} is {'' if present else 'not '}in that scene"
        )
        why = f"{likeness.describe()}; {context}"
        if n_known == 0:
            code, uncertain = "names.sheet_differs", False
            message = (
                f"'{variant}' is used {_times(n_variant)} but {written} never appears ({why}). "
                f"If the prose is right, add '{variant}' as an alias; otherwise replace it."
            )
        elif ratio <= TYPO_RATIO and (present or likeness.sounds_alike or likeness.edits <= 1):
            code, uncertain = "names.likely_typo", False
            message = (
                f"'{variant}' ({_times(n_variant)}) is probably {written} "
                f"({_times(n_known)}): {why}."
            )
        elif n_variant >= 3 and ratio >= TWO_PEOPLE_RATIO and present * 2 < len(where):
            # In steady use, and mostly where the known name's owner is absent: maybe a second
            # person rather than a slip.
            code, uncertain = "names.similar_names", True
            message = (
                f"'{variant}' ({_times(n_variant)}) and {written} ({_times(n_known)}) look alike "
                f"({why}). If they are different people, readers may mix them up."
            )
        else:
            code, uncertain = "names.possible_typo", True
            message = (
                f"'{variant}' ({_times(n_variant)}) may be {written} ({_times(n_known)}): {why}."
            )
        actions = [_replace(f"Replace every '{variant}' with {written}", words, written)]
        if source.entity_type in {"character", "glossary_entry"}:
            actions.append(
                FindingAction(
                    kind="add_alias",
                    label=f"Add '{variant}' as an alias of {source.name}",
                    value=variant,
                    entity_type=source.entity_type,
                    entity_id=source.entity_id,
                )
            )
        if code == "names.similar_names" and source.entity_type == "character":
            actions.append(
                FindingAction(
                    kind="add_character", label=f"Add {variant} as a character", value=variant
                )
            )
        actions.append(_keep(key, "Keep both"))
        findings.append(
            EvaluationFinding(
                code=code,
                severity=Severity.INFO if uncertain else Severity.WARNING,
                message=message,
                entity_type=source.entity_type,
                entity_id=source.entity_id,
                passage=words[0].match.passage,
                actions=tuple(actions),
                uncertain=uncertain,
            )
        )
    findings.sort(key=lambda f: f.uncertain)
    return findings[:MAX_PER_SECTION]


def _spelling(g: StoryGraph, index: _Index, kept: set[str]) -> list[EvaluationFinding]:
    preferred = preferred_spellings(g.language)
    language = _LANGUAGE_NAMES.get(g.language, g.language)
    canon = _canon_tokens(name_sources(g))
    findings = []
    for fold, right in preferred.items():
        # A capital mid-sentence is a name (Mr Grey), not a spelling.
        words = [w for w in index.by_fold.get(fold, ()) if w.sentence_start or not w.capitalised]
        key = f"spelling:{fold}"
        if not words or fold in canon or key in kept:
            continue
        n_right = len(index.by_fold.get(right, ()))
        also = f", and '{right}' {_times(n_right)}" if n_right else ""
        findings.append(
            EvaluationFinding(
                code="spelling.language",
                severity=Severity.WARNING,
                message=(
                    f"'{words[0].text}' ({_times(len(words))}{also}): {language} spells it "
                    f"'{right}'. The story's language is set under Design."
                ),
                passage=words[0].match.passage,
                actions=(_replace(f"Replace with '{right}'", words, right), _keep(key)),
            )
        )
    findings.sort(key=lambda f: -len(f.actions[0].edits))
    if len(findings) >= 8 and g.language in _LANGUAGE_NAMES:
        other = Language.EN_GB if g.language == Language.EN_US else Language.EN_US
        findings.insert(
            0,
            EvaluationFinding(
                code="spelling.language_setting",
                severity=Severity.INFO,
                message=(
                    f"{len(findings)} different words follow {_LANGUAGE_NAMES[other]}. If that "
                    f"is how you write, set the story's language to {_LANGUAGE_NAMES[other]}."
                ),
                entity_type="story",
                entity_id=g.story.id,
                actions=(
                    FindingAction(
                        kind="set_language",
                        label=f"Use {_LANGUAGE_NAMES[other]} for this story",
                        value=other.value,
                    ),
                ),
            ),
        )
    return findings[:MAX_PER_SECTION]


def _pick(forms: Counter[str], preferred: str | None) -> str:
    if preferred and preferred in forms:
        return preferred
    return forms.most_common(1)[0][0]


def _hyphenation(g: StoryGraph, index: _Index, kept: set[str]) -> list[EvaluationFinding]:
    def key_of(text: str) -> str:
        return re.sub(r"[-\u2010\s]", "", text.casefold())

    hyphenated = {key_of(f) for f in index.by_fold if "-" in f or "\u2010" in f}
    candidates = (hyphenated | set(index.by_fold)) - _SEPARATE_WORDS

    def pairs(text: str) -> Iterator[tuple[int, int, dict[str, str]]]:
        for found in _PAIR.finditer(text):
            joined = (found[1] + found[2]).casefold()
            if joined in candidates and len(joined) >= 6:
                yield found.start(1), found.end(2), {}

    groups: dict[str, list[_Word]] = defaultdict(list)
    for fold, words in index.by_fold.items():
        if "-" in fold or "\u2010" in fold:
            groups[key_of(fold)].extend(words)
    for match in scan(index.scenes, pairs):
        groups[key_of(match.text)].append(_Word(match, False))
    for key, words in groups.items():  # the closed form joins its open and hyphenated forms
        words.extend(index.by_fold.get(key, ()))
    glossary = {
        key_of(value): value
        for entry in g.glossary_entries
        for value in (entry.term, *(entry.aliases or ()))
    }

    findings = []
    for key, words in groups.items():
        forms = Counter(" ".join(w.text.casefold().split()) for w in words)
        if len(forms) < 2 or f"variant:{key}" in kept or key in _SEPARATE_WORDS:
            continue
        target = _pick(forms, glossary.get(key, "").casefold() or None)
        share = forms[target] / sum(forms.values())
        others = [w for w in words if " ".join(w.text.casefold().split()) != target]
        listing = ", ".join(f"'{form}' {_times(n)}" for form, n in forms.most_common())
        reason = "the glossary spelling" if key in glossary else "the most used form"
        # Open beside hyphenated is often grammar, not inconsistency: "at half wages" but
        # "a half-wages job". A closed form (lanternkeeper) is a spelling choice.
        grammatical = key not in forms and key not in glossary
        uncertain = grammatical or share < 0.6
        note = (
            " A hyphen is usual when the term comes before a noun (a well-known man; he is "
            "well known), so both may be right."
            if grammatical
            else ""
        )
        findings.append(
            EvaluationFinding(
                code="variants.hyphenation",
                severity=Severity.INFO if uncertain else Severity.WARNING,
                message=(
                    f"One term, {len(forms)} spellings: {listing}. '{target}' is {reason}.{note}"
                ),
                passage=others[0].match.passage,
                actions=(
                    _replace(f"Use '{target}' everywhere", others, target),
                    _keep(f"variant:{key}"),
                ),
                uncertain=uncertain,
            )
        )
    findings.sort(key=lambda f: f.uncertain)
    return findings[:MAX_PER_SECTION]


_NEIGHBOUR_BEFORE = re.compile(r"([^\W\d_]+)[ \t]+$")
_NEIGHBOUR_AFTER = re.compile(r"^[ \t]+([^\W\d_]+)")


def _in_longer_name(word: _Word) -> bool:
    """Part of a multi-word name such as Elowen Harbour, where a capital is expected."""
    content, start, end = word.match.scene.content or "", word.match.start, word.match.end
    before = _NEIGHBOUR_BEFORE.search(content[max(0, start - 40) : start])
    after = _NEIGHBOUR_AFTER.search(content[end : end + 40])
    return any(m is not None and m[1][0].isupper() for m in (before, after))


def _proper_names(g: StoryGraph) -> dict[str, str]:
    """Words that are names in their own right: single-word names and aliases, and the
    first word of a character's name (Maya of Maya Torres). Other words of longer names are
    often ordinary words (the City and Suburban Bank), so a lower-case use is no error."""
    names: dict[str, str] = {}
    for source in name_sources(g):
        for value in (source.name, *source.aliases):
            words = [w for w in re.findall(r"[^\W\d_]+", value) if w.casefold() not in _TITLES]
            if len(words) == 1 or (words and source.entity_type == "character"):
                names.setdefault(words[0].casefold(), words[0])
    return names


_TITLES = frozenset(
    ["mr", "mrs", "ms", "miss", "dr", "sir", "lady", "lord", "captain", "doctor", "professor"]
)


def _capitalisation(g: StoryGraph, index: _Index, kept: set[str]) -> list[EvaluationFinding]:
    canon = _canon_tokens(name_sources(g))
    proper = _proper_names(g)
    findings = []
    for fold, words in index.by_fold.items():
        middle = [w for w in words if not w.sentence_start and not w.acronym]
        upper = [w for w in middle if w.capitalised and not _in_longer_name(w)]
        lower = [w for w in middle if not w.capitalised]
        key = f"case:{fold}"
        if (
            not upper
            or not lower
            or len(fold) < 3
            or fold in _FUNCTION_WORDS
            or "-" in fold
            or key in kept
        ):
            continue
        if fold in proper and len(lower) * 4 <= len(upper):  # a name, rarely lower-cased
            written = proper[fold]
            if not written[0].isupper():
                continue
            target, wrong, uncertain = written, lower, False
            message = (
                f"'{lower[0].text}' appears {_times(len(lower))} in lower case mid-sentence; "
                f"the name is written '{written}'."
            )
        else:
            # Name versus ordinary word (John Clay, a clay pipe) is expected; a lone capital
            # is more often a quirk than a convention.
            if fold in canon or len(middle) < 3 or len(upper) < 2:
                continue
            capital = len(upper) >= len(lower)
            target = upper[0].text if capital else lower[0].text
            wrong = lower if capital else upper
            uncertain = True
            message = (
                f"'{upper[0].text}' {_times(len(upper))} and '{lower[0].text}' "
                f"{_times(len(lower))} mid-sentence. Fine if one is a name or title (Mother, "
                "the Keep) and the other an ordinary word; otherwise pick one."
            )
        findings.append(
            EvaluationFinding(
                code="variants.capitalisation",
                severity=Severity.INFO if uncertain else Severity.WARNING,
                message=message,
                passage=wrong[0].match.passage,
                actions=(
                    FindingAction(
                        kind="replace",
                        label=f"Write '{target}' everywhere mid-sentence",
                        value=target,
                        edits=tuple(TextEdit(w.match.passage, target) for w in wrong),
                    ),
                    _keep(key),
                ),
                uncertain=uncertain,
            )
        )
    findings.sort(key=lambda f: f.uncertain)
    return findings[:MAX_PER_SECTION]


def check(g: StoryGraph) -> tuple[list[EvaluationFinding], dict[str, int]]:
    """All consistency findings, names first, and a count per section."""
    index = _Index(g)
    kept = set(g.story.consistency_exceptions or ())
    sections = {
        "names": _names(g, index, kept),
        "spelling": _spelling(g, index, kept),
        "hyphenation": _hyphenation(g, index, kept),
        "capitalisation": _capitalisation(g, index, kept),
    }
    findings = [f for section in sections.values() for f in section]
    counts = {name: len(items) for name, items in sections.items()}
    counts["kept"] = len(kept)
    return findings, counts
