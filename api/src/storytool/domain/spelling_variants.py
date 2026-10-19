"""American and British spelling pairs for the consistency check.

Curated by hand rather than generated from rules: a rule such as -or/-our would also pair
words that are spelled the same in both (humorous) or are different words. Pairs whose
meaning depends on context (tire/tyre, check/cheque, practice/practise, program/programme,
story/storey) are left out on purpose: flagging them would be wrong as often as right.

British English accepts -ize (Oxford spelling) and a few American forms such as judgment, so
those are only flagged in American
stories that use -ise, never the reverse. Only the forms below are ever matched.
"""

from storytool.domain.enums import Language

__all__ = ("preferred_spellings",)

# (American stem, British stem, suffixes shared by both)
_FAMILIES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    # -or / -our
    *(
        (us, us[:-2] + "our", ("", "s", "ed", "ing", "ful", "less", "able", "ably", "ite", "ites"))
        for us in (
            "color",
            "flavor",
            "honor",
            "humor",
            "labor",
            "neighbor",
            "favor",
            "behavior",
            "harbor",
            "odor",
            "rumor",
            "vapor",
            "vigor",
            "valor",
            "armor",
            "splendor",
            "parlor",
            "savior",
            "endeavor",
            "clamor",
            "rancor",
            "candor",
            "ardor",
            "fervor",
        )
    ),
    ("neighbor", "neighbour", ("hood", "hoods", "ly", "ing")),
    ("labor", "labour", ("er", "ers")),
    ("favor", "favour", ("itism",)),
    ("color", "colour", ("ation", "ist", "ists")),
    # -er / -re
    *(
        (us, us[:-2] + "re", ("", "s"))
        for us in (
            "center",
            "theater",
            "fiber",
            "liter",
            "caliber",
            "somber",
            "specter",
            "saber",
            "luster",
            "meager",
            "sepulcher",
            "scepter",
            "miter",
            "ocher",
        )
    ),
    # -ize / -ise (British accepts both; see module docstring)
    *(
        (us + "z", us + "s", ("e", "es", "ed", "ing", "ation", "ations", "er", "ers"))
        for us in (
            "reali",
            "organi",
            "recogni",
            "apologi",
            "critici",
            "emphasi",
            "memori",
            "priori",
            "summari",
            "symboli",
            "sympathi",
            "characteri",
            "speciali",
            "minimi",
            "maximi",
            "utili",
            "finali",
            "authori",
            "civili",
            "legali",
            "mobili",
            "normali",
            "agoni",
            "fantasi",
            "patroni",
            "scrutini",
            "theori",
            "visuali",
            "categori",
        )
    ),
    # -yze / -yse (British is always -yse)
    *((us + "z", us + "s", ("e", "es", "ed", "ing")) for us in ("analy", "paraly", "cataly")),
    # single / double L before a suffix
    *(
        (us, us + "l", ("ed", "ing", "er", "ers"))
        for us in (
            "travel",
            "cancel",
            "model",
            "label",
            "level",
            "fuel",
            "signal",
            "counsel",
            "jewel",
            "quarrel",
            "dial",
            "total",
            "tunnel",
            "duel",
            "equal",
            "rival",
            "shovel",
            "snorkel",
            "marshal",
            "pummel",
            "grovel",
            "revel",
            "unravel",
            "swivel",
        )
    ),
)

_PAIRS: tuple[tuple[str, str], ...] = (
    ("centered", "centred"),
    ("centering", "centring"),
    ("gray", "grey"),
    ("grays", "greys"),
    ("grayed", "greyed"),
    ("graying", "greying"),
    ("grayish", "greyish"),
    ("defense", "defence"),
    ("defenseless", "defenceless"),
    ("offense", "offence"),
    ("offenses", "offences"),
    ("mold", "mould"),
    ("molds", "moulds"),
    ("moldy", "mouldy"),
    ("plow", "plough"),
    ("plows", "ploughs"),
    ("plowed", "ploughed"),
    ("pajamas", "pyjamas"),
    ("skeptic", "sceptic"),
    ("skeptics", "sceptics"),
    ("skeptical", "sceptical"),
    ("skepticism", "scepticism"),
    ("jewelry", "jewellery"),
    ("aluminum", "aluminium"),
    ("mustache", "moustache"),
    ("mustaches", "moustaches"),
    ("catalog", "catalogue"),
    ("catalogs", "catalogues"),
    ("analog", "analogue"),
    ("cozy", "cosy"),
    ("coziest", "cosiest"),
    ("coziness", "cosiness"),
    ("donut", "doughnut"),
    ("donuts", "doughnuts"),
    ("maneuver", "manoeuvre"),
    ("maneuvers", "manoeuvres"),
    ("maneuvered", "manoeuvred"),
    ("encyclopedia", "encyclopaedia"),
    ("fetus", "foetus"),
    ("airplane", "aeroplane"),
    ("airplanes", "aeroplanes"),
    ("artifact", "artefact"),
    ("artifacts", "artefacts"),
    ("sulfur", "sulphur"),
    ("judgment", "judgement"),
    ("judgments", "judgements"),
    ("acknowledgment", "acknowledgement"),
    ("aging", "ageing"),
    ("yogurt", "yoghurt"),
    ("enroll", "enrol"),
    ("fulfill", "fulfil"),
    ("instill", "instil"),
    ("skillful", "skilful"),
    ("skillfully", "skilfully"),
    ("willful", "wilful"),
    ("willfully", "wilfully"),
    ("appall", "appal"),
    ("marvelous", "marvellous"),
    ("marvelously", "marvellously"),
    ("woolen", "woollen"),
    ("traveler", "traveller"),
    ("travelers", "travellers"),
    ("jeweler", "jeweller"),
    ("jewelers", "jewellers"),
    ("counselor", "counsellor"),
    ("counselors", "counsellors"),
    ("anesthetic", "anaesthetic"),
    ("archeology", "archaeology"),
    ("archeologist", "archaeologist"),
    ("ax", "axe"),
    ("behoove", "behove"),
    ("whiskey", "whisky"),
)

_IZE_STEMS = {us for us, _, _ in _FAMILIES if us.endswith("iz")}
# British usage accepts the American form of these too (judgment is standard in law).
_BRITISH_ACCEPTS = {"judgment", "judgments", "acknowledgment", "aging"}


def _all_pairs() -> list[tuple[str, str, bool]]:
    """(american, british, british_accepts_american)"""
    out: dict[tuple[str, str], bool] = {}
    for us_stem, gb_stem, suffixes in _FAMILIES:
        if us_stem == gb_stem:
            continue
        for suffix in suffixes:
            out[(us_stem + suffix, gb_stem + suffix)] = us_stem in _IZE_STEMS
    for us, gb in _PAIRS:
        if us != gb:
            out[(us, gb)] = us in _BRITISH_ACCEPTS
    return [(us, gb, accepts) for (us, gb), accepts in out.items()]


_PAIRS_ALL = _all_pairs()


def preferred_spellings(language: str) -> dict[str, str]:
    """Lower-case spelling that is wrong for `language` -> the spelling it prefers."""
    if language == Language.EN_GB:
        return {us: gb for us, gb, accepts in _PAIRS_ALL if not accepts}
    return {gb: us for us, gb, _ in _PAIRS_ALL}
