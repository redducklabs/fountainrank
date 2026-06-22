import pytest
from sqlalchemy import func, select

from app.auth import get_current_user
from app.main import app
from app.models import AttributeType, ContributionEvent, Fountain, User

ACCESS_KIND = 8  # seeded enum attribute_type
LOC = {"latitude": 9.0, "longitude": 9.0}


async def _add_fountain(client, **extra) -> str:
    r = await client.post("/api/v1/fountains", json={"location": LOC, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _observe(client, fid, attribute_type_id, value):
    return await client.post(
        f"/api/v1/fountains/{fid}/attributes",
        json={"observations": [{"attribute_type_id": attribute_type_id, "value": value}]},
    )


def _attr(detail, key):
    return next((a for a in detail["attributes"] if a["key"] == key), None)


@pytest.mark.asyncio
async def test_access_types_seeded(client, session):
    n = (await session.execute(select(func.count()).select_from(AttributeType))).scalar_one()
    assert n >= 13
    types = (await client.get("/api/v1/attribute-types")).json()
    by_key = {t["key"]: t for t in types}
    assert by_key["access_kind"]["allowed_values"] == ["public", "customer_only", "restricted"]
    assert by_key["access_kind"]["category"] == "access"
    assert by_key["hours_dependent"]["allowed_values"] is None


@pytest.mark.asyncio
async def test_enum_consensus_plurality(client, test_user, session):
    fid = await _add_fountain(client)
    await _observe(client, fid, ACCESS_KIND, "public")
    u2 = User(logto_user_id="acc-u2", email="acc2@example.com", display_name="A2")
    u3 = User(logto_user_id="acc-u3", email="acc3@example.com", display_name="A3")
    session.add_all([u2, u3])
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: u2
    try:
        await _observe(client, fid, ACCESS_KIND, "public")
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    detail = (await client.get(f"/api/v1/fountains/{fid}")).json()
    ak = _attr(detail, "access_kind")
    assert ak["consensus_value"] == "public"
    assert ak["value_counts"] == {"public": 2}

    app.dependency_overrides[get_current_user] = lambda: u3
    try:
        await _observe(client, fid, ACCESS_KIND, "customer_only")
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    ak2 = _attr((await client.get(f"/api/v1/fountains/{fid}")).json(), "access_kind")
    assert ak2["consensus_value"] == "public"  # plurality holds


@pytest.mark.asyncio
async def test_enum_tie_is_mixed(client, test_user, session):
    fid = await _add_fountain(client)
    await _observe(client, fid, ACCESS_KIND, "public")
    u2 = User(logto_user_id="acc-tie", email="tie@example.com", display_name="T")
    session.add(u2)
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: u2
    try:
        await _observe(client, fid, ACCESS_KIND, "restricted")
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    ak = _attr((await client.get(f"/api/v1/fountains/{fid}")).json(), "access_kind")
    assert ak["consensus_value"] is None and ak["confidence"] == "mixed"


@pytest.mark.asyncio
async def test_illegal_enum_value_422(client):
    fid = await _add_fountain(client)
    assert (await _observe(client, fid, ACCESS_KIND, "spaceship")).status_code == 422


@pytest.mark.asyncio
async def test_enum_unknown_does_not_decide(client):
    fid = await _add_fountain(client)
    assert (await _observe(client, fid, ACCESS_KIND, "unknown")).status_code == 200
    ak = _attr((await client.get(f"/api/v1/fountains/{fid}")).json(), "access_kind")
    assert ak["consensus_value"] is None and ak["unknown_count"] == 1


@pytest.mark.asyncio
async def test_add_time_capture(client, test_user, session):
    fid = await _add_fountain(
        client,
        placement_note="  near the north restrooms  ",
        observations=[
            {"attribute_type_id": ACCESS_KIND, "value": "public"},
            {"attribute_type_id": 1, "value": "yes"},  # bottle_filler
        ],
    )
    detail = (await client.get(f"/api/v1/fountains/{fid}")).json()
    assert detail["placement_note"] == "near the north restrooms"  # trimmed
    assert _attr(detail, "access_kind")["consensus_value"] == "public"
    assert _attr(detail, "bottle_filler")["consensus_value"] == "yes"
    n_obs_events = (
        await session.execute(
            select(func.count())
            .select_from(ContributionEvent)
            .where(
                ContributionEvent.user_id == test_user.id,
                ContributionEvent.event_type == "observe_attribute",
            )
        )
    ).scalar_one()
    assert n_obs_events == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [123, True, [], {}])
async def test_placement_note_non_string_is_422_not_500(client, bad):
    r = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": 12.0, "longitude": 12.0}, "placement_note": bad},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_placement_note_too_long_is_422(client):
    r = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": 12.5, "longitude": 12.5}, "placement_note": "x" * 201},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_add_time_illegal_observation_rolls_back(client, session):
    r = await client.post(
        "/api/v1/fountains",
        json={
            "location": {"latitude": 11.0, "longitude": 11.0},
            "observations": [{"attribute_type_id": ACCESS_KIND, "value": "spaceship"}],
        },
    )
    assert r.status_code == 422
    count = (await session.execute(select(func.count()).select_from(Fountain))).scalar_one()
    assert count == 0  # the whole add rolled back; no fountain created
