import asyncio
import uuid

from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.config import Settings, get_settings
from app.main import app
from app.models import Rating

# The coordinates _add_fountain places the fountain at (used by the proximity tests below).
FOUNTAIN_LAT, FOUNTAIN_LNG = 37.7749, -122.4194


async def _add_fountain(client) -> str:
    resp = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": FOUNTAIN_LAT, "longitude": FOUNTAIN_LNG}},
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


async def test_submit_ratings_rejects_same_type_in_one_request(client, session):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 2}, {"rating_type_id": 1, "stars": 5}]},
    )
    assert resp.status_code == 422
    count = (
        await session.execute(
            select(func.count()).select_from(Rating).where(Rating.fountain_id == uuid.UUID(fid))
        )
    ).scalar_one()
    assert count == 0


async def test_submit_ratings_rejects_more_than_schema_ceiling(client):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": i, "stars": 3} for i in range(1, 34)]},
    )
    assert resp.status_code == 422


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


# --- Rating proximity guard (#3, spec §4.5) ---


async def test_rating_latitude_without_longitude_is_422(client):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}], "latitude": 40.0},
    )
    assert resp.status_code == 422


async def test_rating_within_radius_sets_proximate(client, session):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={
            "ratings": [{"rating_type_id": 1, "stars": 5}],
            "latitude": FOUNTAIN_LAT,
            "longitude": FOUNTAIN_LNG,
        },
    )
    assert resp.status_code == 200
    row = (
        await session.execute(select(Rating).where(Rating.fountain_id == uuid.UUID(fid)))
    ).scalar_one()
    assert row.is_proximate is True


async def test_rating_outside_radius_is_403_and_writes_nothing(client, session):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={
            "ratings": [{"rating_type_id": 1, "stars": 5}],
            "latitude": 0.0,
            "longitude": 0.0,
        },  # ~thousands of km away
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "outside_rating_radius"
    count = (
        await session.execute(
            select(func.count()).select_from(Rating).where(Rating.fountain_id == uuid.UUID(fid))
        )
    ).scalar_one()
    assert count == 0


async def test_rating_without_coords_is_accepted_not_proximate(client, session):
    fid = await _add_fountain(client)
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 4}]},
    )
    assert resp.status_code == 200
    row = (
        await session.execute(select(Rating).where(Rating.fountain_id == uuid.UUID(fid)))
    ).scalar_one()
    assert row.is_proximate is False


async def test_rerate_without_coords_does_not_downgrade_proximate(client, session):
    fid = await _add_fountain(client)
    await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={
            "ratings": [{"rating_type_id": 1, "stars": 5}],
            "latitude": FOUNTAIN_LAT,
            "longitude": FOUNTAIN_LNG,
        },
    )
    # Re-rate with NO coords: stars change, but is_proximate stays true (MONOTONIC).
    await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 3}]},
    )
    row = (
        await session.execute(select(Rating).where(Rating.fountain_id == uuid.UUID(fid)))
    ).scalar_one()
    assert row.stars == 3
    assert row.is_proximate is True


# --- Validation-error logging privacy (#3, spec §6/§7) ---


async def test_validation_error_logs_sanitized_fields_only(client, caplog):
    fid = await _add_fountain(client)
    with caplog.at_level("INFO", logger="app"):
        resp = await client.post(
            f"/api/v1/fountains/{fid}/ratings",
            json={
                "ratings": [{"rating_type_id": 1, "stars": 5}],
                "latitude": 999.0,
                "longitude": 1.0,
            },
        )
    assert resp.status_code == 422
    # The out-of-range coordinate must never reach the log stream (spec §7).
    assert "999" not in caplog.text
    # The sanitized record WAS emitted, and carries loc/type but not the raw input.
    rec = next(r for r in caplog.records if r.getMessage() == "request validation failed")
    assert rec.errors  # list of {loc, type}
    assert all("input" not in e and "ctx" not in e for e in rec.errors)


async def test_validation_error_response_body_unchanged(client):
    fid = await _add_fountain(client)
    # The 422 response body keeps FastAPI's default list-shaped `detail` — no API-wide change.
    resp = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": []},  # min_length violation -> default validation error
    )
    assert resp.status_code == 422
    assert isinstance(resp.json()["detail"], list)
    assert resp.json()["detail"][0]["type"]  # standard Pydantic error entry
