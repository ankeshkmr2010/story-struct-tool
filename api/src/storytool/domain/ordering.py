"""Fractional ordering for reorderable children.

`sort_key` is a float so moving an item is "take the midpoint of its new neighbours" -- one
row updated, no renumbering of everything after it. The design note in DESIGN.md says
reorder by midpoint; this is that, plus the part the note skipped: midpoints run out.

Repeatedly inserting at the same spot halves the gap each time, so after roughly fifty moves
into one position a float64 can no longer represent a value between the neighbours. When that
happens the siblings are renumbered to clean multiples and the move is retried. Rare, but it
is a silent data-corruption bug if left out -- two items would end up with equal keys and
their order would become arbitrary.

Pure functions, so all of this is testable without a database.
"""

from collections.abc import Sequence

# Gap between freshly numbered siblings. Large enough that ordinary insertion never needs a
# rebalance.
SORT_STEP = 100.0

# Below this, the neighbours are too close to subdivide reliably.
MIN_GAP = 1e-6


def midpoint(before: float | None, after: float | None) -> float:
    """A key that sorts between `before` and `after`.

    `None` means "no neighbour on that side": inserting at the start goes a step below the
    first item, at the end a step above the last, and into an empty list at zero.
    """
    if before is None and after is None:
        return 0.0
    if before is None:
        return after - SORT_STEP  # type: ignore[operator]
    if after is None:
        return before + SORT_STEP
    return (before + after) / 2.0


def needs_rebalance(before: float | None, after: float | None) -> bool:
    """True when there is no room left between the neighbours."""
    if before is None or after is None:
        return False
    return (after - before) < MIN_GAP


def rebalanced(count: int) -> list[float]:
    """Clean keys for `count` siblings, restoring room to insert between any of them."""
    return [index * SORT_STEP for index in range(1, count + 1)]


def place_between(keys: Sequence[float], index: int) -> tuple[float, list[float] | None]:
    """The key for an item inserted at `index` among `keys` (already sorted, item removed).

    Returns the new key and, when a rebalance was needed, the replacement keys for the
    existing siblings. The caller applies both in one transaction.
    """
    before = keys[index - 1] if index > 0 else None
    after = keys[index] if index < len(keys) else None

    if not needs_rebalance(before, after):
        return midpoint(before, after), None

    # Out of room: renumber the siblings, then take the midpoint of the new neighbours.
    fresh = rebalanced(len(keys))
    new_before = fresh[index - 1] if index > 0 else None
    new_after = fresh[index] if index < len(fresh) else None
    return midpoint(new_before, new_after), fresh


def chapter_order_key(chapter: object) -> tuple[float, int, str]:
    return (
        getattr(chapter, "sort_key", 0),
        getattr(chapter, "number", 0),
        str(getattr(chapter, "id", "")),
    )


def scene_order_key(scene: object) -> tuple[float, str]:
    return (getattr(scene, "sort_key", 0), str(getattr(scene, "id", "")))
