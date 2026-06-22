"""seed attribute types: physical + accessibility (boolean)

Revision ID: 0006_seed_attribute_types
Revises: 0005_contribution_data
Create Date: 2026-06-22

Slice 1 seeds only the #38 physical + accessibility (all boolean) attributes. The
access-category enum attributes (access_kind, indoor_outdoor, venue_type, ...) are
deferred to Slice 4 (#42).
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_seed_attribute_types"
down_revision = "0005_contribution_data"
branch_labels = None
depends_on = None

# (id, key, category, name, description)  — all value_kind='boolean', place_type='fountain'.
_ATTRIBUTE_TYPES = (
    (1, "bottle_filler", "physical", "Bottle filler", "Has a bottle-filling spout"),
    (2, "dual_height", "physical", "Dual-height", "Adult and child-height spouts"),
    (3, "lower_spout", "physical", "Lower spout", "Has a lower / accessible spout"),
    (
        4,
        "wheelchair_reachable",
        "accessibility",
        "Wheelchair reachable",
        "Reachable from a wheelchair",
    ),
    (
        5,
        "step_free_approach",
        "accessibility",
        "Step-free approach",
        "No stairs required to reach it",
    ),
    (
        6,
        "clear_approach_space",
        "accessibility",
        "Clear approach space",
        "Open space to approach it",
    ),
    (
        7,
        "push_button_usable",
        "accessibility",
        "Push-button usable",
        "The push-button / lever is usable",
    ),
)


def upgrade() -> None:
    attribute_types = sa.table(
        "attribute_types",
        sa.column("id", sa.SmallInteger),
        sa.column("key", sa.String),
        sa.column("place_type", sa.String),
        sa.column("category", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("value_kind", sa.String),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        attribute_types,
        [
            {
                "id": i,
                "key": key,
                "place_type": "fountain",
                "category": category,
                "name": name,
                "description": description,
                "value_kind": "boolean",
                "sort_order": i,
            }
            for (i, key, category, name, description) in _ATTRIBUTE_TYPES
        ],
    )


def downgrade() -> None:
    # DESTRUCTIVE (schema rollback only, not a data-preserving path): the seeded
    # attribute_types are referenced by attribute_observations / fountain_attribute_consensus
    # via FKs WITHOUT ON DELETE CASCADE (deliberate — prod is protected from accidental
    # type deletion). Remove dependents first so the seed-row delete doesn't FK-fail once
    # any observation exists.
    op.execute(
        "DELETE FROM fountain_attribute_consensus WHERE attribute_type_id IN (1,2,3,4,5,6,7)"
    )
    op.execute("DELETE FROM attribute_observations WHERE attribute_type_id IN (1,2,3,4,5,6,7)")
    op.execute("DELETE FROM attribute_types WHERE id IN (1,2,3,4,5,6,7)")
