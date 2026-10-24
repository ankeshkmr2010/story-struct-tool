"""Small per-language word lists for the prose checks, keyed by base language ("pt", not "pt-BR").

Only what the checks need: common short words and honorifics that are capitalised at the start
of a sentence or before a name, so they are never mistaken for a misspelt name, and the months
and weekdays a language always capitalises. English keeps its own, longer lists in
`consistency` and `noticing.deterministic`.
"""

import unicodedata

from storytool.domain.enums import base_language

__all__ = ("calendar_words", "function_words", "plain", "titles")


def _words(text: str) -> frozenset[str]:
    return frozenset(word.casefold() for word in text.split())


_FUNCTION_WORDS = {
    "fr": _words(
        """
        le la les un une des du de et ou mais donc car ni au aux en dans sur sous par pour avec
        sans chez vers ce cet cette ces il elle ils elles on nous vous je tu me te se lui leur
        leurs son sa ses mon ma mes ton ta tes notre nos votre vos ne pas plus que qui quoi dont
        si est était sont être avait avoir comme quand puis alors tout toute tous toutes
        """
    ),
    "de": _words(
        """
        der die das den dem des ein eine einen einem einer eines und oder aber denn doch von zu
        zum zur in im an am auf aus bei mit nach seit vor für über unter um durch gegen ohne er
        sie es wir ihr ich du mich dich sich ihm ihn ihnen sein seine ihre unser euer mein dein
        nicht kein keine dass wenn als wie ist war sind waren hat hatte wird wurde auch noch nur
        so da dann dort hier
        """
    ),
    "es": _words(
        """
        el la lo los las un una unos unas y e o u pero sino ni de del a al en con por para sin
        sobre entre hasta desde hacia su sus mi mis tu tus nuestro nuestra este esta estos estas
        ese esa esos esas aquel aquella él ella ellos ellas nosotros vosotros yo tú me te se le
        les nos no que quien cuando como donde si es era son ser fue había ha muy más ya
        """
    ),
    "pt": _words(
        """
        o a os as um uma uns umas e ou mas nem de do da dos das em no na nos nas num numa com por
        pelo pela pelos pelas para sem sobre entre até desde ao aos à às seu sua seus suas meu
        minha teu tua nosso nossa este esta estes estas esse essa isso isto aquele aquela ele ela
        eles elas eu tu você vocês me te se lhe não que quem quando como onde se é era são ser
        foi tinha há muito mais já
        """
    ),
    "it": _words(
        """
        il lo la i gli le un uno una e ed o ma né di del dello della dei degli delle a al allo
        alla ai agli alle da dal dalla in nel nello nella nei con su sul sulla per tra fra senza
        suo sua suoi sue mio mia tuo tua nostro nostra questo questa quello quella lui lei loro
        io tu noi voi mi ti si gli ci vi non che chi quando come dove se è era sono essere fu
        aveva ha molto più già
        """
    ),
}

_TITLES = {
    "fr": _words(
        "monsieur madame mademoiselle messieurs mesdames m mme mlle docteur maître capitaine "
        "professeur père mère sœur frère"
    ),
    "de": _words(
        "herr frau fräulein doktor dr professor prof hauptmann kapitän graf gräfin vater mutter"
    ),
    "es": _words(
        "señor señora señorita sr sra srta don doña doctor doctora dr dra capitán profesor "
        "profesora padre madre"
    ),
    "pt": _words(
        "senhor senhora sr sra dom dona doutor doutora dr dra capitão professor professora "
        "padre madre"
    ),
    "it": _words(
        "signor signore signora signorina sig dottor dottore dottoressa dott capitano "
        "professore professoressa don donna padre madre"
    ),
}

# Languages that always capitalise months and weekdays. French, Spanish, Portuguese and
# Italian write them in lower case, so they need no entry.
_CALENDAR = {
    "de": _words(
        "januar februar märz april mai juni juli august september oktober november dezember "
        "montag dienstag mittwoch donnerstag freitag samstag sonntag sonnabend"
    ),
}


def function_words(language: str) -> frozenset[str]:
    return _FUNCTION_WORDS.get(base_language(language), frozenset())


def titles(language: str) -> frozenset[str]:
    return _TITLES.get(base_language(language), frozenset())


def calendar_words(language: str) -> frozenset[str]:
    return _CALENDAR.get(base_language(language), frozenset())


def plain(text: str) -> str:
    """Without accents: "Zoë" -> "Zoe", "José" -> "Jose". Other letters are kept."""
    decomposed = unicodedata.normalize("NFD", text)
    return unicodedata.normalize(
        "NFC", "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    )
