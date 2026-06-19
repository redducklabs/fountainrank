async def _add_fountain(client) -> str:
    resp = await client.post(
        "/api/v1/fountains", json={"location": {"latitude": 37.7749, "longitude": -122.4194}}
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_submit_ratings_updates_denormalized_fields(client):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 4}, {"rating_type_id": 3, "stars": 2}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["rating_count"] == 1
    assert abs(body["average_rating"] - 3.0) < 1e-9
    clarity = next(d for d in body["dimensions"] if d["rating_type_id"] == 1)
    assert clarity["average_rating"] == 4.0
    assert clarity["vote_count"] == 1


async def test_submit_ratings_is_upsert(client):
    fid = await _add_fountain(client)
    await client.post(
        f"/api/v1/fountains/{fid}/ratings", json={"ratings": [{"rating_type_id": 1, "stars": 1}]}
    )
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings", json={"ratings": [{"rating_type_id": 1, "stars": 5}]}
    )
    body = resp.json()
    clarity = next(d for d in body["dimensions"] if d["rating_type_id"] == 1)
    assert clarity["average_rating"] == 5.0  # replaced, not duplicated
    assert clarity["vote_count"] == 1


async def test_submit_ratings_unknown_fountain_404(client):
    import uuid

    resp = await client.post(
        f"/api/v1/fountains/{uuid.uuid4()}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    assert resp.status_code == 404


async def test_submit_ratings_unknown_type_422(client):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings", json={"ratings": [{"rating_type_id": 42, "stars": 5}]}
    )
    assert resp.status_code == 422


async def test_submit_ratings_dedupes_same_type_in_one_request(client):
    # Two values for the same dimension in one payload must settle to a single row
    # (last wins) — exercises the ON CONFLICT path's in-request dedupe, not a 500.
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 2}, {"rating_type_id": 1, "stars": 5}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    clarity = next(d for d in body["dimensions"] if d["rating_type_id"] == 1)
    assert clarity["vote_count"] == 1
    assert clarity["average_rating"] == 5.0
