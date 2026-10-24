"""Stories written in French, German, Spanish, Portuguese and Italian. Pure: no database."""

import asyncio
from uuid import UUID

import uuid_utils

from storytool.domain.cast.models import Character
from storytool.domain.enums import Language, base_language
from storytool.domain.evaluation import get_evaluator
from storytool.domain.graph import StoryGraph
from storytool.domain.language_words import plain
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.noticing.deterministic import DeterministicNoticer
from storytool.domain.rename import name_uses
from storytool.domain.spelling_variants import preferred_spellings
from storytool.domain.story.models import Story


def with_id(entity):
    entity.id = UUID(str(uuid_utils.uuid7()))
    return entity


def graph(*contents: str, language: str, **extra) -> StoryGraph:
    chapter = with_id(Chapter(story_id=None, title="One", sort_key=1))
    scenes = tuple(
        with_id(Scene(story_id=None, chapter_id=chapter.id, title=f"S{i}", sort_key=i, content=c))
        for i, c in enumerate(contents, start=1)
    )
    return StoryGraph(
        story=Story(title="S"), chapters=(chapter,), scenes=scenes, language=language, **extra
    )


def consistency(g: StoryGraph):
    return get_evaluator("consistency").run(g).findings


def unknown_names(prose: str, language: str) -> set[str]:
    notices = asyncio.run(DeterministicNoticer().notice_scene(prose, (), (), (), language))
    return {notice.name for notice in notices.unknown_names}


def test_languages_and_their_base() -> None:
    assert [lang.value for lang in Language] == [
        "en-US",
        "en-GB",
        "fr",
        "de",
        "es",
        "pt-PT",
        "pt-BR",
        "it",
    ]
    assert base_language("pt-BR") == "pt" and base_language("fr") == "fr"
    assert plain("Zoë José Ñandú Straße") == "Zoe Jose Nandu Straße"


def test_us_and_uk_spelling_is_only_checked_in_english() -> None:
    assert preferred_spellings("fr") == {} and preferred_spellings("pt-BR") == {}
    g = graph("Elle aimait la color et la colour du gray.", language="fr")
    assert not [f for f in consistency(g) if f.code.startswith("spelling.")]


def test_a_name_missing_its_accent_is_a_likely_typo() -> None:
    elise = with_id(Character(story_id=None, name="Élise"))
    g = graph(
        "\n\n".join(["Élise ouvrit la porte."] * 6) + "\n\nElise sourit.",
        language="fr",
        characters=(elise,),
    )
    [finding] = [f for f in consistency(g) if f.code.startswith("names.")]
    assert finding.code == "names.likely_typo"
    assert "differs only in accents" in finding.message
    assert [(e.passage.find, e.replacement) for e in finding.actions[0].edits] == [
        ("Elise", "Élise")
    ]


def test_german_nouns_are_not_taken_for_misspelt_names() -> None:
    hans = with_id(Character(story_id=None, name="Hans"))
    g = graph(
        "\n\n".join(["Hans sah das Haus. Das Haus war alt."] * 4) + "\n\nHanz lachte.",
        language="de",
        characters=(hans,),
    )
    names = [f for f in consistency(g) if f.code.startswith("names.")]
    assert [f.passage.find for f in names] == ["Hanz"], "Haus is a noun; Hanz sounds like Hans"
    assert not [f for f in consistency(g) if f.code == "variants.capitalisation"]


def test_french_and_spanish_quotes_start_a_sentence() -> None:
    french = graph(
        "Il cria : « Partez ! » Elle cria : « Partez vite ! » Nous partez lentement. "
        "On partez demain.",
        language="fr",
    )
    assert not [f for f in consistency(french) if f.code == "variants.capitalisation"]
    spanish = graph(
        "Ella dijo: ¿Vienes? Él dijo: ¿Vienes hoy? Tú vienes tarde. Yo vienes nunca.",
        language="es",
    )
    assert not [f for f in consistency(spanish) if f.code == "variants.capitalisation"]


def test_capitalisation_uses_the_language_small_words() -> None:
    g = graph(
        "Vio a la Reina. Luego la reina habló. Otra vez la Reina. Por fin la reina calló.",
        language="es",
    )
    [finding] = [f for f in consistency(g) if f.code == "variants.capitalisation"]
    assert finding.uncertain


def test_rename_keeps_the_german_genitive_only_in_german() -> None:
    text = "Annas Buch lag dort. Anna lachte. Annabel kam."
    german = [
        (u["passage"].find, u["replacement"])
        for u in name_uses(graph(text, language="de"), "Anna", "Kate")
    ]
    assert german == [("Anna", "Kate"), ("Anna", "Kate")]
    english = [u["passage"].find for u in name_uses(graph(text, language="en-US"), "Anna", "Kate")]
    assert english == ["Anna"]


def test_rename_finds_elided_and_capitalised_accented_names() -> None:
    g = graph("Le livre d'Élise. ÉLISE ! L'Élisabeth arriva.", language="fr")
    found = [(u["passage"].find, u["replacement"]) for u in name_uses(g, "Élise", "Inès")]
    assert found == [("Élise", "Inès"), ("ÉLISE", "INÈS")]


def test_noticing_reads_accented_capitals() -> None:
    assert "Zoë" in unknown_names("Later that day Zoë said nothing at all.", "en-US")
    assert "Élodie" in unknown_names("Plus tard, Élodie dit bonjour.", "fr")


def test_german_noticing_needs_a_person_verb_after_a_lone_noun() -> None:
    prose = "Der Hafen war leer. Das Boot lag still. Am Abend sagte Greta nichts. Greta lachte."
    assert unknown_names(prose, "de") == {"Greta"}


def test_noticing_trims_the_language_small_words() -> None:
    assert "Señor" not in unknown_names("Entonces el Señor Ruiz dijo que no.", "es")
