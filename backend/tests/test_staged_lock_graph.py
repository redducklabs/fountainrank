"""Staged lock-graph + reconciliation-invariant concurrency tests (spec 2026-07-17 Verification
2c/2d/2e). Two-session harness pattern from ``test_osm_merge.py``: a gate transaction holds the
contended lock so the overlap is deterministic.

The duplicate-serialization test is the **#241 cross-spec gate** — the mobile add-flow-resilience
PR must not merge before it is on ``main`` and green, because the mobile timeout-reconciliation
relies on two identical-coordinate creates deterministically resolving to one insert + one typed
409.
"""

from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings, get_settings
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.main import app
from app.membership import RefreshScope, compute_boundary_derivation
from app.models import Fountain

_FAST_TIMEOUT_MS = 750


@pytest.fixture
def _fast_timeout_settings():
    app.dependency_overrides[get_settings] = lambda: Settings(add_lock_timeout_ms=_FAST_TIMEOUT_MS)
    yield
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def fast_client(_fast_timeout_settings, test_user):
    from app.auth import get_current_user

    app.dependency_overrides[get_current_user] = lambda: test_user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_current_user, None)


def _sq(x0: float, y0: float, x1: float, y1: float) -> str:
    return f"POLYGON(({x0} {y0}, {x1} {y0}, {x1} {y1}, {x0} {y1}, {x0} {y0}))"


async def _seed_boundaries(s) -> None:
    for oid, subtype, slug, wkt in (
        ("us", "country", "united-states", _sq(0, 0, 10, 10)),
        ("us-city", "locality", "san-diego", _sq(1, 1, 2, 2)),
    ):
        await s.execute(
            text(
                """
                INSERT INTO place_boundaries
                    (id, overture_id, subtype, class, name, country_code, slug,
                     is_canonical, fountain_count, boundary, created_at, updated_at)
                VALUES (gen_random_uuid(), :oid, :subtype, 'land', :oid, 'us', :slug,
                        false, 0, ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
                """
            ),
            {"oid": oid, "subtype": subtype, "slug": slug, "wkt": wkt},
        )


async def _advisory_lock_waiters(maker, key: int) -> int:
    async with maker() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM pg_locks WHERE locktype='advisory' "
                    "AND classid=:c AND objid=:o AND objsubid=1 AND NOT granted"
                ),
                {"c": (key >> 32) & 0xFFFFFFFF, "o": key & 0xFFFFFFFF},
            )
        ).scalar_one()


# --- 2c: a compute stage takes NO live-table write locks, so an add proceeds unaffected ---------


@pytest.mark.asyncio
async def test_compute_concurrent_with_add_does_not_block_it(client, engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as seed:
        await _seed_boundaries(seed)
        await seed.commit()

    # Hold a compute-stage transaction OPEN (it writes only temp staging + reads place_boundaries).
    async with maker() as compute_session:
        await compute_boundary_derivation(compute_session, RefreshScope(rebuild_cells=True))
        # NOT committed — the compute transaction is still open, holding only AccessShare on
        # place_boundaries and its connection-local temp tables.
        resp = await client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.5, "longitude": 1.5}, "is_working": True},
        )
        assert resp.status_code == 201  # the add is not blocked by the open compute transaction
        await compute_session.rollback()

    async with maker() as s:
        count = (await s.execute(select(func.count()).select_from(Fountain))).scalar_one()
    assert count == 1


# --- 2d: publish holds advisory + cells replacement; a waiting add 503s at the bound, no 40P01 --


