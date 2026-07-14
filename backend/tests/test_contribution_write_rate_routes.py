import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.auth import get_current_user
from app.main import app
from app.models import User, WriteAttempt
from app.rate_limit import RateLimited, get_write_attempt_reserver

LOC = {"latitude": 37.0, "longitude": -122.0}

ROUTES = (
    ("/api/v1/fountains", {"location": LOC, "is_working": True}, "fountain_create"),
    (
        f"/api/v1/fountains/{uuid.uuid4()}/ratings",
        {"ratings": [{"rating_type_id": 1, "stars": 5}]},
        "rating_submit",
    ),
    (
        f"/api/v1/fountains/{uuid.uuid4()}/attributes",
        {"observations": [{"attribute_type_id": 1, "value": "yes"}]},
        "attribute_submit",
    ),
    (
        f"/api/v1/fountains/{uuid.uuid4()}/conditions",
        {"status": "working"},
        "condition_submit",
    ),
    (f"/api/v1/fountains/{uuid.uuid4()}/notes", {"body": "hello"}, "note_submit"),
)


@pytest.mark.parametrize(("path", "payload", "endpoint"), ROUTES)
async def test_contribution_route_uses_shared_budget_and_maps_rejection(
    client, test_user, path, payload, endpoint
):
    calls = []

    def override_reserver():
        async def reject(user_id, budget, endpoint_code):
            calls.append((user_id, budget, endpoint_code))
            raise RateLimited("contribution_writes_per_minute", retry_after=17)

        return reject

    app.dependency_overrides[get_write_attempt_reserver] = override_reserver
    try:
        response = await client.post(path, json=payload)
    finally:
        app.dependency_overrides.pop(get_write_attempt_reserver, None)

    assert response.status_code == 429
    assert response.json() == {"detail": "contribution_writes_per_minute"}
    assert response.headers["Retry-After"] == "17"
    assert calls == [(test_user.id, "contribution_write", endpoint)]


@pytest.mark.parametrize(("path", "payload", "endpoint"), ROUTES)
async def test_contribution_route_reserves_before_unnamed_user_conflict(
    clean_db, session, path, payload, endpoint
):
    anonymous = User(
        logto_user_id="route-rate-anonymous",
        email="anonymous@example.com",
        display_name="route-rate-anonymous",
    )
    session.add(anonymous)
    await session.commit()
    await session.refresh(anonymous)
    calls = []

    async def override_user():
        return anonymous

    def override_reserver():
        async def reserve(user_id, budget, endpoint_code):
            calls.append((user_id, budget, endpoint_code))

        return reserve

    app.dependency_overrides[get_current_user] = override_user
    app.dependency_overrides[get_write_attempt_reserver] = override_reserver
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as raw_client:
            response = await raw_client.post(path, json=payload)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_write_attempt_reserver, None)

    assert response.status_code == 409
    assert response.json() == {"detail": "display_name_required"}
    assert calls == [(anonymous.id, "contribution_write", endpoint)]


@pytest.mark.parametrize(
    ("path", "payload", "expected_status"),
    (
        (
            "/api/v1/fountains",
            {
                "location": LOC,
                "is_working": True,
                "ratings": [{"rating_type_id": 32000, "stars": 5}],
            },
            422,
        ),
        (
            f"/api/v1/fountains/{uuid.uuid4()}/ratings",
            {"ratings": [{"rating_type_id": 1, "stars": 5}]},
            404,
        ),
        (
            f"/api/v1/fountains/{uuid.uuid4()}/attributes",
            {"observations": [{"attribute_type_id": 1, "value": "yes"}]},
            404,
        ),
        (
            f"/api/v1/fountains/{uuid.uuid4()}/conditions",
            {"status": "working"},
            404,
        ),
        (f"/api/v1/fountains/{uuid.uuid4()}/notes", {"body": "hello"}, 404),
    ),
)
async def test_post_admission_business_failure_keeps_attempt(
    client, session, path, payload, expected_status
):
    response = await client.post(path, json=payload)
    assert response.status_code == expected_status, response.text
    assert (await session.scalar(select(func.count()).select_from(WriteAttempt))) == 1


async def test_real_contribution_route_limit_stops_domain_work_at_boundary(client, session):
    # Unknown fountains make the admitted requests cheap while proving that business-level
    # failures still consume the shared durable budget.
    for _ in range(20):
        response = await client.post(
            f"/api/v1/fountains/{uuid.uuid4()}/notes", json={"body": "hello"}
        )
        assert response.status_code == 404

    rejected = await client.post(
        f"/api/v1/fountains/{uuid.uuid4()}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )

    assert rejected.status_code == 429
    assert rejected.json() == {"detail": "contribution_writes_per_minute"}
    assert 1 <= int(rejected.headers["Retry-After"]) <= 60
    assert (await session.scalar(select(func.count()).select_from(WriteAttempt))) == 20
