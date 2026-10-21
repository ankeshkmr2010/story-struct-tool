"""A save that replaces most of a scene must snapshot first. Pure: no database."""

from storytool.domain.narrative.prose import replaces_most_of

SCENE = " ".join(f"Sentence {i} of the scene, with enough words to matter." for i in range(12))


def test_typing_appending_and_local_edits_do_not_count() -> None:
    assert not replaces_most_of(SCENE, SCENE + " One more line.")
    assert not replaces_most_of(SCENE, SCENE.replace("Sentence 5", "Line five"))
    assert not replaces_most_of(SCENE, SCENE[: len(SCENE) // 2 + 40])


def test_replacing_or_clearing_most_of_a_scene_counts() -> None:
    assert replaces_most_of(SCENE, "An entirely different scene.")
    assert replaces_most_of(SCENE, "")
    assert replaces_most_of(SCENE, None)
    assert replaces_most_of(SCENE, SCENE[:30] + "new middle" + SCENE[-30:])


def test_short_or_unchanged_prose_never_counts() -> None:
    assert not replaces_most_of("A short draft.", "Something else entirely.")
    assert not replaces_most_of(None, "New prose")
    assert not replaces_most_of(SCENE, SCENE)
