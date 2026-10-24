"""Deterministic noticing: string matching, no model, no API key, no cost.

This is the baseline the whole feature degrades to. It handles the common case well -- most
of the time a character "appearing" in a scene means their name is written in it -- and it
is fast enough to run on every save.

What it deliberately cannot do is recognise a character referred to only as "her sister" or
"the lighthouse keeper". That is where the Claude noticer earns its place.
"""

import re
from collections import Counter
from uuid import UUID

from storytool.domain.enums import DEFAULT_LANGUAGE, base_language
from storytool.domain.language_words import calendar_words, function_words, titles
from storytool.domain.noticing.types import (
    CharacterNotice,
    KnownBeat,
    KnownCharacter,
    KnownLocation,
    SceneNotices,
    UnknownNameNotice,
)

# Any capitalised word, including at the start of a sentence. Excluding that position looked
# tidier but silently missed real characters -- names open sentences constantly ("Kess was
# not there."). The trade is deliberate: this errs toward recall, because a false positive is
# a dismissible question while a false negative means never noticing a character at all.
# Noise is held down by the stoplist below and by requiring a name to recur across scenes
# before it becomes a suggestion.
#
# Matches a *run* of capitalised words, so "Harbourmaster Enns" is one candidate person
# rather than two. Matching words individually produced both noise (a title reported as a
# name) and inaccuracy (one person reported twice).
#
# Letters include the accented capitals of French, German, Spanish, Portuguese and Italian
# (Élise, Özil, Zoë), not only A-Z.
_UPPER = "A-Z\u00c0-\u00d6\u00d8-\u00de\u0152\u0178"
_LOWER = "a-z\u00df-\u00f6\u00f8-\u00ff\u0153"
CAPITALISED = re.compile(rf"\b[{_UPPER}][{_LOWER}]{{2,}}(?:\s+[{_UPPER}][{_LOWER}]{{2,}})*\b")

# Capitalised words that are not names. Needed now that sentence-initial words are in scope.
NOT_NAMES = frozenset(
    {
        "Above",
        "Across",
        "After",
        "All",
        "Already",
        "Also",
        "Although",
        "Always",
        "And",
        "Any",
        "Anyone",
        "Anything",
        "April",
        "Around",
        "August",
        "Away",
        "Back",
        "Because",
        "Before",
        "Behind",
        "Below",
        "Beyond",
        "Both",
        "But",
        "Captain",
        "December",
        "Doctor",
        "Down",
        "Each",
        "Eight",
        "Even",
        "Every",
        "Everyone",
        "Everything",
        "February",
        "Five",
        "For",
        "Four",
        "Friday",
        "God",
        "Her",
        "Here",
        "Hers",
        "Him",
        "His",
        "How",
        "Inside",
        "Instead",
        "Its",
        "January",
        "July",
        "June",
        "Just",
        "Lady",
        "Later",
        "Lord",
        "Many",
        "March",
        "May",
        "Maybe",
        "Mister",
        "Monday",
        "Most",
        "Mrs",
        "Much",
        "Never",
        "Nine",
        "None",
        "Nor",
        "Not",
        "Nothing",
        "November",
        "Now",
        "October",
        "Often",
        "Once",
        "One",
        "Only",
        "Our",
        "Ours",
        "Outside",
        "Over",
        "Perhaps",
        "Saturday",
        "September",
        "Seven",
        "She",
        "Since",
        "Six",
        "Some",
        "Someone",
        "Something",
        "Sometimes",
        "Soon",
        "Still",
        "Sunday",
        "Ten",
        "Than",
        "That",
        "The",
        "Their",
        "Theirs",
        "Them",
        "Then",
        "There",
        "These",
        "They",
        "This",
        "Those",
        "Though",
        "Three",
        "Through",
        "Thursday",
        "Tuesday",
        "Two",
        "Under",
        "Unless",
        "Until",
        "Wednesday",
        "What",
        "When",
        "Where",
        "While",
        "Who",
        "Whom",
        "Whose",
        "Why",
        "Yes",
        "Yet",
        "You",
        "Your",
        "Yours",
    }
)

EVIDENCE_WINDOW = 60

