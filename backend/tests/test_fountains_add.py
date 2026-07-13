import asyncio

from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.main import app


async def test_add_fountain_returns_detail(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 37.7749, "longitude": -122.4194},
            "is_working": True,
            "comments": "Cold and clean",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["location"]["latitude"] == 37.7749
    assert body["location"]["longitude"] == -122.4194
    assert body["is_working"] is True
    assert body["comments"] == "Cold and clean"
    assert body["rating_count"] == 0
    assert body["average_rating"] is None
    assert len(body["dimensions"]) == 4  # all dimensions present, zero votes
    assert all(d["vote_count"] == 0 for d in body["dimensions"])


async def test_add_fountain_with_inline_ratings_recomputes(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 40.0, "longitude": -73.0},
            "ratings": [{"rating_type_id": 1, "stars": 5}, {"rating_type_id": 2, "stars": 3}],
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["rating_count"] == 1
    assert abs(body["average_rating"] - 4.0) < 1e-9


async def test_add_fountain_rejects_proximity_duplicate(client):
    point = {"latitude": 37.7749, "longitude": -122.4194}
    first = await client.post("/api/v1/fountains", json={"location": point})
    assert first.status_code == 201
    dup = await client.post("/api/v1/fountains", json={"location": point})
    assert dup.status_code == 409


async def test_add_fountain_rejects_unknown_rating_type(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "ratings": [{"rating_type_id": 99, "stars": 5}],
        },
    )
    assert resp.status_code == 422


async def test_add_fountain_rejects_out_of_range_stars(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "ratings": [{"rating_type_id": 1, "stars": 9}],
        },
    )
    assert resp.status_code == 422


async def test_add_fountain_normalizes_comments(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "comments": "  Near the north gate.  ",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["comments"] == "Near the north gate."


async def test_add_fountain_rejects_oversized_comments(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": 1.0, "longitude": 2.0}, "comments": "x" * 1001},
    )
    assert resp.status_code == 422


async def test_add_fountain_accepts_comment_at_limit(client):
    resp = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": 1.0, "longitude": 2.0}, "comments": "x" * 1000},
    )
    assert resp.status_code == 201
    assert resp.json()["comments"] == "x" * 1000


async def test_add_fountain_rejects_duplicate_inline_ids(client):
    duplicate_rating = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "ratings": [
                {"rating_type_id": 1, "stars": 2},
                {"rating_type_id": 1, "stars": 5},
            ],
        },
    )
    assert duplicate_rating.status_code == 422

    duplicate_observation = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "observations": [
                {"attribute_type_id": 1, "value": "yes"},
                {"attribute_type_id": 1, "value": "no"},
            ],
        },
    )
    assert duplicate_observation.status_code == 422


async def test_add_fountain_rejects_inline_lists_over_schema_ceilings(client):
    too_many_ratings = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "ratings": [{"rating_type_id": i, "stars": 3} for i in range(1, 34)],
        },
    )
    assert too_many_ratings.status_code == 422

    too_many_observations = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 1.0, "longitude": 2.0},
            "observations": [{"attribute_type_id": i, "value": "yes"} for i in range(1, 130)],
        },
    )
    assert too_many_observations.status_code == 422


async def test_concurrent_add_same_point_dedupes_to_one():
    # Two concurrent adds at the same coordinates must not both succeed. The
    # transaction advisory lock serializes the proximity check + insert, so exactly one
    # gets 201 and the other 409 — and only one fountain is persisted. Runs the real
    # dev-auth seam so each concurrent request is a distinct user.
    app.dependency_overrides[get_settings] = lambda: Settings(dev_auth_enabled=True)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:

            async def add(subject: str):
                return await ac.post(
                    "/api/v1/fountains",
                    json={"location": {"latitude": 37.7749, "longitude": -122.4194}},
                    headers={"X-Dev-User": subject, "X-Dev-Name": f"Name {subject}"},
                )

            r_a, r_b = await asyncio.gather(add("adder-a"), add("adder-b"))
            assert sorted([r_a.status_code, r_b.status_code]) == [201, 409]

            nearby = await ac.get(
                "/api/v1/fountains",
                params={"lat": 37.7749, "lng": -122.4194, "radius_m": 50},
            )
        assert len(nearby.json()) == 1  # only one fountain persisted
    finally:
        app.dependency_overrides.pop(get_settings, None)