@pytest.mark.asyncio
async def test_add_503s_while_publish_holds_advisory_and_cells(fast_client, engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as seed:
        await _seed_boundaries(seed)
        await seed.commit()

    # A "publish" gate: advisory lock FIRST, then the cells replacement (TRUNCATE takes ACCESS
    # EXCLUSIVE on place_boundary_cells) — the exact live lock order publish uses.
    async with maker() as publish_gate:
        await publish_gate.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
        await publish_gate.execute(text("TRUNCATE place_boundary_cells"))

        resp = await fast_client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.5, "longitude": 1.5}, "is_working": True},
        )
        # The add blocks acquiring the advisory lock inside its bounded context → 503, never a
        # 40P01 deadlock (publish took advisory before cells, the same order as adds).
        assert resp.status_code == 503
        assert resp.json() == {"detail": "busy"}
        assert resp.headers.get("retry-after") == "30"

        # The publish gate was never deadlock-aborted — it can still run a statement and commit.
        assert (await publish_gate.execute(text("SELECT 1"))).scalar_one() == 1
        await publish_gate.commit()

    async with maker() as s:
        count = (await s.execute(select(func.count()).select_from(Fountain))).scalar_one()
    assert count == 0  # the timed-out add persisted nothing


# --- v1 inversion recreation, retained as a timeout/error-mapping regression --------------------


@pytest.mark.asyncio
async def test_v1_inversion_open_boundary_row_lock_maps_to_503_not_deadlock(fast_client, engine):
    """The v1 (rejected) design deadlocked when an add holding the advisory lock blocked on a
    boundary row a refresh held while the refresh blocked on the advisory lock. The bounded
    lock_timeout maps that inversion to a fast 503 instead — no 40P01 on either side."""
    from app.membership import refresh_all_memberships

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as seed:
        await _seed_boundaries(seed)
        await refresh_all_memberships(seed)  # build cells so the add assigns to (and recounts) city
        city_id = (
            await seed.execute(
                text("SELECT id FROM place_boundaries WHERE overture_id = 'us-city'")
            )
        ).scalar_one()
        await seed.commit()

    # An unrelated open transaction holds a boundary ROW lock the add's membership recompute needs.
    async with maker() as row_lock_gate:
        await row_lock_gate.execute(
            text("SELECT id FROM place_boundaries WHERE id = :id FOR UPDATE"), {"id": city_id}
        )
        resp = await fast_client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.5, "longitude": 1.5}, "is_working": True},
        )
        assert resp.status_code == 503  # bounded on the row lock after acquiring the advisory lock
        assert (await row_lock_gate.execute(text("SELECT 1"))).scalar_one() == 1  # not aborted
        await row_lock_gate.rollback()


# --- 2e: the #241 reconciliation invariant — two identical creates serialize to one 201 + one 409


@pytest.mark.asyncio
async def test_two_concurrent_identical_creates_serialize_to_one_409(client, engine, test_user):
    """#241 cross-spec gate: two concurrent identical-coordinate creates serialize on the advisory
    lock across the duplicate probe + insert — one commits (201), the other deterministically
    receives the typed duplicate 409. This is the invariant the mobile timeout-reconciliation
    design relies on; it must be on main and green before the #241 PR merges."""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    results: dict[str, int] = {}

    async def do_add(key: str) -> None:
        r = await client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 37.77, "longitude": -122.41}, "is_working": True},
        )
        results[key] = r.status_code

    # A gate holds the advisory lock so BOTH adds queue behind it (deterministic overlap), then
    # release → they run serialized.
    async with maker() as gate:
        await gate.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
        t1 = asyncio.create_task(do_add("a"))
        t2 = asyncio.create_task(do_add("b"))
        for _ in range(200):
            if await _advisory_lock_waiters(maker, ADD_FOUNTAIN_LOCK_KEY) >= 2:
                break
            await asyncio.sleep(0.05)
        else:
            raise AssertionError("both adds did not block on the advisory lock in time")
        await gate.commit()
    await asyncio.gather(t1, t2)

    assert sorted(results.values()) == [201, 409]  # one insert, one typed duplicate
    async with maker() as s:
        count = (await s.execute(select(func.count()).select_from(Fountain))).scalar_one()
    assert count == 1  # serialized: exactly one fountain, no near-duplicate
    assert test_user is not None
