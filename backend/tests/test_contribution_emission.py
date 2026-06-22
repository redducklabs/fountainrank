"""Contribution events are emitted (idempotently) from the add + rate endpoints."""

import pytest
from sqlalchemy import func, select

from app.auth import get_current_user
from app.geo import point_geography
from app.main import app
from app.models import ContributionEvent, Fountain, User, UserContributionStats

# An empty area, a far-away (own empty) area, and a point ~50 m from C1.
C1 = {"latitude": 37.7749, "longitude": -122.4194}
C2 = {"latitude": 34.0522, "longitude": -118.2437}  # far from C1 (LA): its own empty area
C1_NEAR = {"latitude": 37.77535, "longitude": -122.4194}  # ~50 m from C1: same area, not a dup


async def _points(session, user_id) -> int:
    return (
        await session.execute(
            select(UserContributionStats.total_points).where(
                UserContributionStats.user_id == user_id
            )
        )
    ).scalar_one_or_none() or 0


async def _event_types(session, user_id) -> list[str]:
    return list(
        (
            await session.execute(
                select(ContributionEvent.event_type).where(ContributionEvent.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_add_bonus_dedup_sequence(client, test_user, session):
    # 1) First add in an empty cell: add(10) + first_fountain(5) + first_in_area(15) = 30.
    r1 = await client.post("/api/v1/fountains", json={"location": C1, "is_working": True})
    assert r1.status_code == 201
    assert await _points(session, test_user.id) == 30

    # 2) Same user, different cell: add(10) + first_in_area(15), no second first_fountain. -> 55
    r2 = await client.post("/api/v1/fountains", json={"location": C2, "is_working": True})
    assert r2.status_code == 201
    assert await _points(session, test_user.id) == 55

    # 3) Same user, ~50 m from #1 (within first_in_area radius, not a dup): add(10) only;
    #    the area is already mapped by F1 so no first_in_area. -> 65
    r3 = await client.post("/api/v1/fountains", json={"location": C1_NEAR, "is_working": True})
    assert r3.status_code == 201
    assert await _points(session, test_user.id) == 65

    types = await _event_types(session, test_user.id)
    assert types.count("add_fountain") == 3
    assert types.count("first_fountain_bonus") == 1
    assert types.count("first_in_area_bonus") == 2


@pytest.mark.asyncio
async def test_add_fountain_event_target_linkage(client, test_user, session):
    r = await client.post("/api/v1/fountains", json={"location": C1, "is_working": True})
    fid = r.json()["id"]
    ev = (
        await session.execute(
            select(ContributionEvent).where(
                ContributionEvent.user_id == test_user.id,
                ContributionEvent.event_type == "add_fountain",
            )
        )
    ).scalar_one()
    assert ev.target_type == "fountain"
    assert str(ev.target_id) == fid


@pytest.mark.asyncio
async def test_submit_ratings_emits_and_dedups(client, test_user, session):
    fid = (await client.post("/api/v1/fountains", json={"location": C2})).json()["id"]
    base = await _points(session, test_user.id)  # points from the add; assertions use deltas

    # Rate 2 dimensions on a fresh fountain (no prior ratings): 2*rate(4) + first_rating(5) = +9.
    r = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 4}, {"rating_type_id": 2, "stars": 5}]},
    )
    assert r.status_code == 200
    assert await _points(session, test_user.id) == base + 9

    # Re-submit the same two dimensions: idempotent, no new points.
    await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 3}, {"rating_type_id": 2, "stars": 2}]},
    )
    assert await _points(session, test_user.id) == base + 9

    # A new dimension: +2 (rate), no second first_rating.
    await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 3, "stars": 4}]},
    )
    assert await _points(session, test_user.id) == base + 11

    # rate events carry target linkage to ratings rows.
    rate_events = (
        (
            await session.execute(
                select(ContributionEvent).where(
                    ContributionEvent.user_id == test_user.id,
                    ContributionEvent.event_type == "rate",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rate_events) == 3
    assert all(e.target_type == "rating" and e.target_id is not None for e in rate_events)


@pytest.mark.asyncio
async def test_rating_imported_fountain_no_orphan_events(client, test_user, session):
    # An OSM-imported fountain (no human owner) inserted directly.
    f = Fountain(
        location=point_geography(40.0, -120.0),
        is_working=True,
        created_source="osm",
        added_by_user_id=None,
    )
    session.add(f)
    await session.commit()

    r = await client.post(
        f"/api/v1/fountains/{f.id}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    assert r.status_code == 200
    # Rater earns events; the OSM row awarded nobody (no add_fountain event for it).
    types = await _event_types(session, test_user.id)
    assert "rate" in types and "first_rating_bonus" in types
    assert "add_fountain" not in types
    null_user = (
        await session.execute(
            select(func.count())
            .select_from(ContributionEvent)
            .where(ContributionEvent.user_id.is_(None))
        )
    ).scalar_one()
    assert null_user == 0


@pytest.mark.asyncio
async def test_no_first_in_area_when_imported_fountain_nearby(client, test_user, session):
    # An imported (non-user) fountain already maps this area — even though it has no
    # contribution event, the spatial precheck must see it.
    imported = Fountain(
        location=point_geography(37.7749, -122.4194),
        is_working=True,
        created_source="osm",
        added_by_user_id=None,
    )
    session.add(imported)
    await session.commit()

    # User adds a NEW fountain ~50 m away (within first_in_area radius, > duplicate threshold).
    r = await client.post("/api/v1/fountains", json={"location": C1_NEAR})
    assert r.status_code == 201
    types = await _event_types(session, test_user.id)
    assert "add_fountain" in types
    assert "first_in_area_bonus" not in types  # area already mapped by the import
    assert await _points(session, test_user.id) == 15  # add(10) + first_fountain(5), no +15


@pytest.mark.asyncio
async def test_first_fountain_bonus_is_per_user(client, test_user, session):
    # test_user's first add -> includes first_fountain_bonus.
    await client.post("/api/v1/fountains", json={"location": C1})
    assert "first_fountain_bonus" in await _event_types(session, test_user.id)

    # A second user's first add also gets their own first_fountain_bonus.
    u2 = User(logto_user_id="emit-u2", email="u2@example.com", display_name="U2")
    session.add(u2)
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: u2
    try:
        await client.post("/api/v1/fountains", json={"location": C2})
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    assert await _points(session, u2.id) == 30
    assert "first_fountain_bonus" in await _event_types(session, u2.id)
