async def _add(client, lat, lng):
    resp = await client.post(
        "/api/v1/fountains", json={"location": {"latitude": lat, "longitude": lng}}
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_nearby_returns_within_radius_ordered_by_distance(client):
    # Two points ~1.5 km apart in SF; query from the first with a 2 km radius.
    near = await _add(client, 37.7749, -122.4194)
    far = await _add(client, 37.7884, -122.4194)  # ~1.5 km north
    resp = await client.get(
        "/api/v1/fountains", params={"lat": 37.7749, "lng": -122.4194, "radius_m": 2000}
    )
    assert resp.status_code == 200
    body = resp.json()
    ids = [p["id"] for p in body]
    assert ids == [near, far]  # nearest first
    assert body[0]["distance_m"] < body[1]["distance_m"]
    assert body[0]["distance_m"] < 1.0  # essentially at the query point


async def test_nearby_excludes_outside_radius(client):
    await _add(client, 37.7749, -122.4194)
    await _add(client, 37.8049, -122.4194)  # ~3.3 km north
    resp = await client.get(
        "/api/v1/fountains", params={"lat": 37.7749, "lng": -122.4194, "radius_m": 1000}
    )
    body = resp.json()
    assert len(body) == 1


async def test_bbox_returns_only_points_inside(client):
    inside = await _add(client, 37.7749, -122.4194)
    await _add(client, 40.0, -73.0)  # NYC, far outside an SF box
    resp = await client.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": 37.70, "min_lng": -122.50, "max_lat": 37.80, "max_lng": -122.40},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [p["id"] for p in body] == [inside]
    assert body[0]["distance_m"] is None  # no reference point for bbox


async def test_bbox_rejects_inverted_bounds(client):
    resp = await client.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": 37.80, "min_lng": -122.40, "max_lat": 37.70, "max_lng": -122.50},
    )
    assert resp.status_code == 422
