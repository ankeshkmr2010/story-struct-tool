"""Places. Outside the structural ladder -- reference data, not scaffolding.

The original brief nested these under a `World` holding rules, locations and lore. `World`
is omitted for now: it would be a container with one occupant and no behaviour. Locations
belong to the story directly, and a `World` can be introduced later without moving them.
"""

from uuid import UUID

from sqlalchemy import Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import CompletableMixin, StoryToolBase
from storytool.db.encryption import EncryptedText


class Location(StoryToolBase, CompletableMixin):
    """A place scenes happen in.

    A name is all it takes to exist -- description and atmosphere are the parts an author
    fills in once they know what the place is for.
    """

    __tablename__ = "location"

    complete_when = ("name", "description")

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(EncryptedText)
    description: Mapped[str | None] = mapped_column(EncryptedText, default=None)
    atmosphere_notes: Mapped[str | None] = mapped_column(EncryptedText, default=None)
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)
    # Names are distinct per story (continuity checking compares them). Names are encrypted at
    # rest, so the API checks this (world/controller.refuse_duplicate_name), not a constraint.
