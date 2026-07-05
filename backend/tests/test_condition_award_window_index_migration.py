import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_condition_award_window_index_exists(session):
    row = (
        await session.execute(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE indexname = 'ix_contribution_events_condition_window'"
            )
        )
    ).scalar_one_or_none()
    assert row is not None, "index missing — did migration 0020 run?"
    lowered = row.lower()
    assert "user_id" in lowered and "fountain_id" in lowered and "created_at" in lowered
    # Postgres normalizes partial-index predicates (adds explicit ::text casts,
    # rewrites IN (...) as = ANY (ARRAY[...])), so match on substrings rather
    # than the literal SQL text we wrote in the migration/model.
    assert "status" in lowered and "= 'awarded'" in lowered
    assert "verify_working" in lowered and "report_condition" in lowered
