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


async def test_detail_write_response_includes_callers_your_rating(client):
    # #65: the authenticated write response carries the caller's own stars per dimension
    # so the rating UI can pre-fill; dimensions the caller hasn't rated stay null.
    add = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 37.7749, "longitude": -122.4194},
            "ratings": [{"rating_type_id": 1, "stars": 5}],
        },
    )
    assert add.status_code == 201
    dims = {d["rating_type_id"]: d for d in add.json()["dimensions"]}
    assert dims[1]["your_rating"] == 5
    assert dims[2]["your_rating"] is None


async def test_detail_your_rating_updates_on_resubmit(client):
    # Re-rating the same dimension updates your_rating (upsert) without double-counting.
    add = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 37.7749, "longitude": -122.4194},
            "ratings": [{"rating_type_id": 1, "stars": 5}],
        },
    )
    fid = add.json()["id"]
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 2}]},
    )
    assert resp.status_code == 200
    dims = {d["rating_type_id"]: d for d in resp.json()["dimensions"]}
    assert dims[1]["your_rating"] == 2
    assert dims[1]["vote_count"] == 1  # updated, not a second vote


async def test_detail_anonymous_get_has_null_your_rating(client):
    # An anonymous GET (no credentials) must never surface another user's rating as "yours".
    add = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 37.7749, "longitude": -122.4194},
            "ratings": [{"rating_type_id": 1, "stars": 5}],
        },
    )
    fid = add.json()["id"]
    resp = await client.get(f"/api/v1/fountains/{fid}")
    assert resp.status_code == 200
    assert all(d["your_rating"] is None for d in resp.json()["dimensions"])


async def test_detail_authenticated_get_includes_your_rating(client, test_user):
    # The public GET enriches with the caller's own rating when authenticated (optional-auth).
    from app.auth import get_optional_user
    from app.main import app

    add = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 37.7749, "longitude": -122.4194},
            "ratings": [{"rating_type_id": 1, "stars": 4}],
        },
    )
    fid = add.json()["id"]
    app.dependency_overrides[get_optional_user] = lambda: test_user
    try:
        resp = await client.get(f"/api/v1/fountains/{fid}")
    finally:
        app.dependency_overrides.pop(get_optional_user, None)
    assert resp.status_code == 200
    dims = {d["rating_type_id"]: d for d in resp.json()["dimensions"]}
    assert dims[1]["your_rating"] == 4


async def test_detail_dimensions_ordered_by_sort_order(client, session):
    # Insert a probe type with id=99 (highest) but sort_order=0 (lowest).
    # If ordering is by id it will appear LAST; if by sort_order it must appear FIRST.
    # The probe row is cleaned up locally in the finally block below (not via shared infra).
    from sqlalchemy import text as _text

    await session.execute(
        pg_insert(RatingType)
        .values(id=99, name="Zzz", description="probe", sort_order=0)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await session.commit()
    try:
        add = await client.post(
            "/api/v1/fountains", json={"location": {"latitude": 37.7749, "longitude": -122.4194}}
        )
        fid = add.json()["id"]
        resp = await client.get(f"/api/v1/fountains/{fid}")
        names = [d["name"] for d in resp.json()["dimensions"]]
        assert names[0] == "Zzz"  # sort_order 0 -> first (would be LAST if ordered by id)
    finally:
        await session.execute(_text("DELETE FROM rating_types WHERE id = 99"))
        await session.commit()
