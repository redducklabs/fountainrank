async def test_list_rating_types_returns_seeded_dimensions(client):
    resp = await client.get("/api/v1/rating-types")
    assert resp.status_code == 200
    body = resp.json()
    assert [rt["name"] for rt in body] == ["Clarity", "Taste", "Pressure", "Appearance"]
    assert body[0] == {
        "id": 1,
        "name": "Clarity",
        "description": "How clear and clean the water looks",
        "sort_order": 1,
    }
