"""Slice 1e — place_scope_config.city_routes_ready column + seed (migration 0017)."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.models import PlaceScopeConfig


@pytest.mark.asyncio
async def test_us_and_lu_seeded_city_routes_ready(session):
    """Migration 0017 adds the column and marks the already-live scopes ready."""
    rows = (
        await session.execute(
            text(
                "SELECT country_code, city_routes_ready FROM place_scope_config "
                "WHERE country_code IN ('us', 'lu') ORDER BY country_code"
            )
        )
    ).all()
    assert {(r.country_code, r.city_routes_ready) for r in rows} == {("lu", True), ("us", True)}


@pytest.mark.asyncio
async def test_model_roundtrip_defaults_false(session):
    """A new row with no explicit flag defaults to NOT ready (server_default false)."""
    session.add(PlaceScopeConfig(country_code="zz", eligible_city_subtypes=["locality"]))
    await session.commit()
    row = await session.get(PlaceScopeConfig, "zz")
    assert row is not None
    assert row.city_routes_ready is False
