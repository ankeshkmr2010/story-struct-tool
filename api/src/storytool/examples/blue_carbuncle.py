"""Seed an owned, abridged study edition of The Blue Carbuncle.

Run from api/: uv run python scripts/blue_carbuncle.py
Creates one example for the configured legacy owner; never deletes or replaces stories.
Source: Arthur Conan Doyle, The Adventures of Sherlock Holmes (public domain),
https://www.gutenberg.org/cache/epub/1661/pg1661.html#chap07
Scenes are paraphrased study notes, with separate world time and disclosure order.
"""

import asyncio
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from storytool.config import get_settings
from storytool.domain.auth.models import User
from storytool.domain.story.models import Story
from storytool.examples.outline import Moment, StudyOutline, seed_outline

TITLE = "The Blue Carbuncle"


# This sequence is the study edition's READING order, deliberately not world-time order.
MOMENTS = (
    Moment(
        "Holmes examines the battered hat",
        70,
        "December 27 · morning",
        "221B Baker Street",
        ("Sherlock Holmes", "Dr. Watson"),
        1,
        "Watson visits after Christmas and finds Holmes studying a battered hat. "
        "A seemingly ordinary lost goose and hat become the opening puzzle.",
    ),
    Moment(
        "Henry Baker loses his goose in the street",
        50,
        "Christmas morning · early hours",
        "Tottenham Court Road",
        ("Henry Baker", "Peterson"),
        1,
        "Holmes recounts Peterson's earlier encounter: Baker was attacked in the street, "
        "broke a window defending himself, and fled when Peterson approached. "
        "Peterson recovered the abandoned hat and goose.",
        True,
    ),
    Moment(
        "The blue carbuncle is found in the goose",
        80,
        "December 27 · morning",
        "Peterson's home",
        ("Peterson", "Mrs. Peterson"),
        1,
        "Mrs. Peterson finds the stolen jewel while preparing the goose. Peterson brings "
        "the discovery to Holmes, transforming the lost-property puzzle into a criminal case.",
        turning=True,
    ),
    Moment(
        "John Horner is falsely accused",
        20,
        "December 22 · after the theft",
        "Hotel Cosmopolitan",
        ("John Horner", "James Ryder", "Catherine Cusack"),
        2,
        "A newspaper account takes the reader back to the robbery. Ryder and Cusack's "
        "evidence puts suspicion on Horner, the plumber who repaired the room's grate. "
        "His prior conviction makes the accusation plausible; the jewel is not found on him.",
        True,
    ),
    Moment(
        "Henry Baker proves ignorant of the jewel",
        90,
        "December 27 · evening",
        "221B Baker Street",
        ("Sherlock Holmes", "Dr. Watson", "Henry Baker"),
        2,
        "Baker answers the advertisement for his lost property. He happily accepts a "
        "replacement goose and shows no interest in the original bird's remains. "
        "Holmes concludes that Baker knows nothing of the jewel.",
    ),
    Moment(
        "The goose club leads to the Alpha Inn",
        100,
        "December 27 · evening",
        "Alpha Inn",
        ("Sherlock Holmes", "Dr. Watson", "Mr. Windigate"),
        3,
        "Holmes and Watson follow Baker's goose-club subscription to the Alpha Inn. "
        "Its landlord, Windigate, names Breckinridge in Covent Garden as his supplier.",
    ),
    Moment(
        "A wager reveals Breckinridge's supplier",
        110,
        "December 27 · later evening",
        "Covent Garden Market",
        ("Sherlock Holmes", "Dr. Watson", "Breckinridge"),
        3,
        "The dealer resists questions. Holmes wagers that the goose was country bred, "
        "provoking Breckinridge into producing his books. The records name Mrs. Oakshott "
        "of Brixton Road as the supplier.",
        turning=True,
    ),
    Moment(
        "The goose enters the ordinary supply chain",
        40,
        "December 22 · goose shipment",
        "Covent Garden Market",
        ("Mrs. Oakshott", "Breckinridge", "Mr. Windigate"),
        3,
        "The ledger reconstructs an earlier transaction: Oakshott's geese were supplied "
        "to Breckinridge and then sold to Windigate's club. A stolen jewel travelled "
        "through an otherwise innocent trade.",
        True,
    ),
    Moment(
        "Ryder's desperate search exposes him",
        120,
        "December 27 · outside the stall",
        "Covent Garden Market",
        ("Sherlock Holmes", "Dr. Watson", "James Ryder", "Breckinridge"),
        3,
        "Holmes overhears a frightened man asking the dealer about the geese. "
        "The man first offers an alias, then admits he is James Ryder, the hotel's "
        "head attendant. Holmes brings him to Baker Street.",
        turning=True,
    ),
    Moment(
        "Holmes confronts Ryder with the recovered stone",
        130,
        "December 27 · night",
        "221B Baker Street",
        ("Sherlock Holmes", "Dr. Watson", "James Ryder"),
        4,
        "Holmes produces the jewel. Ryder collapses, begs for mercy, and agrees to explain "
        "how the stone reached the goose. The investigation has reached its confrontation.",
        turning=True,
    ),
    Moment(
        "Ryder and Cusack steal the jewel",
        10,
        "December 22 · the theft",
        "Hotel Cosmopolitan",
        ("James Ryder", "Catherine Cusack"),
        4,
        "The late confession reconstructs the true beginning. Cusack told Ryder of the "
        "countess's jewel. They arranged a repair that would implicate Horner; Ryder "
        "stole the stone and raised the alarm after the plumber left.",
        True,
        True,
    ),
    Moment(
        "Ryder hides the stone inside a goose",
        30,
        "Before Christmas · after Horner's arrest",
        "117 Brixton Road",
        ("James Ryder", "Mrs. Oakshott"),
        4,
        "Fearing a search, Ryder visits his sister Maggie Oakshott's poultry yard. "
        "He forces the stone into a white goose's crop, planning to carry it to a criminal "
        "acquaintance in Kilburn. The bird escapes among the flock.",
        True,
    ),
    Moment(
        "Ryder takes the wrong goose to Kilburn",
        35,
        "Before Christmas · later",
        "Maudsley's home, Kilburn",
        ("James Ryder", "Maudsley"),
        4,
        "Ryder selects a similar barred-tailed goose and takes it to Maudsley. "
        "They cut it open but find no jewel. Two nearly identical birds have defeated "
        "his concealment scheme.",
        True,
    ),
    Moment(
        "Ryder returns to an empty poultry yard",
        45,
        "Before Christmas · after the sale",
        "117 Brixton Road",
        ("James Ryder", "Mrs. Oakshott"),
        4,
        "Ryder races back to his sister. The market birds have already gone to "
        "Breckinridge, and she confirms there were two barred-tailed geese. "
        "His frantic attempt to trace the correct bird follows.",
        True,
    ),
    Moment(
        "Holmes chooses mercy and lets Ryder go",
        140,
        "December 27 · after the confession",
        "221B Baker Street",
        ("Sherlock Holmes", "Dr. Watson", "James Ryder"),
        5,
        "Holmes sends the terrified Ryder away. Without Ryder's testimony the case "
        "against Horner must collapse. Holmes tells Watson that fear may have reformed "
        "the thief, while prison might make him a hardened criminal.",
        turning=True,
    ),
)


