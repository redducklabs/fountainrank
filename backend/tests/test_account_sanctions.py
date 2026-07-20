from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.config import Settings, get_settings
from app.main import app
from app.models import ModerationAction, User

pytestmark = pytest.mark.anyio


@pytest.fixture
async def raw_client():
    app.dependency_overrides[get_settings] = lambda: Settings(
        dev_auth_enabled=True, admin_subjects=["sanctions-admin"]
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.pop(get_settings, None)


async def _user(session, subject: str, *, is_admin: bool = False) -> User:
    user = User(
        logto_user_id=subject,
        email=f"{subject}@example.com",
        display_name=subject,
        is_admin=is_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def test_admin_can_suspend_ban_and_lift_with_audit(raw_client, session):
    target = await _user(session, "sanctions-target")
    headers = {"X-Dev-User": "sanctions-admin"}
    expiry = datetime.now(UTC) + timedelta(days=2)

    suspended = await raw_client.patch(
        f"/api/v1/admin/users/{target.id}/sanction",
        headers=headers,
        json={
            "status": "suspended",
            "reason": "Repeated abuse",
            "suspended_until": expiry.isoformat(),
        },
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"

    banned = await raw_client.patch(
        f"/api/v1/admin/users/{target.id}/sanction",
        headers=headers,
        json={"status": "banned", "reason": "Escalated abuse"},
    )
    assert banned.status_code == 200
    assert banned.json()["status"] == "banned"

    lifted = await raw_client.patch(
        f"/api/v1/admin/users/{target.id}/sanction",
        headers=headers,
        json={"status": "active", "reason": "Appeal accepted"},
    )
    assert lifted.status_code == 200
    assert lifted.json()["reason"] is None
    actions = (
        (
            await session.execute(
                select(ModerationAction.action)
                .where(ModerationAction.content_id == target.id)
                .order_by(ModerationAction.created_at)
            )
        )
        .scalars()
        .all()
    )
    assert actions == ["suspend", "ban", "unban"]


async def test_sanction_is_idempotent_and_admin_targets_are_rejected(raw_client, session):
    target = await _user(session, "idempotent-target")
    other_admin = await _user(session, "other-admin", is_admin=True)
    headers = {"X-Dev-User": "sanctions-admin"}
    body = {"status": "banned", "reason": "Abuse"}
    first = await raw_client.patch(
        f"/api/v1/admin/users/{target.id}/sanction", headers=headers, json=body
    )
    second = await raw_client.patch(
        f"/api/v1/admin/users/{target.id}/sanction", headers=headers, json=body
    )
    assert first.status_code == second.status_code == 200
    count = (
        (
            await session.execute(
                select(ModerationAction).where(ModerationAction.content_id == target.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(count) == 1

    rejected = await raw_client.patch(
        f"/api/v1/admin/users/{other_admin.id}/sanction", headers=headers, json=body
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"] == "cannot_sanction_admin"


async def test_sanctioned_user_can_read_but_not_write(raw_client, session):
    admin = await _user(session, "actor-for-block", is_admin=True)
    user = await _user(session, "blocked-writer")
    user.account_status = "banned"
    user.sanction_reason = "Abuse"
    user.sanctioned_at = datetime.now(UTC)
    user.sanctioned_by_user_id = admin.id
    await session.commit()
    headers = {"X-Dev-User": "blocked-writer"}
    assert (await raw_client.get("/api/v1/me", headers=headers)).status_code == 200
    blocked = await raw_client.patch(
        "/api/v1/me", headers=headers, json={"display_name": "Still blocked"}
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "account_banned"


async def test_sanctioned_user_profile_sync_is_blocked_but_account_erasure_is_allowed(
    raw_client, session
):
    actor = await _user(session, "erasure-actor", is_admin=True)
    user = await _user(session, "erasure-user")
    user.account_status = "banned"
    user.sanction_reason = "Abuse"
    user.sanctioned_at = datetime.now(UTC)
    user.sanctioned_by_user_id = actor.id
    await session.commit()
    headers = {"X-Dev-User": "erasure-user"}

    sync = await raw_client.post(
        "/api/v1/me/sync", headers=headers, json={"userinfo_token": "unused"}
    )
    assert sync.status_code == 403
    deleted = await raw_client.delete("/api/v1/me", headers=headers)
    assert deleted.status_code == 204


async def test_expired_suspension_is_cleared_once_with_system_audit(raw_client, session):
    actor = await _user(session, "expiry-actor", is_admin=True)
    user = await _user(session, "expired-user")
    user.account_status = "suspended"
    user.suspended_until = datetime.now(UTC) - timedelta(minutes=1)
    user.sanction_reason = "Cooling off"
    user.sanctioned_at = datetime.now(UTC) - timedelta(days=1)
    user.sanctioned_by_user_id = actor.id
    await session.commit()

    headers = {"X-Dev-User": "expired-user"}
    response = await raw_client.patch("/api/v1/me", headers=headers, json={"display_name": "Back"})
    assert response.status_code == 200
    me = await raw_client.get("/api/v1/me", headers=headers)
    assert me.json()["account_status"] == "active"
    rows = (
        (
            await session.execute(
                select(ModerationAction).where(
                    ModerationAction.content_id == user.id, ModerationAction.action == "expire"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].actor_kind == "system"
    assert rows[0].admin_user_id is None
    assert rows[0].admin_actor_id is None
