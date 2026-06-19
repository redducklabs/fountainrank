import uuid


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