# These are sentence/dialogue starters or forms of address, not inferred identities.
# Explicitly defined characters still match normally, even if their name is in this set.
NOT_NAMES = NOT_NAMES | frozenset(
    {
        "Did",
        "Does",
        "Doing",
        "Was",
        "Were",
        "Could",
        "Would",
        "Should",
        "Can",
        "Good",
        "Put",
        "Next",
        "Nobody",
        "Without",
        "Feet",
        "Father",
        "Mother",
        "Brother",
        "Sister",
        "Grandfather",
        "Grandmother",
        "Thank",
        "Thanks",
        "Well",
        "Come",
        "Hold",
        "Keep",
        "Look",
        "Listen",
        "Welcome",
        "Please",
        "Let",
        "Leave",
    }
)
PERSON_ACTION = re.compile(
    r"\s+(?:was|is|were|said|asked|replied|whispered|shouted|waited|argued|stood|sat|"
    r"walked|watched|turned|nodded|smiled|laughed|ran|came|went|looked|thought|felt)\b",
    re.IGNORECASE,
)
# The same signal in the other writing languages: a name is usually followed by a verb of
# speech or action.
_PERSON_ACTION_VERBS = {
    "fr": "dit|demanda|répondit|murmura|chuchota|cria|était|est|avait|regarda|sourit|"
    "hocha|pensa|alla|vint|marcha|attendit|se",
    # German only: verbs that also follow ordinary nouns (Der Hafen war leer, Der Zug kam)
    # would turn every noun into a name, so only people's verbs are listed.
    "de": "sagte|fragte|antwortete|flüsterte|murmelte|rief|schrie|seufzte|lächelte|lachte|"
    "nickte|dachte",
    "es": "dijo|preguntó|respondió|contestó|susurró|gritó|era|es|"
    "estaba|tenía|miró|sonrió|asintió|pensó|fue|vino|caminó|"
    "esperó|se",
    "pt": "disse|perguntou|respondeu|sussurrou|gritou|era|é|estava|tinha|olhou|sorriu|"
    "acenou|pensou|foi|veio|andou|esperou|se",
    "it": "disse|chiese|rispose|sussurrò|gridò|era|è|aveva|guardò|"
    "sorrise|annuì|pensò|andò|venne|camminò|aspettò|si",
}
_PERSON_ACTION = {
    language: re.compile(rf"\s+(?:{verbs})\b", re.IGNORECASE)
    for language, verbs in _PERSON_ACTION_VERBS.items()
}
_NOT_NAMES_FOLDED = frozenset(word.casefold() for word in NOT_NAMES)
# German: a capitalised word right after one of these is a noun (das Haus, am Abend).
_GERMAN_DETERMINERS = frozenset(
    """
    der die das den dem des ein eine einen einem einer eines am im zum zur vom beim ins ans
    mein meine dein deine sein seine ihr ihre unser unsere kein keine dieser diese dieses
    jeder jede jedes
    """.split()  # noqa: SIM905 - a word list reads best as text
)
_GERMAN_PERSON_VERBS = frozenset(_PERSON_ACTION_VERBS["de"].split("|"))
_PREVIOUS_WORD = re.compile(r"([^\W\d_]+)\W*$")


def _stopwords(language: str) -> frozenset[str]:
    """Lower-case words that are not names, for this writing language."""
    if base_language(language) == "en":
        return _NOT_NAMES_FOLDED
    return function_words(language) | titles(language) | calendar_words(language)


def _trim_stopwords(run: str, stop: frozenset[str] = _NOT_NAMES_FOLDED) -> str:
    """Strip leading and trailing non-name words from a capitalised run.

    "The Harbour" -> "Harbour"; "The Tide Then" -> "Tide"; "And But" -> "". Interior words
    are left alone so a genuine multi-word name survives intact.
    """
    words = run.split()
    while words and words[0].casefold() in stop:
        words.pop(0)
    while words and words[-1].casefold() in stop:
        words.pop()
    return " ".join(words)


# Spaces, quotes and dashes that may sit between a sentence's end and its first word.
_OPENING_MARKS = (
    ' \t\r\n"\u201c\u201d\u2018\u2019\u00ab\u00bb\u2039\u203a\u201e\u201a\u2014\u2013\u00a0\u202f'
)


