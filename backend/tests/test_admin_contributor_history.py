import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.geo import point_geography
from app.main import app
from app.models import ContributionEvent, User, UserContributionStats


async def _user(session, subject: str, display_name: str) -> User:
    user = User(
        logto_user_id=subject,
        email=f"{subject}@example.com",
        display_name=display_name,
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_admin_leaderboard_requires_admin_and_public_contract_has_no_ids(
    client, test_user, session
):
    target = await _user(session, "history-target", "Same Name")
    session.add(UserContributionStats(user_id=target.id, total_points=10))
    await session.commit()

    forbidden = await client.get("/api/v1/admin/leaderboard/contributors")
    assert forbidden.status_code == 403
    forbidden_history = await client.get(f"/api/v1/admin/contributors/{target.id}/contributions")
    assert forbidden_history.status_code == 403

    public = await client.get("/api/v1/leaderboard/contributors")
    assert public.status_code == 200
    assert all("user_id" not in row for row in public.json()["rows"])

    test_user.is_admin = True
    await session.commit()
    allowed = await client.get("/api/v1/admin/leaderboard/contributors")
    assert allowed.status_code == 200
    assert allowed.headers["cache-control"] == "private, no-store"
    assert allowed.json()["rows"][0]["user_id"] == str(target.id)


@pytest.mark.asyncio
async def test_admin_local_leaderboard_rows_carry_the_exact_user_id(client, test_user, session):
    test_user.is_admin = True
    first = await _user(session, "same-name-1", "Same Name")
    second = await _user(session, "same-name-2", "Same Name")
    session.add_all(
        [
            ContributionEvent(
                user_id=first.id,
                event_type="add_fountain",
                points=10,
                status="awarded",
                dedup_key="same-name-first",
                location=point_geography(0.001, 0.001),
            ),
            ContributionEvent(
                user_id=second.id,
                event_type="add_fountain",
                points=5,
                status="awarded",
                dedup_key="same-name-second",
                location=point_geography(0.001, 0.001),
            ),
        ]
    )
    await session.commit()
    response = await client.get(
        "/api/v1/admin/leaderboard/contributors",
        params={"near_lat": 0, "near_lng": 0, "radius_m": 5000},
    )
    assert response.status_code == 200
    rows = response.json()["rows"]
    assert [row["display_name"] for row in rows] == ["Same Name", "Same Name"]
    assert [row["user_id"] for row in rows] == [str(first.id), str(second.id)]


@pytest.mark.asyncio
async def test_admin_history_is_stable_paginated_includes_reversals_and_redacts(
    client, test_user, session
):
    test_user.is_admin = True
    target = await _user(session, "history-duplicate", "Same Name")
    session.add(
        UserContributionStats(
            user_id=target.id,
            total_points=7,
            fountains_added=1,
            ratings_count=2,
        )
    )
    tied_at = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)
    oldest_at = tied_at - timedelta(seconds=1)
    high_id = uuid.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")
    low_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    oldest_id = uuid.UUID("00000000-0000-0000-0000-000000000000")
    session.add_all(
        [
            ContributionEvent(
                id=low_id,
                user_id=target.id,
                event_type="rate",
                points=2,
                status="reversed",
                target_type="rating",
                target_id=uuid.uuid4(),
                dedup_key="history-low",
                event_metadata={"rating_type_id": 3, "secret": "must-not-leak"},
                created_at=tied_at,
            ),
            ContributionEvent(
                id=high_id,
                user_id=target.id,
                event_type="report_condition",
                points=1,
                status="awarded",
                dedup_key="history-high",
                event_metadata={"status": "working", "raw_location": "private"},
                created_at=tied_at,
            ),
            ContributionEvent(
                id=oldest_id,
                user_id=target.id,
                event_type="add_fountain",
                points=5,
                status="awarded",
                dedup_key="history-oldest",
                event_metadata=None,
                created_at=oldest_at,
            ),
        ]
    )
    await session.commit()

    first = await client.get(
        f"/api/v1/admin/contributors/{target.id}/contributions", params={"limit": 2}
    )
    assert first.status_code == 200
    assert first.headers["cache-control"] == "private, no-store"
    body = first.json()
    assert body["user_id"] == str(target.id)
    assert body["display_name"] == "Same Name"
    assert body["stats"]["total_points"] == 7
    assert [event["id"] for event in body["events"]] == [str(high_id), str(low_id)]
    assert [event["status"] for event in body["events"]] == ["awarded", "reversed"]
    assert body["events"][0]["metadata"] == {"status": "working"}
    assert body["events"][1]["metadata"] == {"rating_type_id": 3}
    for event in body["events"]:
        assert "dedup_key" not in event
        assert "location" not in event
        assert "event_metadata" not in event

    second = await client.get(
        f"/api/v1/admin/contributors/{target.id}/contributions",
        params={"limit": 2, "cursor": body["next_cursor"]},
    )
    assert second.status_code == 200
    assert [event["id"] for event in second.json()["events"]] == [str(oldest_id)]
    assert second.json()["next_cursor"] is None


@pytest.mark.asyncio
async def test_admin_history_rejects_invalid_cursor_and_unknown_user(client, test_user, session):
    test_user.is_admin = True
    await session.commit()
    invalid = await client.get(
        f"/api/v1/admin/contributors/{test_user.id}/contributions",
        params={"cursor": "not-a-cursor"},
    )
    assert invalid.status_code == 422
    missing = await client.get(f"/api/v1/admin/contributors/{uuid.uuid4()}/contributions")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_admin_history_rejects_anonymous():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as anonymous:
        response = await anonymous.get(f"/api/v1/admin/contributors/{uuid.uuid4()}/contributions")
    assert response.status_code == 401
