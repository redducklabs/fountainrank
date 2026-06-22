import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.consensus import recompute_attribute_consensus
from app.main import app
from app.models import (
    AttributeObservation,
    AttributeType,
    ContributionEvent,
    User,
    UserContributionStats,
)

BOTTLE_FILLER = 1  # seeded boolean attribute_type id


async def _add_fountain(client, lat=10.0, lng=20.0) -> str:
    r = await client.post(
        "/api/v1/fountains", json={"location": {"latitude": lat, "longitude": lng}}
    )
    assert r.status_code == 201
    return r.json()["id"]


def _attr(detail: dict, key: str) -> dict | None:
    return next((a for a in detail["attributes"] if a["key"] == key), None)


async def _observe(client, fid, attribute_type_id, value):
    return await client.post(
        f"/api/v1/fountains/{fid}/attributes",
        json={"observations": [{"attribute_type_id": attribute_type_id, "value": value}]},
    )


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


@pytest.mark.asyncio
async def test_observe_reflected_in_detail(client):
    fid = await _add_fountain(client)
    r = await _observe(client, fid, BOTTLE_FILLER, "yes")
    assert r.status_code == 200
    bf = _attr(r.json(), "bottle_filler")
    assert bf is not None
    assert bf["consensus_value"] == "yes"
    assert bf["confidence"] == "low"
    assert bf["yes_count"] == 1 and bf["observation_count"] == 1

    # Confirm via the detail endpoint too.
    detail = (await client.get(f"/api/v1/fountains/{fid}")).json()
    assert _attr(detail, "bottle_filler")["consensus_value"] == "yes"


@pytest.mark.asyncio
async def test_edit_replaces_user_value(client):
    fid = await _add_fountain(client)
    await _observe(client, fid, BOTTLE_FILLER, "yes")
    r = await _observe(client, fid, BOTTLE_FILLER, "no")
    bf = _attr(r.json(), "bottle_filler")
    assert bf["consensus_value"] == "no"
    assert bf["observation_count"] == 1  # replaced, not duplicated
    assert bf["yes_count"] == 0 and bf["no_count"] == 1


@pytest.mark.asyncio
async def test_unknown_does_not_decide(client):
    fid = await _add_fountain(client)
    r = await _observe(client, fid, BOTTLE_FILLER, "unknown")
    bf = _attr(r.json(), "bottle_filler")
    assert bf["consensus_value"] is None
    assert bf["confidence"] == "none"
    assert bf["unknown_count"] == 1 and bf["observation_count"] == 1


@pytest.mark.asyncio
async def test_two_users_then_hide_recompute(client, test_user, session):
    fid = await _add_fountain(client)
    await _observe(client, fid, BOTTLE_FILLER, "yes")  # test_user

    u2 = User(logto_user_id="attr-u2", email="attr-u2@example.com", display_name="U2")
    session.add(u2)
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: u2
    try:
        await _observe(client, fid, BOTTLE_FILLER, "no")  # u2 disagrees
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user

    detail = (await client.get(f"/api/v1/fountains/{fid}")).json()
    bf = _attr(detail, "bottle_filler")
    assert bf["consensus_value"] is None and bf["confidence"] == "mixed"  # tie

    # Moderation hides u2's observation -> recompute must drop it from consensus.
    await session.execute(
        update(AttributeObservation)
        .where(
            AttributeObservation.user_id == u2.id,
            AttributeObservation.attribute_type_id == BOTTLE_FILLER,
        )
        .values(is_hidden=True)
    )
    await recompute_attribute_consensus(session, uuid.UUID(fid), BOTTLE_FILLER)
    await session.commit()

    detail2 = (await client.get(f"/api/v1/fountains/{fid}")).json()
    bf2 = _attr(detail2, "bottle_filler")
    assert bf2["consensus_value"] == "yes"
    assert bf2["no_count"] == 0 and bf2["observation_count"] == 1


@pytest.mark.asyncio
async def test_unknown_attribute_type_422(client):
    fid = await _add_fountain(client)
    r = await _observe(client, fid, 99999, "yes")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_illegal_value_422(client):
    fid = await _add_fountain(client)
    r = await _observe(client, fid, BOTTLE_FILLER, "maybe")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_non_fountain_attribute_type_422(client, session):
    session.add(
        AttributeType(
            id=9200,
            key="restroom_thing",
            place_type="restroom",
            category="physical",
            name="Restroom thing",
            description="x",
            value_kind="boolean",
            sort_order=1,
        )
    )
    await session.commit()
    try:
        fid = await _add_fountain(client)
        r = await _observe(client, fid, 9200, "yes")
        assert r.status_code == 422
    finally:
        await session.execute(delete(AttributeType).where(AttributeType.id == 9200))
        await session.commit()


@pytest.mark.asyncio
async def test_attributes_requires_auth(settings_override):
    # No get_current_user override + dev auth disabled -> 401.
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/v1/fountains/{uuid.uuid4()}/attributes",
            json={"observations": [{"attribute_type_id": BOTTLE_FILLER, "value": "yes"}]},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_observe_emits_event_and_no_double_award(client, test_user, session):
    fid = await _add_fountain(client)
    await _observe(client, fid, BOTTLE_FILLER, "yes")

    ev = (
        await session.execute(
            select(ContributionEvent).where(
                ContributionEvent.user_id == test_user.id,
                ContributionEvent.event_type == "observe_attribute",
            )
        )
    ).scalar_one()
    assert ev.target_type == "attribute_observation"
    assert ev.target_id is not None
    assert ev.event_metadata == {"attribute_type_id": BOTTLE_FILLER}

    points_after_first = (
        await session.execute(
            select(UserContributionStats.total_points).where(
                UserContributionStats.user_id == test_user.id
            )
        )
    ).scalar_one()
    # Re-observe the same attribute -> idempotent, no new attribute points.
    await _observe(client, fid, BOTTLE_FILLER, "no")
    points_after_second = (
        await session.execute(
            select(UserContributionStats.total_points).where(
                UserContributionStats.user_id == test_user.id
            )
        )
    ).scalar_one()
    assert points_after_second == points_after_first
