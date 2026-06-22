import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

_INSERT_FOUNTAIN = (
    "INSERT INTO fountains (id, location, is_working, created_source, added_by_user_id) "
    "VALUES (gen_random_uuid(), ST_GeogFromText('SRID=4326;POINT(0 0)'), true, 'osm', NULL) "
    "RETURNING id"
)


@pytest.mark.asyncio
async def test_fountain_status_columns_present(session):
    cols = set(
        (
            await session.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name='fountains' "
                    "AND column_name IN ('current_status','last_verified_at')"
                )
            )
        )
        .scalars()
        .all()
    )
    assert cols == {"current_status", "last_verified_at"}


@pytest.mark.asyncio
async def test_checks_and_index_present(session):
    cond_checks = set(
        (
            await session.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE contype='c' "
                    "AND conrelid='condition_reports'::regclass"
                )
            )
        )
        .scalars()
        .all()
    )
    assert "ck_condition_reports_status" in cond_checks
    f_checks = set(
        (
            await session.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE contype='c' "
                    "AND conrelid='fountains'::regclass"
                )
            )
        )
        .scalars()
        .all()
    )
    assert "ck_fountains_current_status" in f_checks
    idx = set(
        (
            await session.execute(
                text("SELECT indexname FROM pg_indexes WHERE tablename='condition_reports'")
            )
        )
        .scalars()
        .all()
    )
    assert "ix_condition_reports_fountain_created" in idx


@pytest.mark.asyncio
async def test_current_status_check_enforced(session):
    fid = (await session.execute(text(_INSERT_FOUNTAIN))).scalar_one()
    with pytest.raises(IntegrityError):
        await session.execute(
            text("UPDATE fountains SET current_status='bogus' WHERE id=:i"), {"i": fid}
        )
        await session.flush()


@pytest.mark.asyncio
async def test_condition_status_check_enforced(session, test_user):
    fid = (await session.execute(text(_INSERT_FOUNTAIN))).scalar_one()
    with pytest.raises(IntegrityError):
        await session.execute(
            text(
                "INSERT INTO condition_reports (id, fountain_id, user_id, status) "
                "VALUES (gen_random_uuid(), :f, :u, 'exploded')"
            ),
            {"f": fid, "u": test_user.id},
        )
        await session.flush()
