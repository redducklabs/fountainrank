"""access context: seed access-category attribute types + fountains.placement_note

Revision ID: 0009_access_context
Revises: 0008_fountain_notes
Create Date: 2026-06-22
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0009_access_context"
down_revision = "0008_fountain_notes"
branch_labels = None
depends_on = None

# (id, key, value_kind, allowed_values, name, description) — all place_type='fountain',
# category='access'.
_ACCESS_TYPES = (
    (
        8,
        "access_kind",
        "enum",
        ["public", "customer_only", "restricted"],
        "Access",
        "Who may use it",
    ),
    (9, "indoor_outdoor", "enum", ["indoor", "outdoor"], "Indoor / outdoor", "Indoors or outdoors"),
    (
        10,
        "venue_type",
        "enum",
        [
            "park",
            "school",
            "transit",
            "trail",
            "building",
            "playground",
            "restroom_area",
            "store",
            "other",
        ],
        "Venue type",
        "The kind of place it is in",
    ),
    (
        11,
        "hours_dependent",
        "boolean",
        None,
        "Hours-dependent",
        "Only reachable during certain hours",
    ),
    (12, "requires_entry", "boolean", None, "Requires entry", "You must enter a venue to reach it"),
    (13, "seasonal", "boolean", None, "Seasonal", "Only available some seasons"),
)


def upgrade() -> None:
    op.add_column("fountains", sa.Column("placement_note", sa.String(), nullable=True))

    attribute_types = sa.table(
        "attribute_types",
        sa.column("id", sa.SmallInteger),
        sa.column("key", sa.String),
        sa.column("place_type", sa.String),
        sa.column("category", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("value_kind", sa.String),
        sa.column("allowed_values", JSONB),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        attribute_types,
        [
            {
                "id": i,
                "key": key,
                "place_type": "fountain",
                "category": "access",
                "name": name,
                "description": description,
                "value_kind": value_kind,
                "allowed_values": allowed_values,
                "sort_order": i,
            }
            for (i, key, value_kind, allowed_values, name, description) in _ACCESS_TYPES
        ],
    )


def downgrade() -> None:
    # Destructive (schema rollback only): remove dependent rows before the seed rows
    # (FKs to attribute_types lack ON DELETE CASCADE). Exact ids — never by category.
    ids = "(8,9,10,11,12,13)"
    op.execute(f"DELETE FROM fountain_attribute_consensus WHERE attribute_type_id IN {ids}")
    op.execute(f"DELETE FROM attribute_observations WHERE attribute_type_id IN {ids}")
    op.execute(f"DELETE FROM attribute_types WHERE id IN {ids}")
    op.drop_column("fountains", "placement_note")
