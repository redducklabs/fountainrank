import pytest

from app.geo import point_geography
from app.models import Fountain


async def _mk(session, lat, lng, hidden, user_id):
    f = Fountain(
        location=point_geography(lat, lng),
        is_working=True,
        created_source="user",
        added_by_user_id=user_id,
        is_hidden=hidden,
    )
    session.add(f)
    await session.commit()
    await session.refresh(f)
    return f


@pytest.mark.asyncio
async def test_hidden_excluded_from_bbox_nearby_detail(client, session, test_user):
    visible = await _mk(session, 37.77, -122.41, False, test_user.id)
    hidden = await _mk(session, 37.7701, -122.4101, True, test_user.id)
    r = await client.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": 37.0, "min_lng": -123.0, "max_lat": 38.0, "max_lng": -122.0},
    )
    ids = {x["id"] for x in r.json()}
    assert str(visible.id) in ids and str(hidden.id) not in ids
    r2 = await client.get(
        "/api/v1/fountains", params={"lat": 37.77, "lng": -122.41, "radius_m": 5000}
    )
    ids2 = {x["id"] for x in r2.json()}
    assert str(hidden.id) not in ids2
    assert (await client.get(f"/api/v1/fountains/{hidden.id}")).status_code == 404


@pytest.mark.asyncio
async def test_hidden_does_not_block_add_and_cannot_be_rated(client, session, test_user):
    hidden = await _mk(session, 37.77, -122.41, True, test_user.id)
    # add at the same point succeeds (hidden row ignored by duplicate check)
    r = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": 37.77, "longitude": -122.41}, "is_working": True},
    )
    assert r.status_code == 201
    # rating the hidden row 404s
    rr = await client.post(
        f"/api/v1/fountains/{hidden.id}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    assert rr.status_code == 404
