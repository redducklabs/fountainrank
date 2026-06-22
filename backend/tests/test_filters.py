import pytest

from app.config import Settings, get_settings
from app.geo import point_geography
from app.main import app
from app.models import Fountain, FountainAttributeConsensus

BBOX = "min_lat=0&min_lng=0&max_lat=1&max_lng=1"
BOTTLE_FILLER = 1
INDOOR_OUTDOOR = 9
ACCESS_KIND = 8


async def _mk(session, lat, lng, **kw):
    f = Fountain(
        location=point_geography(lat, lng), created_source="osm", added_by_user_id=None, **kw
    )
    session.add(f)
    await session.flush()
    return f


async def _consensus(session, fid, attr_id, value, confidence="low"):
    session.add(
        FountainAttributeConsensus(
            fountain_id=fid,
            attribute_type_id=attr_id,
            consensus_value=value,
            confidence=confidence,
            observation_count=1,
        )
    )
    await session.flush()


async def _bbox_ids(client, query=""):
    r = await client.get(f"/api/v1/fountains/bbox?{BBOX}&{query}")
    assert r.status_code == 200, r.text
    return {p["id"] for p in r.json()}


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


@pytest.mark.asyncio
async def test_boolean_attribute_filter_default_and_include_unknown(client, session):
    f_yes = await _mk(session, 0.1, 0.1)
    f_no = await _mk(session, 0.2, 0.2)
    f_none = await _mk(session, 0.3, 0.3)
    f_tie = await _mk(session, 0.4, 0.4)  # mixed -> consensus_value NULL
    await _consensus(session, f_yes.id, BOTTLE_FILLER, "yes")
    await _consensus(session, f_no.id, BOTTLE_FILLER, "no")
    await _consensus(session, f_tie.id, BOTTLE_FILLER, None, confidence="mixed")
    await session.commit()

    default = await _bbox_ids(client, "bottle_filler=true")
    assert default == {str(f_yes.id)}  # only definite yes; no/tie/none excluded

    widened = await _bbox_ids(client, "bottle_filler=true&include_unknown=true")
    assert widened == {str(f_yes.id), str(f_none.id), str(f_tie.id)}  # excludes definite no


@pytest.mark.asyncio
async def test_enum_filters(client, session):
    f_indoor = await _mk(session, 0.1, 0.1)
    f_outdoor = await _mk(session, 0.2, 0.2)
    f_public = await _mk(session, 0.3, 0.3)
    f_restricted = await _mk(session, 0.4, 0.4)
    await _consensus(session, f_indoor.id, INDOOR_OUTDOOR, "indoor")
    await _consensus(session, f_outdoor.id, INDOOR_OUTDOOR, "outdoor")
    await _consensus(session, f_public.id, ACCESS_KIND, "public")
    await _consensus(session, f_restricted.id, ACCESS_KIND, "restricted")
    await session.commit()

    assert await _bbox_ids(client, "indoor=true") == {str(f_indoor.id)}
    assert await _bbox_ids(client, "public_access=true") == {str(f_public.id)}


@pytest.mark.asyncio
async def test_working_now(client, session):
    f_ok = await _mk(session, 0.1, 0.1, current_status="ok")
    f_not = await _mk(session, 0.2, 0.2, current_status="not_working")
    f_reported = await _mk(session, 0.3, 0.3, current_status="reported_issue")
    f_baseline_ok = await _mk(session, 0.4, 0.4, current_status=None, is_working=True)
    f_baseline_broken = await _mk(session, 0.5, 0.5, current_status=None, is_working=False)
    await session.commit()

    ids = await _bbox_ids(client, "working_now=true")
    assert ids == {str(f_ok.id), str(f_baseline_ok.id)}
    assert str(f_not.id) not in ids and str(f_reported.id) not in ids
    assert str(f_baseline_broken.id) not in ids


@pytest.mark.asyncio
async def test_min_rating_and_count(client, session):
    f_hi = await _mk(session, 0.1, 0.1, average_rating=4.5, rating_count=10)
    f_lo = await _mk(session, 0.2, 0.2, average_rating=2.0, rating_count=10)
    f_unrated = await _mk(session, 0.3, 0.3, average_rating=None, rating_count=0)
    await session.commit()

    res = await _bbox_ids(client, "min_rating=4.0")
    assert res == {str(f_hi.id)}
    assert str(f_unrated.id) not in res  # NULL average_rating excluded
    assert await _bbox_ids(client, "min_rating_count=5") == {str(f_hi.id), str(f_lo.id)}


@pytest.mark.asyncio
async def test_min_rating_out_of_range_422(client):
    for bad in (0, 6, -1):
        r = await client.get(f"/api/v1/fountains/bbox?{BBOX}&min_rating={bad}")
        assert r.status_code == 422
    r = await client.get("/api/v1/fountains?lat=0&lng=0&min_rating=9")
    assert r.status_code == 422
    r = await client.get(f"/api/v1/fountains/bbox?{BBOX}&verified_within_days=0")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_filter_applied_before_limit(client, session, settings_override):
    # 3 NON-matching fountains NEARER the origin + 2 matching FARTHER. With cap=3 applied
    # AFTER filtering -> 2 returned. A cap-before-filter bug would pick the 3 nearest
    # (non-matching) and return 0.
    settings_override(max_results=3, nearby_max_radius_m=50_000.0, nearby_default_radius_m=1000.0)
    for i in range(3):
        await _mk(session, 0.001 * (i + 1), 0.001, current_status="not_working")  # near, non-match
    matches = [await _mk(session, 0.1, 0.1, current_status="ok") for _ in range(2)]  # ~15 km, match
    await session.commit()

    r = await client.get("/api/v1/fountains?lat=0&lng=0&radius_m=40000&working_now=true")
    assert r.status_code == 200
    ids = {p["id"] for p in r.json()}
    assert ids == {str(m.id) for m in matches}


@pytest.mark.asyncio
async def test_bbox_filter_applied_before_limit(client, session, settings_override):
    # bbox has no ORDER BY, so make matching rows a small minority among many non-matching
    # ones with the cap == count of matches. Correct (filter-then-cap) returns exactly the
    # matches; a cap-before-filter impl would LIMIT to non-matching rows (scan/insert order)
    # and return none of the matches.
    settings_override(max_results=2)
    for i in range(8):
        await _mk(session, 0.01 * (i + 1), 0.01, current_status="not_working")  # non-matching
    matches = [await _mk(session, 0.9, 0.9, current_status="ok") for _ in range(2)]
    await session.commit()
    ids = await _bbox_ids(client, "working_now=true")
    assert ids == {str(m.id) for m in matches}


@pytest.mark.asyncio
async def test_nearby_honors_filters(client, session):
    f_match = await _mk(session, 0.001, 0.001, current_status="ok")
    await _mk(session, 0.002, 0.002, current_status="not_working")
    await session.commit()
    r = await client.get("/api/v1/fountains?lat=0&lng=0&radius_m=5000&working_now=true")
    assert {p["id"] for p in r.json()} == {str(f_match.id)}
