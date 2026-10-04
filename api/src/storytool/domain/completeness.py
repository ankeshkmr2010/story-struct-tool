"""The unifying mechanism: declarative completeness.

Each entity declares which fields make it *real*. From that single declaration we derive
three things, none of them stored:

  * completeness  -- per entity; a "placeholder" is just an incomplete entity.
  * readiness     -- per level; a pure function of complete entities above it.
  * health, tier 1 -- entity-level gaps fall straight out of completeness.

Nothing here touches the database, so it is all trivially unit-testable.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, ClassVar


@dataclass(frozen=True, slots=True)
class Completeness:
    """The computed completeness of a single entity."""

    is_complete: bool
    missing: tuple[str, ...]
    required: tuple[str, ...]

    @property
    def ratio(self) -> float:
        """How far along this entity is, 0.0-1.0. Entities with no requirements are done."""
        if not self.required:
            return 1.0
        return (len(self.required) - len(self.missing)) / len(self.required)


def is_blank(value: Any) -> bool:
    """A field counts as unfilled if it is None, whitespace, or an empty collection.

    Note 0 and False are *not* blank -- a beat at position 0 is a real answer.
    """
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict, frozenset)):
        return len(value) == 0
    return False


def evaluate(entity: object) -> Completeness:
    """Compute completeness from the entity class's ``complete_when`` declaration."""
    required: Sequence[str] = getattr(type(entity), "complete_when", ())
    missing = tuple(field for field in required if is_blank(getattr(entity, field, None)))
    return Completeness(is_complete=not missing, missing=missing, required=tuple(required))


class CompletableMixin:
    """Mix into a model to give it a derived ``completeness``.

    ``complete_when`` is a plain ClassVar, so SQLAlchemy never tries to map it.
    """

    complete_when: ClassVar[tuple[str, ...]] = ()

    @property
    def completeness(self) -> Completeness:
        return evaluate(self)

    @property
    def is_complete(self) -> bool:
        return self.completeness.is_complete
