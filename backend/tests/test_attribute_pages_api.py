"""Slice 4 — public crawlable attribute pages: ``GET /api/v1/fountains/by-attribute`` (#127, §4.5).

Integration tests against the local PostGIS container (the CI mirror). Fountains are seeded with a
denormalized ``fountain_attribute_consensus`` row directly (the endpoint reads consensus, exactly
like the discovery filters — it never recomputes). Only the two SEO attribute keys are exposed:
``bottle_filler`` (attribute_type id 1) and ``wheelchair_reachable`` (id 4), seeded by migration
0006. ``K_attr`` (the thin-content gate) is pinned via a settings override so assertions don't
depend on the default.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.config import Settings, get_settings
from app.main import app

_K_ATTR = 3
_BOTTLE_FILLER = 1
_WHEELCHAIR_REACHABLE = 4


@pytest.fixture
def _seo_settings():
    app.dependency_overrides[get_settings] = lambda: Settings(seo_attribute_min_fountains=_K_ATTR)
    yield
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def api(_seo_settings) -> AsyncClient:
    # A plain, UNAUTHENTICATED client: the endpoint is public.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _add_fountain_with_attr(
    session,
    *,
    attr_id: int = _BOTTLE_FILLER,
    value: str | None = "yes",
    confidence: str = "high",
    ranking_score=None,
    rating_count=0,
    average_rating=None,
    is_working: bool = True,
    hidden: bool = False,
):
    """Insert a fountain plus its (attribute) consensus row. ``value=None`` seeds a fountain that
    has a consensus row but no definite value (tie/mixed) so it must NOT match a positive filter."""
    row = (
        await session.execute(
            text(
                """
                INSERT INTO fountains
                    (id, location, is_hidden, is_working, created_source,
                     ranking_score, rating_count, average_rating)
                VALUES (gen_random_uuid(), ST_SetSRID(ST_MakePoint(1.5, 1.5), 4326)::geography,
                        :hidden, :working, 'admin_import', :score, :rc, :avg)
                RETURNING id
                """
            ),
            {
                "hidden": hidden,
                "working": is_working,
                "score": ranking_score,
                "rc": rating_count,
                "avg": average_rating,
            },
        )
    ).one()
    await session.execute(
        text(
            """
            INSERT INTO fountain_attribute_consensus
                (fountain_id, attribute_type_id, consensus_value, confidence)
            VALUES (:fid, :aid, :val, :conf)
            """
        ),
        {"fid": row.id, "aid": attr_id, "val": value, "conf": confidence},
    )
    return row.id


@pytest.mark.asyncio
async def test_by_attribute_ranked_best_first_with_shape(session, api):
    """bottle_filler fountains come back best-rated first (ranking_score desc, unrated last, then
    rating_count, then id); the body carries the attribute key, total_count, and indexable."""
    top = await _add_fountain_with_attr(
        session, ranking_score=0.9, rating_count=10, average_rating=4.6
    )
    mid = await _add_fountain_with_attr(
        session, ranking_score=0.5, rating_count=8, average_rating=3.2
    )
    low = await _add_fountain_with_attr(
        session, ranking_score=0.5, rating_count=2, average_rating=3.2
    )
    unrated = await _add_fountain_with_attr(session, ranking_score=None, rating_count=0)
    await session.commit()

    resp = await api.get("/api/v1/fountains/by-attribute", params={"attribute": "bottle_filler"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["attribute"] == "bottle_filler"
    assert body["total_count"] == 4
    assert body["indexable"] is True  # 4 >= K_attr (3)
    ids = [f["id"] for f in body["fountains"]]
    assert ids == [str(top), str(mid), str(low), str(unrated)]
    assert body["fountains"][0]["average_rating"] == 4.6


@pytest.mark.asyncio
async def test_by_attribute_wheelchair_reachable(session, api):
    """The second SEO key resolves to its own attribute (id 4) and does not leak bottle_filler."""
    wheel = await _add_fountain_with_attr(
        session, attr_id=_WHEELCHAIR_REACHABLE, ranking_score=0.9, rating_count=5
    )
    # A bottle_filler fountain must NOT appear in the wheelchair page.
    await _add_fountain_with_attr(
        session, attr_id=_BOTTLE_FILLER, ranking_score=0.8, rating_count=5
    )
    await session.commit()

    body = (
        await api.get(
            "/api/v1/fountains/by-attribute", params={"attribute": "wheelchair_reachable"}
        )
    ).json()
    assert body["attribute"] == "wheelchair_reachable"
    assert [f["id"] for f in body["fountains"]] == [str(wheel)]
    assert body["total_count"] == 1


@pytest.mark.asyncio
async def test_by_attribute_excludes_hidden(session, api):
    """Hidden fountains never appear in the public list, and never count toward total_count."""
    await _add_fountain_with_attr(session, ranking_score=0.9, rating_count=5)
    await _add_fountain_with_attr(session, ranking_score=0.8, rating_count=5, hidden=True)
    await session.commit()

    body = (
        await api.get("/api/v1/fountains/by-attribute", params={"attribute": "bottle_filler"})
    ).json()
    assert len(body["fountains"]) == 1
    assert body["total_count"] == 1


@pytest.mark.asyncio
async def test_by_attribute_excludes_non_matching_values(session, api):
    """Only a definite ``yes`` matches: a ``no`` and a tie/mixed (consensus_value NULL) are excluded
    — the SEO page never widens to "unknown"."""
    match = await _add_fountain_with_attr(session, value="yes", ranking_score=0.9, rating_count=5)
    await _add_fountain_with_attr(session, value="no", confidence="high", ranking_score=0.8)
    await _add_fountain_with_attr(session, value=None, confidence="mixed", ranking_score=0.7)
    await session.commit()

    body = (
        await api.get("/api/v1/fountains/by-attribute", params={"attribute": "bottle_filler"})
    ).json()
    assert [f["id"] for f in body["fountains"]] == [str(match)]
    assert body["total_count"] == 1


@pytest.mark.asyncio
async def test_by_attribute_below_gate_still_serves_but_not_indexable(session, api):
    """Below K_attr the page still serves its fountains (200) but indexable=false — the web renders
    it with noindex (spec §4.5), rather than 404ing a real-but-thin page."""
    for _ in range(2):  # < K_attr (3)
        await _add_fountain_with_attr(session, ranking_score=0.5, rating_count=1)
    await session.commit()

    resp = await api.get("/api/v1/fountains/by-attribute", params={"attribute": "bottle_filler"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_count"] == 2
    assert body["indexable"] is False
    assert len(body["fountains"]) == 2


@pytest.mark.asyncio
async def test_by_attribute_zero_matches_serves_empty_not_indexable(session, api):
    """No matching fountains -> 200 with an empty list, total_count 0, indexable false (not a 404).
    A crawlable page with no data yet is legitimately thin, not missing."""
    resp = await api.get("/api/v1/fountains/by-attribute", params={"attribute": "bottle_filler"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["fountains"] == []
    assert body["total_count"] == 0
    assert body["indexable"] is False


@pytest.mark.asyncio
async def test_by_attribute_pagination(session, api):
    """limit caps the page; offset walks it, stable under the rank order. total_count is the FULL
    match count, independent of the page window."""
    a = await _add_fountain_with_attr(session, ranking_score=0.9, rating_count=9)
    b = await _add_fountain_with_attr(session, ranking_score=0.8, rating_count=8)
    c = await _add_fountain_with_attr(session, ranking_score=0.7, rating_count=7)
    await session.commit()

    page1 = (
        await api.get(
            "/api/v1/fountains/by-attribute", params={"attribute": "bottle_filler", "limit": 2}
        )
    ).json()
    assert [f["id"] for f in page1["fountains"]] == [str(a), str(b)]
    assert page1["total_count"] == 3  # full total, not the page size
    page2 = (
        await api.get(
            "/api/v1/fountains/by-attribute",
            params={"attribute": "bottle_filler", "limit": 2, "offset": 2},
        )
    ).json()
    assert [f["id"] for f in page2["fountains"]] == [str(c)]


@pytest.mark.asyncio
async def test_by_attribute_rejects_unknown_and_non_seo_attributes(api):
    """Only the two whitelisted SEO keys are valid: an unknown key AND a real-but-non-SEO attribute
    (e.g. dual_height, which exists in ATTRIBUTE_FILTERS but has no crawlable page) both 422 — the
    Literal param never exposes attributes we didn't intend to publish."""
    assert (
        await api.get("/api/v1/fountains/by-attribute", params={"attribute": "nope"})
    ).status_code == 422
    assert (
        await api.get("/api/v1/fountains/by-attribute", params={"attribute": "dual_height"})
    ).status_code == 422
    # Omitting the required param is also a 422 (no silent default).
    assert (await api.get("/api/v1/fountains/by-attribute")).status_code == 422


@pytest.mark.asyncio
async def test_by_attribute_limit_bounds_are_enforced(api):
    """limit is a hard cap in the contract: <1 or >500 is a 422; offset must be >= 0."""
    base = {"attribute": "bottle_filler"}
    assert (
        await api.get("/api/v1/fountains/by-attribute", params={**base, "limit": 0})
    ).status_code == 422
    assert (
        await api.get("/api/v1/fountains/by-attribute", params={**base, "limit": 501})
    ).status_code == 422
    assert (
        await api.get("/api/v1/fountains/by-attribute", params={**base, "offset": -1})
    ).status_code == 422


@pytest.mark.asyncio
async def test_by_attribute_public_and_cacheable(session, api):
    """The endpoint is public (no auth) and sends a shared, cacheable Cache-Control."""
    await _add_fountain_with_attr(session, ranking_score=0.9, rating_count=3)
    await session.commit()

    resp = await api.get("/api/v1/fountains/by-attribute", params={"attribute": "bottle_filler"})
    assert resp.status_code == 200  # no Authorization header required
    cache = resp.headers.get("cache-control", "")
    assert "public" in cache and "max-age=" in cache and "s-maxage=" in cache
