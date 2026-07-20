"""GET /api/v1/stats — public site-wide counts for the homepage positioning copy."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.main import app

_UNIT_SQUARE = "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))"


@pytest.fixture
async def api() -> AsyncClient:
    # Public, UNAUTHENTICATED client — the stats endpoint is public.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _add_fountain(session, *, hidden: bool = False):
    await session.execute(
        text(
            """
            INSERT INTO fountains (id, location, is_hidden, created_source)
            VALUES (gen_random_uuid(),
                    ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, :hidden, 'admin_import')
            """
        ),
        {"hidden": hidden},
    )


async def _add_country(session, *, oid: str, cc: str, name: str, fountain_count: int):
    await session.execute(
        text(
            """
            INSERT INTO place_boundaries
                (id, overture_id, subtype, class, place_kind, name, country_code, slug,
                 is_canonical, fountain_count, boundary, created_at, updated_at)
            VALUES (gen_random_uuid(), :oid, 'country', 'land', 'country', :name, :cc, :slug,
                    false, :fc, ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
            """
        ),
        {
            "oid": oid,
            "cc": cc,
            "name": name,
            "slug": name.lower(),
            "fc": fountain_count,
            "wkt": _UNIT_SQUARE,
        },
    )


@pytest.mark.asyncio
async def test_site_stats_counts_nonhidden_fountains_and_countries_with_fountains(session, api):
    """total_fountains counts only non-hidden fountains; total_countries counts country places with
    fountain_count > 0. Hidden fountains and zero-fountain countries are excluded."""
    for _ in range(4):
        await _add_fountain(session, hidden=False)
    await _add_fountain(session, hidden=True)  # excluded from total_fountains
    await _add_country(session, oid="us", cc="us", name="United States", fountain_count=4)
    await _add_country(session, oid="lu", cc="lu", name="Luxembourg", fountain_count=1)
    await _add_country(session, oid="mc", cc="mc", name="Monaco", fountain_count=0)  # excluded
    await session.commit()

    resp = await api.get("/api/v1/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_fountains"] == 4
    assert body["total_countries"] == 2
    assert resp.headers["cache-control"].startswith("public")


@pytest.mark.asyncio
async def test_site_stats_zero_state(session, api):
    """An empty dataset returns zeros, not an error — the homepage copy degrades gracefully."""
    resp = await api.get("/api/v1/stats")
    assert resp.status_code == 200
    assert resp.json() == {"total_fountains": 0, "total_countries": 0}
