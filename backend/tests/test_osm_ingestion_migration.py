import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

_PT = "ST_GeogFromText('SRID=4326;POINT(0 0)')"


def _insert_fountain_sql(created_source: str, owner_sql: str) -> str:
    return (
        "INSERT INTO fountains "
        "(id, location, is_working, created_source, added_by_user_id) "
        f"VALUES (gen_random_uuid(), {_PT}, true, '{created_source}', {owner_sql})"
    )


@pytest.mark.asyncio
async def test_fountain_origin_columns_and_nullable_owner(session):
    cols = (
        await session.execute(
            text(
                "SELECT column_name, is_nullable FROM information_schema.columns "
                "WHERE table_name='fountains' AND column_name IN "
                "('created_source','is_hidden','added_by_user_id')"
            )
        )
    ).all()
    by = {c: n for (c, n) in cols}
    assert by["created_source"] == "NO"
    assert by["is_hidden"] == "NO"
    assert by["added_by_user_id"] == "YES"  # now nullable


@pytest.mark.asyncio
async def test_fountains_check_constraints_present_by_definition(session):
    # alembic check compares NEITHER CHECK names NOR definitions. Assert the names plus KEY
    # TOKENS of each definition here; the negative-insert tests below are the authoritative
    # behavioral guard against expression drift (this token check is a fast smoke, not a
    # full expression-equivalence proof).
    rows = (
        await session.execute(
            text(
                "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid='fountains'::regclass AND contype='c'"
            )
        )
    ).all()
    defs = {name: definition for (name, definition) in rows}
    cs = defs["ck_fountains_created_source"].lower()
    assert "created_source" in cs and "user" in cs and "osm" in cs and "admin_import" in cs
    owner = defs["ck_fountains_user_source_requires_user"].lower().replace(" ", "")
    assert "added_by_user_idisnotnull" in owner and "created_source" in owner


@pytest.mark.asyncio
async def test_fountain_and_provenance_indexes_present(session):
    fidx = set(
        (
            await session.execute(
                text("SELECT indexname FROM pg_indexes WHERE tablename='fountains'")
            )
        )
        .scalars()
        .all()
    )
    assert "ix_fountains_created_source" in fidx
    pidx = set(
        (
            await session.execute(
                text("SELECT indexname FROM pg_indexes WHERE tablename='fountain_provenances'")
            )
        )
        .scalars()
        .all()
    )
    assert "uq_fountain_provenances_source_external" in pidx


@pytest.mark.asyncio
async def test_user_source_requires_user_check_enforced(session):
    # A user-source fountain with no owner must violate the owner CHECK.
    with pytest.raises(IntegrityError):
        await session.execute(text(_insert_fountain_sql("user", "NULL")))
        await session.flush()


@pytest.mark.asyncio
async def test_invalid_created_source_rejected(session):
    # An out-of-domain created_source must violate ck_fountains_created_source.
    with pytest.raises(IntegrityError):
        await session.execute(text(_insert_fountain_sql("bogus", "NULL")))
        await session.flush()
