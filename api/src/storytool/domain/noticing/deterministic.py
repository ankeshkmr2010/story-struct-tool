"""Deterministic noticing: string matching, no model, no API key, no cost.

This is the baseline the whole feature degrades to. It handles the common case well -- most
of the time a character "appearing" in a scene means their name is written in it -- and it
is fast enough to run on every save.

What it deliberately cannot do is recognise a character referred to only as "her sister" or
"the lighthouse keeper". That is where the Claude noticer earns its place.
"""

import re

from storytool.domain.noticing.types import (
    CharacterNotice,
    KnownBeat,
    KnownCharacter,
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
CAPITALISED = re.compile(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b")

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


def _trim_stopwords(run: str) -> str:
    """Strip leading and trailing non-name words from a capitalised run.

    "The Harbour" -> "Harbour"; "The Tide Then" -> "Tide"; "And But" -> "". Interior words
    are left alone so a genuine multi-word name survives intact.
    """
    words = run.split()
    while words and words[0] in NOT_NAMES:
        words.pop(0)
    while words and words[-1] in NOT_NAMES:
        words.pop()
    return " ".join(words)


def _sentence_around(prose: str, index: int) -> str:
    """A short verbatim window of the author's text around a match, for evidence."""
    start = max(0, index - EVIDENCE_WINDOW // 2)
    end = min(len(prose), index + EVIDENCE_WINDOW)
    return prose[start:end].strip()


class DeterministicNoticer:
    """Matches known names by word boundary; flags unmatched capitalised words."""

    name = "deterministic"

    async def notice_scene(
        self,
        prose: str,
        known_characters: tuple[KnownCharacter, ...],
        known_beats: tuple[KnownBeat, ...] = (),
    ) -> SceneNotices:
        if not prose.strip():
            return SceneNotices(noticed_by=self.name)

        characters: list[CharacterNotice] = []
        matched_words: set[str] = set()

        for character in known_characters:
            for alias in character.aliases:
                match = re.search(rf"\b{re.escape(alias)}\b", prose)
                if match:
                    characters.append(
                        CharacterNotice(
                            character_id=character.id,
                            evidence=_sentence_around(prose, match.start()),
                            confidence="high",
                        )
                    )
                    matched_words.update(alias.split())
                    break

        # Capitalised words that match no known character: worth asking about, never acting on.
        unknown: dict[str, UnknownNameNotice] = {}
        for match in CAPITALISED.finditer(prose):
            candidate = _trim_stopwords(match.group(0))
            if not candidate or candidate in matched_words or candidate in unknown:
                continue
            # A run whose every word is already a known character's is that character, not a
            # stranger -- e.g. "Maya Okonkwo" when both tokens matched above.
            if all(word in matched_words for word in candidate.split()):
                continue
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
