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
