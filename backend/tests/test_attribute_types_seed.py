import pytest
from sqlalchemy import select

from app.models import AttributeType

EXPECTED_KEYS = {
    "bottle_filler",
    "dual_height",
    "lower_spout",
    "wheelchair_reachable",
    "step_free_approach",
    "clear_approach_space",
    "push_button_usable",
}


@pytest.mark.asyncio
async def test_seeded_fountain_attribute_types(session):
    rows = (
        (await session.execute(select(AttributeType).where(AttributeType.place_type == "fountain")))
        .scalars()
        .all()
    )
    assert {r.key for r in rows} == EXPECTED_KEYS
    assert len(rows) == 7
    for r in rows:
        assert r.value_kind == "boolean"  # slice-1 rows are all boolean
        assert r.allowed_values is None
        assert r.category in ("physical", "accessibility")
        assert r.is_active is True


@pytest.mark.asyncio
async def test_attribute_types_endpoint_returns_seeded(client):
    r = await client.get("/api/v1/attribute-types")
    assert r.status_code == 200
    keys = {a["key"] for a in r.json()}
    assert keys == EXPECTED_KEYS
