"""Structure framework templates.

Defined in code, not tables -- they are constants. Selecting a framework seeds ordinary
Act and Beat rows, which *is* the pre-scaffolding rule made concrete.

Seeded rows are not special: renamable, reorderable, deletable. ``framework_position`` is
a loose string, never an FK into a template, so a framework can never become a cage.
"""

from dataclasses import dataclass

from storytool.domain.enums import StructureFramework


@dataclass(frozen=True, slots=True)
class ActTemplate:
    number: int
    title: str


@dataclass(frozen=True, slots=True)
class BeatTemplate:
    position: str
    """Stable identifier, e.g. "save_the_cat.midpoint"."""
    label: str
    description: str
    act_number: int


@dataclass(frozen=True, slots=True)
class Framework:
    key: StructureFramework
    name: str
    acts: tuple[ActTemplate, ...]
    beats: tuple[BeatTemplate, ...]


def _b(position: str, label: str, description: str, act: int) -> BeatTemplate:
    return BeatTemplate(position=position, label=label, description=description, act_number=act)


THREE_ACT = Framework(
    key=StructureFramework.THREE_ACT,
    name="Three Act",
    acts=(
        ActTemplate(1, "Setup"),
        ActTemplate(2, "Confrontation"),
        ActTemplate(3, "Resolution"),
    ),
    beats=(
        _b(
            "three_act.inciting_incident",
            "Inciting Incident",
            "The event that disturbs the status quo and starts the story.",
            1,
        ),
        _b(
            "three_act.plot_point_one",
            "Plot Point One",
            "The protagonist commits; there is no going back to ordinary life.",
            1,
        ),
        _b(
            "three_act.midpoint",
            "Midpoint",
            "A reversal that changes the protagonist from reactive to active.",
            2,
        ),
        _b(
            "three_act.all_is_lost",
            "All Is Lost",
            "The lowest point; the want looks unreachable.",
            2,
        ),
        _b(
            "three_act.plot_point_two",
            "Plot Point Two",
            "The protagonist chooses to act on what they have learned.",
            2,
        ),
        _b(
            "three_act.climax",
            "Climax",
            "The final confrontation that settles the dramatic question.",
            3,
        ),
        _b("three_act.resolution", "Resolution", "The new status quo, showing what changed.", 3),
    ),
)

SAVE_THE_CAT = Framework(
    key=StructureFramework.SAVE_THE_CAT,
    name="Save the Cat",
    acts=(
        ActTemplate(1, "Act One"),
        ActTemplate(2, "Act Two"),
        ActTemplate(3, "Act Three"),
    ),
    beats=(
        _b(
            "save_the_cat.opening_image",
            "Opening Image",
            "A snapshot of the world and tone before change.",
            1,
        ),
        _b(
            "save_the_cat.theme_stated",
            "Theme Stated",
            "Someone states what the story is really about.",
            1,
        ),
        _b("save_the_cat.setup", "Set-Up", "The ordinary world and what is missing from it.", 1),
        _b(
            "save_the_cat.catalyst",
            "Catalyst",
            "The call to adventure that breaks the status quo.",
            1,
        ),
        _b(
            "save_the_cat.debate",
            "Debate",
            "The protagonist resists; the cost of acting is weighed.",
            1,
        ),
        _b(
            "save_the_cat.break_into_two",
            "Break Into Two",
            "A deliberate choice to enter the new world.",
            2,
        ),
        _b(
            "save_the_cat.b_story",
            "B Story",
            "The secondary storyline, usually carrying the theme.",
            2,
        ),
        _b(
            "save_the_cat.fun_and_games",
            "Fun and Games",
            "The promise of the premise delivered.",
            2,
        ),
        _b(
            "save_the_cat.midpoint",
            "Midpoint",
            "A false victory or false defeat; the stakes become real.",
            2,
        ),
        _b(
            "save_the_cat.bad_guys_close_in",
            "Bad Guys Close In",
            "External pressure mounts as internal doubt grows.",
            2,
        ),
        _b(
            "save_the_cat.all_is_lost",
            "All Is Lost",
            "The worst happens, often with a whiff of death.",
            2,
        ),
        _b(
            "save_the_cat.dark_night_of_the_soul",
            "Dark Night of the Soul",
            "The protagonist sits in the loss before finding the answer.",
            2,
        ),
        _b(
            "save_the_cat.break_into_three",
            "Break Into Three",
            "Thesis and antithesis synthesise into a new plan.",
            3,
        ),
        _b(
            "save_the_cat.finale",
            "Finale",
            "The new plan executed; the lesson proven in action.",
            3,
        ),
        _b(
            "save_the_cat.final_image",
            "Final Image",
            "The mirror of the opening image, showing the change.",
            3,
        ),
    ),
)

CUSTOM = Framework(key=StructureFramework.CUSTOM, name="Custom", acts=(), beats=())

FRAMEWORKS: dict[StructureFramework, Framework] = {
    THREE_ACT.key: THREE_ACT,
    SAVE_THE_CAT.key: SAVE_THE_CAT,
    CUSTOM.key: CUSTOM,
}


def get_framework(key: str) -> Framework:
    """Unknown keys fall back to CUSTOM rather than raising -- an unrecognised framework
    should leave the author with an empty canvas, not an error page."""
    try:
        return FRAMEWORKS[StructureFramework(key)]
    except ValueError:
        return CUSTOM


def missing_beats(
    framework: Framework, existing_positions: frozenset[str]
) -> tuple[BeatTemplate, ...]:
    """Beats this framework defines that the story does not yet have.

    Switching framework mid-story is additive and non-destructive: seed what is absent,
    delete nothing. A story carrying beats from two frameworks is a valid state.
    """
    return tuple(b for b in framework.beats if b.position not in existing_positions)


def missing_acts(framework: Framework, existing_numbers: frozenset[int]) -> tuple[ActTemplate, ...]:
    return tuple(a for a in framework.acts if a.number not in existing_numbers)
