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
    components = schema["components"]["schemas"]
    # add_fountain now has TWO 409 shapes: the duplicate conflict and the name gate.
    assert "DuplicateFountainConflict" in components
    assert "DisplayNameRequiredConflict" in components
    post = schema["paths"]["/api/v1/fountains"]["post"]
    conflict = post["responses"]["409"]["content"]["application/json"]["schema"]
    refs = {opt.get("$ref") for opt in conflict["anyOf"]}
    assert refs == {
        "#/components/schemas/DuplicateFountainConflict",
        "#/components/schemas/DisplayNameRequiredConflict",
    }
