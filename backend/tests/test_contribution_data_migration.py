"""Verifies migration 0005 schema directly (alembic check ignores CHECK names/defs,
so constraints are asserted against pg_constraint/pg_indexes + negative inserts)."""

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_rating_types_place_type_backfilled(session):
    col = (
        await session.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name='rating_types' AND column_name='place_type'"
            )
        )
    ).scalar_one()
    assert col == "NO"
    # The 4 seeded dimensions backfilled to 'fountain' via server_default.
    bad = (
        await session.execute(
            text("SELECT count(*) FROM rating_types WHERE place_type <> 'fountain'")
        )
    ).scalar_one()
    assert bad == 0
    total = (await session.execute(text("SELECT count(*) FROM rating_types"))).scalar_one()
    assert total >= 4


@pytest.mark.asyncio
async def test_attribute_observations_user_id_not_null(session):
    nn = (
        await session.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name='attribute_observations' AND column_name='user_id'"
            )
        )
    ).scalar_one()
    assert nn == "NO"


@pytest.mark.asyncio
async def test_consensus_composite_primary_key(session):
    cols = set(
        (
            await session.execute(
                text(
                    "SELECT a.attname FROM pg_index i "
                    "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey) "
                    "WHERE i.indrelid='fountain_attribute_consensus'::regclass AND i.indisprimary"
                )
            )
        )
        .scalars()
        .all()
    )
    assert cols == {"fountain_id", "attribute_type_id"}


@pytest.mark.asyncio
async def test_expected_indexes_present(session):
    idx = set(
        (
            await session.execute(
                text(
                    "SELECT indexname FROM pg_indexes WHERE tablename IN "
                    "('attribute_types','attribute_observations','fountain_attribute_consensus',"
                    "'contribution_events','rating_types')"
                )
            )
        )
        .scalars()
        .all()
    )
    for name in (
        "ix_rating_types_place_type",
        "uq_attribute_types_place_type",
        "ix_attribute_types_place_type",
        "uq_attribute_observations_fountain_id",
        "ix_attribute_observations_fountain_id_attr",
        "ix_fountain_attribute_consensus_attr_value",
        "uq_contribution_events_dedup_key",
        "ix_contribution_events_user_id",
        "ix_contribution_events_event_type",
        "ix_contribution_events_target",
    ):
        assert name in idx, f"missing index {name}"


@pytest.mark.asyncio
async def test_check_constraint_names_present(session):
    names = set(
        (
            await session.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid IN "
                    "('attribute_types'::regclass, 'contribution_events'::regclass)"
                )
            )
        )
        .scalars()
        .all()
    )
    assert "ck_attribute_types_value_kind" in names
    assert "ck_attribute_types_category" in names
    assert "ck_contribution_events_status" in names


@pytest.mark.asyncio
async def test_attribute_types_value_kind_check_enforced(session):
    with pytest.raises(Exception):
        await session.execute(
            text(
                "INSERT INTO attribute_types "
                "(id, key, place_type, category, name, description, value_kind, sort_order) "
                "VALUES (9001, 'k', 'fountain', 'physical', 'n', 'd', 'bogus', 1)"
            )
        )
        await session.flush()


@pytest.mark.asyncio
async def test_attribute_types_category_check_enforced(session):
    with pytest.raises(Exception):
        await session.execute(
            text(
                "INSERT INTO attribute_types "
                "(id, key, place_type, category, name, description, value_kind, sort_order) "
                "VALUES (9002, 'k2', 'fountain', 'bogus', 'n', 'd', 'boolean', 1)"
            )
        )
        await session.flush()


@pytest.mark.asyncio
async def test_contribution_events_status_check_enforced(session, test_user):
    with pytest.raises(Exception):
        await session.execute(
            text(
                "INSERT INTO contribution_events "
                "(id, user_id, event_type, points, status, dedup_key) "
                "VALUES (gen_random_uuid(), :uid, 'add_fountain', 10, 'bogus', 'dk-bad')"
            ),
            {"uid": test_user.id},
        )
        await session.flush()