BLUE_CARBUNCLE = StudyOutline(
    title=TITLE,
    premise="A jewel found in a Christmas goose leads Holmes through an innocent supply "
    "chain to a thief whose confession reveals how the crime began.",
    genre="Detective short fiction · abridged study edition",
    pov_style="first",
    protagonist="Sherlock Holmes",
    pov_character="Dr. Watson",
    antagonists=("James Ryder", "Catherine Cusack"),
    chapter_titles=(
        "The hat and the goose",
        "An innocent owner",
        "Following the chain",
        "Ryder's confession",
        "The season of forgiveness",
    ),
    moments=MOMENTS,
    voice_notes="Paraphrased study notes based on Conan Doyle's public-domain story. "
    "World-time positions are relative, not elapsed minutes.",
    protagonist_want="Establish the truth and protect the innocent",
    protagonist_need="Apply judgment as well as deduction",
    extra_characters=("Countess of Morcar",),
)


async def seed_blue_carbuncle(session: AsyncSession, owner_id: UUID) -> Story:
    return await seed_outline(session, owner_id, BLUE_CARBUNCLE)


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    try:
        async with AsyncSession(engine) as session:
            owner = await session.scalar(
                select(User).where(User.email == settings.legacy_owner_email)
            )
            if owner is None:
                raise RuntimeError("The configured owner must sign in before seeding the example.")
            story = await seed_blue_carbuncle(session, owner.id)
            story_id = story.id
            await session.commit()
            print(f"Study edition ready: http://localhost:5173/stories/{story_id}")
            print(
                "Open Story timeline. World time starts with the theft; "
                "Reading order starts with the hat."
            )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