def _sentence_around(prose: str, index: int) -> str:
    """A short verbatim window of the author's text around a match, for evidence."""
    start = max(0, index - EVIDENCE_WINDOW // 2)
    end = min(len(prose), index + EVIDENCE_WINDOW)
    return prose[start:end].strip()


def unambiguous_aliases(
    known_characters: tuple[KnownCharacter, ...],
) -> dict[UUID, tuple[str, ...]]:
    """Drop short forms that more than one character answers to.

    "John Watson" and "John Clay" both yield the alias "John", so matching it put Watson in
    every scene Clay appeared in -- and mis-attributed presence feeds arcs, suggestions, and
    the continuity rule that proves a character cannot be in two places at once. A shared
    short form is worse than no short form.

    The full name is always kept, so every character keeps at least one way to be found.
    """
    counts: Counter[str] = Counter()
    for character in known_characters:
        for alias in character.aliases:
            counts[alias.casefold()] += 1

    resolved: dict[UUID, tuple[str, ...]] = {}
    for character in known_characters:
        unique = tuple(alias for alias in character.aliases if counts[alias.casefold()] == 1)
        resolved[character.id] = unique or (character.name,)
    return resolved


class DeterministicNoticer:
    """Matches known names by word boundary; flags unmatched capitalised words."""

    name = "deterministic"

    async def notice_scene(
        self,
        prose: str,
        known_characters: tuple[KnownCharacter, ...],
        known_beats: tuple[KnownBeat, ...] = (),
        known_locations: tuple[KnownLocation, ...] = (),
        language: str = DEFAULT_LANGUAGE,
    ) -> SceneNotices:
        if not prose.strip():
            return SceneNotices(noticed_by=self.name)

        characters: list[CharacterNotice] = []
        matched_words: set[str] = set()
        aliases = unambiguous_aliases(known_characters)
        known_words = {word.casefold() for c in known_characters for word in c.name_tokens}
        place_names = tuple(
            re.sub(r"\s*\([^)]*\)", "", place.name).strip().casefold() for place in known_locations
        )

        for character in known_characters:
            for alias in aliases[character.id]:
                match = re.search(rf"\b{re.escape(alias)}\b", prose)
                if match:
                    characters.append(
                        CharacterNotice(
                            character_id=character.id,
                            evidence=_sentence_around(prose, match.start()),
                            confidence="high",
                        )
                    )
                    # Every token of the full name, not just the matched alias: a
                    # scene naming "Holmes" must not then report "Sherlock" as unknown.
                    matched_words.update(character.name_tokens)
                    break

        # Capitalised words that match no known character: worth asking about, never acting on.
        unknown: dict[str, UnknownNameNotice] = {}
        stop = _stopwords(language)
        person_action = _PERSON_ACTION.get(base_language(language), PERSON_ACTION)
        # German capitalises every noun, so a lone capitalised word is only a name beside a
        # person's verb (Greta lachte; sagte Greta) and never right after an article.
        nouns_capitalised = base_language(language) == "de"
        for match in CAPITALISED.finditer(prose):
            candidate = _trim_stopwords(match.group(0), stop)
            if not candidate or candidate in matched_words or candidate in unknown:
                continue
            # A run whose every word is already a known character's is that character, not a
            # stranger -- e.g. "Maya Okonkwo" when both tokens matched above.
            if all(word in matched_words for word in candidate.split()):
                continue
            folded = candidate.casefold()
            # Existing places and their displayed English names are not new people.
            if any(
                folded == place.removeprefix("the ")
                or place.removeprefix("the ").startswith(folded + " ")
                for place in place_names
            ):
                continue
            # Family plurals (the Mengs) and known aliases are not extra cast members.
            if all(
                word.casefold() in known_words or word.casefold().removesuffix("s") in known_words
                for word in candidate.split()
            ):
                continue
            # Do not extract "Don" from "Don't" or "Forty" from "Forty-one".
            tail = prose[match.end() :]
            if re.match(r"(?:['\u2019](?:t|re|ve|ll|d|m)\b|-[a-z])", tail):
                continue
            if len(candidate.split()) == 1:
                if re.search(rf"\b{re.escape(folded)}\b", prose):
                    continue  # The same word is used as an ordinary lowercase word.
                if nouns_capitalised:
                    window = prose[max(0, match.start() - 40) : match.start()]
                    before = _PREVIOUS_WORD.search(window)
                    previous = before[1].casefold() if before else ""
                    first = match.group(0).split()[0].casefold()
                    if previous in _GERMAN_DETERMINERS or first in _GERMAN_DETERMINERS:
                        continue
                    if not person_action.match(tail) and previous not in _GERMAN_PERSON_VERBS:
                        continue
                prefix = prose[: match.start()].rstrip(_OPENING_MARKS)
                starts_sentence = not prefix or prefix[-1] in ".!?\u2026\u00bf\u00a1"
                if starts_sentence and not person_action.match(tail):
                    continue  # Capitalization alone is insufficient at sentence starts.
            unknown[candidate] = UnknownNameNotice(
                name=candidate, evidence=_sentence_around(prose, match.start())
            )

        return SceneNotices(
            characters=tuple(characters),
            unknown_names=tuple(unknown.values()),
            # Judging whether a scene "reads like a turning point" is not something string
            # matching can do honestly, so it reports nothing rather than guessing.
            structure=None,
            noticed_by=self.name,
        )
