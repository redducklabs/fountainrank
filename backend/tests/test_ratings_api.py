import asyncio

from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.main import app


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


async def test_concurrent_ratings_keep_aggregates_consistent():
    # Two different users rating the same fountain at once must end with BOTH votes
    # reflected in the denormalized aggregates. The FOR UPDATE lock in submit_ratings
    # serializes the recompute so the later commit can't persist a snapshot that
    # missed the other rating. Runs the real dev-auth seam (distinct X-Dev-User per
    # request) so each concurrent call is a distinct user.
    app.dependency_overrides[get_settings] = lambda: Settings(dev_auth_enabled=True)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            created = await ac.post(
                "/api/v1/fountains",
                json={"location": {"latitude": 37.7749, "longitude": -122.4194}},
                headers={"X-Dev-User": "creator", "X-Dev-Name": "Creator"},
            )
            assert created.status_code == 201
            fid = created.json()["id"]

            async def rate(subject: str, stars: int):
                return await ac.post(
                    f"/api/v1/fountains/{fid}/ratings",
                    json={"ratings": [{"rating_type_id": 1, "stars": stars}]},
                    headers={"X-Dev-User": subject, "X-Dev-Name": f"Name {subject}"},
                )

            r_a, r_b = await asyncio.gather(rate("rater-a", 5), rate("rater-b", 1))
            assert r_a.status_code == 200
            assert r_b.status_code == 200

            detail = await ac.get(f"/api/v1/fountains/{fid}")
    finally:
        app.dependency_overrides.pop(get_settings, None)

    body = detail.json()
    assert body["rating_count"] == 2  # both distinct users counted
    assert abs(body["average_rating"] - 3.0) < 1e-9  # mean of 5 and 1
