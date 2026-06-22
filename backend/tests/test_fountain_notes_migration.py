import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_columns_and_defaults(session):
    cols = dict(
        (
            await session.execute(
                text(
                    "SELECT column_name, is_nullable FROM information_schema.columns "
                    "WHERE table_name='fountain_notes'"
                )
            )
        ).all()
    )
    for c in ("id", "fountain_id", "user_id", "body", "is_hidden", "created_at", "updated_at"):
        assert c in cols
    assert cols["created_at"] == "NO" and cols["updated_at"] == "NO"
    assert cols["hidden_by_user_id"] == "YES"


@pytest.mark.asyncio
async def test_unique_and_partial_index(session):
    idx = dict(
        (
            await session.execute(
                text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='fountain_notes'")
            )
        ).all()
    )
    assert "uq_fountain_notes_fountain_id" in idx
    assert "ix_fountain_notes_fountain_visible" in idx
    # Partial-index predicate must be present (spec §6.5), not just the name.
    assert "is_hidden" in idx["ix_fountain_notes_fountain_visible"].lower()


@pytest.mark.asyncio
async def test_fk_names_present(session):
    fks = set(
        (
            await session.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE contype='f' "
                    "AND conrelid='fountain_notes'::regclass"
                )
            )
        )
        .scalars()
        .all()
    )
    assert {
        "fk_fountain_notes_fountain",
        "fk_fountain_notes_user",
        "fk_fountain_notes_hidden_by",
    } <= fks
