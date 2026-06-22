import pytest
from sqlalchemy import select

from app.models import AttributeType

# The original Slice-1 physical/accessibility booleans (Slice 4 added access-category rows).
SLICE1_KEYS = {
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
    keys = {r.key for r in rows}
    assert SLICE1_KEYS <= keys  # the original 7 are still present
    by_key = {r.key: r for r in rows}
    for k in SLICE1_KEYS:
        r = by_key[k]
        assert r.value_kind == "boolean" and r.allowed_values is None
        assert r.category in ("physical", "accessibility")
        assert r.is_active is True


@pytest.mark.asyncio
async def test_attribute_types_endpoint_returns_seeded(client):
    r = await client.get("/api/v1/attribute-types")
    assert r.status_code == 200
    keys = {a["key"] for a in r.json()}
    assert SLICE1_KEYS <= keys
