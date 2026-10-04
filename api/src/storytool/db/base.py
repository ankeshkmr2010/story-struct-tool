"""Declarative base and the metadata Alembic autogenerates against.

``UUIDv7AuditBase`` from advanced-alchemy supplies a UUIDv7 primary key plus created_at /
updated_at. UUIDv7 is time-sortable (indexes well), non-enumerable in URLs, and generated
client-side -- which matters for forking, where deep-copying a graph must not collide on a
sequence.
"""

from advanced_alchemy.base import UUIDv7AuditBase, orm_registry

from storytool.domain.completeness import CompletableMixin

__all__ = ("CompletableMixin", "StoryToolBase", "metadata", "orm_registry")

StoryToolBase = UUIDv7AuditBase
metadata = UUIDv7AuditBase.metadata
