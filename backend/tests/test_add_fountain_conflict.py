import pytest

from app.geo import point_geography
from app.models import Fountain


@pytest.mark.asyncio
async def test_duplicate_add_returns_typed_conflict_with_fountain_id(client, session, test_user):
    existing = Fountain(
        location=point_geography(37.77, -122.41),
        is_working=True,
        created_source="user",
        added_by_user_id=test_user.id,
    )
    session.add(existing)
    await session.commit()
    await session.refresh(existing)
    r = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": 37.77, "longitude": -122.41}, "is_working": True},
    )
    assert r.status_code == 409
    body = r.json()
    assert body["detail"] == "duplicate_fountain"
    assert body["fountain_id"] == str(existing.id)


def test_openapi_declares_typed_conflict_schema():
    from app.main import app

    schema = app.openapi()
    assert "DuplicateFountainConflict" in schema["components"]["schemas"]
    post = schema["paths"]["/api/v1/fountains"]["post"]
    ref = post["responses"]["409"]["content"]["application/json"]["schema"]["$ref"]
    assert ref == "#/components/schemas/DuplicateFountainConflict"
