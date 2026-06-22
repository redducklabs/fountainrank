import pytest
from sqlalchemy import delete

from app.models import RatingType


async def test_list_rating_types_returns_seeded_dimensions(client):
    resp = await client.get("/api/v1/rating-types")
    assert resp.status_code == 200
    body = resp.json()
    assert [rt["name"] for rt in body] == ["Clarity", "Taste", "Pressure", "Appearance"]
    assert body[0] == {
        "id": 1,
        "name": "Clarity",
        "description": "How clear and clean the water looks",
        "sort_order": 1,
    }


@pytest.mark.asyncio
async def test_rating_types_excludes_non_fountain(client, session):
    # A non-fountain dimension must not leak into the fountain rating-types list (#44).
    session.add(
        RatingType(
            id=90, name="RestroomCleanliness", description="x", sort_order=90, place_type="restroom"
        )
    )
    await session.commit()
    try:
        resp = await client.get("/api/v1/rating-types")
        assert 90 not in {rt["id"] for rt in resp.json()}
    finally:
        await session.execute(delete(RatingType).where(RatingType.id == 90))
        await session.commit()
