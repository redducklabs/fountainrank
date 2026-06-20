import uuid

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models import RatingType


async def test_detail_returns_dimension_breakdown(client):
    add = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 37.7749, "longitude": -122.4194},
            "comments": "Park fountain",
            "ratings": [{"rating_type_id": 1, "stars": 5}, {"rating_type_id": 2, "stars": 3}],
        },
    )
    fid = add.json()["id"]
    resp = await client.get(f"/api/v1/fountains/{fid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == fid
    assert body["comments"] == "Park fountain"
    assert body["rating_count"] == 1
    assert len(body["dimensions"]) == 4
    clarity = next(d for d in body["dimensions"] if d["rating_type_id"] == 1)
    assert clarity["average_rating"] == 5.0 and clarity["vote_count"] == 1
    pressure = next(d for d in body["dimensions"] if d["rating_type_id"] == 3)
    assert pressure["average_rating"] is None and pressure["vote_count"] == 0


async def test_detail_unknown_id_404(client):
    resp = await client.get(f"/api/v1/fountains/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_detail_dimensions_ordered_by_sort_order(client, session):
    # Insert a probe type with id=99 (highest) but sort_order=0 (lowest).
    # If ordering is by id it will appear LAST; if by sort_order it must appear FIRST.
    # clean_db (conftest) removes id >= 10 before each test, so this is always fresh.
    await session.execute(
        pg_insert(RatingType)
        .values(id=99, name="Zzz", description="probe", sort_order=0)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await session.commit()
    add = await client.post(
        "/api/v1/fountains", json={"location": {"latitude": 37.7749, "longitude": -122.4194}}
    )
    fid = add.json()["id"]
    resp = await client.get(f"/api/v1/fountains/{fid}")
    names = [d["name"] for d in resp.json()["dimensions"]]
    assert names[0] == "Zzz"  # sort_order 0 -> first (would be LAST if ordered by id)
