import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.geo import latitude_of, point_geography
from app.imports.merge import (
    RunScope,
    RunSummary,
    _mark_scope_removals,
    merge_candidates,
    rollback_run,
)
from app.imports.osm import OsmCandidate
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.models import (
    Fountain,
    FountainImportEvent,
    FountainProvenance,
    OsmImportCandidate,
    OsmImportRun,
    Rating,
)

SCOPE = RunScope(
    source_system="osm",
    source_dataset="test:sf",
    source_build_id="b1",
    source_label="SF test",
    scope_id="test:sf",
    scope_bounds_wkt=None,
)


def _cand(ext_id, lat, lng, tags=None):
    t, n = ext_id.split(":")[1], int(ext_id.split(":")[2])
    return OsmCandidate(
        source_external_id=ext_id,
        osm_type=t,
        osm_id=n,
        latitude=lat,
        longitude=lng,
        tags=tags or {"amenity": "drinking_water"},
        confidence="high",
        geometry_kind="point",
    )


# --- Task 6: insert / idempotency / spatial-match-to-user ---


@pytest.mark.asyncio
async def test_insert_creates_osm_fountain_with_provenance(session):
    s = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    assert s.inserted_count == 1
    f = (await session.execute(select(Fountain))).scalar_one()
    assert f.created_source == "osm" and f.added_by_user_id is None and f.is_working is True
    assert f.rating_count == 0 and f.ranking_score is None
    prov = (await session.execute(select(FountainProvenance))).scalar_one()
    assert prov.source_external_id == "osm:node:1" and prov.fountain_id == f.id


@pytest.mark.asyncio
async def test_reimport_same_feature_is_idempotent(session):
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    f1 = (await session.execute(select(Fountain))).scalar_one()
    created_before = f1.created_at
    s2 = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    count = (await session.execute(select(func.count()).select_from(Fountain))).scalar_one()
    assert count == 1  # no duplicate
    assert s2.inserted_count == 0 and s2.updated_count == 0  # nothing changed
    f2 = (await session.execute(select(Fountain))).scalar_one()
    assert f2.created_at == created_before  # row untouched


@pytest.mark.asyncio
async def test_reimport_advances_last_seen_without_event(session):
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    seen1 = (await session.execute(select(FountainProvenance.last_seen_at))).scalar_one()
    events1 = (
        await session.execute(select(func.count()).select_from(FountainImportEvent))
    ).scalar_one()
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    seen2 = (await session.execute(select(FountainProvenance.last_seen_at))).scalar_one()
    events2 = (
        await session.execute(select(func.count()).select_from(FountainImportEvent))
    ).scalar_one()
    assert seen2 >= seen1  # freshness advanced (bookkeeping)
    assert events2 == events1  # no NEW event for a pure freshness touch


@pytest.mark.asyncio
async def test_spatial_match_to_user_fountain_attaches_provenance_without_moving(
    session, test_user
):
    uf = Fountain(
        location=point_geography(37.7700, -122.4000),
        is_working=True,
        created_source="user",
        added_by_user_id=test_user.id,
    )
    session.add(uf)
    await session.commit()
    before = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    s = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:9", 37.77004, -122.40000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    assert s.provenance_attached_count == 1 and s.inserted_count == 0
    f = (await session.execute(select(Fountain))).scalar_one()
    assert f.created_source == "user" and f.added_by_user_id == test_user.id  # origin unchanged
    after = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    assert after == before  # NOT moved
    prov = (await session.execute(select(FountainProvenance))).scalar_one()
    assert prov.fountain_id == f.id and prov.source_external_id == "osm:node:9"


# --- Task 8: movement / removal / dry-run / rollback ---


@pytest.mark.asyncio
async def test_small_move_updates_unrated_osm_row(session):
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77000, -122.41000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    # ~10 m move (well under osm_move_small_max_m=25) -> location updated
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77009, -122.41000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    lat = (await session.execute(select(latitude_of(Fountain.location)))).scalar_one()
    assert round(lat, 5) == 37.77009


@pytest.mark.asyncio
async def test_large_move_is_review_flagged_not_moved(session):
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    before = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    s = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.78, -122.41)],
        skipped=[],
        dry_run=False,
    )  # ~1.1 km
    await session.commit()
    assert s.review_flagged_count == 1
    after = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    assert after == before  # not moved


@pytest.mark.asyncio
async def test_rated_osm_row_is_never_auto_moved(session, test_user):
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77000, -122.41000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    f = (await session.execute(select(Fountain))).scalar_one()
    session.add(Rating(fountain_id=f.id, user_id=test_user.id, rating_type_id=1, stars=5))
    f.rating_count = 1
    await session.commit()
    before = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77009, -122.41000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    after = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    assert after == before  # rated row: no auto-move even for a small move


@pytest.mark.asyncio
async def test_scope_limited_removal_does_not_touch_other_scope(session):
    scope_a = RunScope("osm", "test:a", "b1", "A", "test:a", None)
    scope_b = RunScope("osm", "test:b", "b1", "B", "test:b", None)
    await merge_candidates(
        session,
        scope=scope_a,
        candidates=[_cand("osm:node:1", 10.0, 10.0)],
        skipped=[],
        dry_run=False,
    )
    await merge_candidates(
        session,
        scope=scope_b,
        candidates=[_cand("osm:node:2", 20.0, 20.0)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    # Refresh scope A with node:1 absent -> node:1 removed, node:2 (scope B) untouched.
    await merge_candidates(session, scope=scope_a, candidates=[], skipped=[], dry_run=False)
    await session.commit()
    p1 = (
        await session.execute(
            select(FountainProvenance).where(FountainProvenance.source_external_id == "osm:node:1")
        )
    ).scalar_one()
    p2 = (
        await session.execute(
            select(FountainProvenance).where(FountainProvenance.source_external_id == "osm:node:2")
        )
    ).scalar_one()
    assert p1.removed_at is not None
    assert p2.removed_at is None  # other scope NOT touched


@pytest.mark.asyncio
async def test_scope_removal_handles_more_than_asyncpg_bind_limit(session):
    summary = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[
            _cand("osm:node:1", 37.77, -122.41),
            _cand("osm:node:40001", 37.78, -122.41),
        ],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    run = (
        await session.execute(select(OsmImportRun).where(OsmImportRun.id == summary.run_id))
    ).scalar_one()

    removal_summary = RunSummary(run_id=run.id)
    await _mark_scope_removals(
        session,
        run=run,
        scope=SCOPE,
        seen_ext_ids={f"osm:node:{i}" for i in range(40_000)},
        now=datetime.now(tz=UTC),
        summary=removal_summary,
    )

    provenances = {
        provenance.source_external_id: provenance
        for provenance in (await session.execute(select(FountainProvenance))).scalars()
    }
    assert provenances["osm:node:1"].removed_at is None
    assert provenances["osm:node:40001"].removed_at is not None
    assert removal_summary.removed_count == 1


@pytest.mark.asyncio
async def test_dry_run_mutates_no_production_tables(session):
    s = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=True,
    )
    await session.commit()
    assert s.dry_run is True and s.inserted_count == 1  # would-insert reported
    assert (await session.execute(select(func.count()).select_from(Fountain))).scalar_one() == 0
    assert (
        await session.execute(select(func.count()).select_from(FountainProvenance))
    ).scalar_one() == 0
    # candidate rows ARE written for audit
    assert (
        await session.execute(select(func.count()).select_from(OsmImportCandidate))
    ).scalar_one() == 1


@pytest.mark.asyncio
async def test_dry_run_records_matched_fountain_id(session, test_user):
    uf = Fountain(
        location=point_geography(37.77, -122.41),
        is_working=True,
        created_source="user",
        added_by_user_id=test_user.id,
    )
    session.add(uf)
    await session.commit()
    await session.refresh(uf)
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:5", 37.77, -122.41)],
        skipped=[],
        dry_run=True,
    )
    await session.commit()
    cand = (
        await session.execute(
            select(OsmImportCandidate).where(OsmImportCandidate.source_external_id == "osm:node:5")
        )
    ).scalar_one()
    assert cand.action == "match_provenance" and cand.matched_fountain_id == uf.id
    assert (
        await session.execute(select(func.count()).select_from(FountainProvenance))
    ).scalar_one() == 0


@pytest.mark.asyncio
async def test_rollback_run_hides_inserts_and_keeps_user_rows(session):
    s = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    n = await rollback_run(session, s.run_id)
    await session.commit()
    assert n >= 1
    f = (await session.execute(select(Fountain))).scalar_one()
    assert f.is_hidden is True  # inserted row hidden, not deleted


@pytest.mark.asyncio
async def test_rollback_detaches_provenance_from_user_fountain(session, test_user):
    uf = Fountain(
        location=point_geography(37.77, -122.41),
        is_working=True,
        created_source="user",
        added_by_user_id=test_user.id,
    )
    session.add(uf)
    await session.commit()
    await session.refresh(uf)
    s = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:7", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    await rollback_run(session, s.run_id)
    await session.commit()
    assert (
        await session.execute(select(func.count()).select_from(FountainProvenance))
    ).scalar_one() == 0
    f = (await session.execute(select(Fountain).where(Fountain.id == uf.id))).scalar_one()
    assert (
        f.is_hidden is False and f.created_source == "user" and f.added_by_user_id == test_user.id
    )


@pytest.mark.asyncio
async def test_rollback_preserves_ratings_on_imported_row(session, test_user):
    s = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77, -122.41)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    f = (await session.execute(select(Fountain))).scalar_one()
    session.add(Rating(fountain_id=f.id, user_id=test_user.id, rating_type_id=1, stars=5))
    f.rating_count = 1
    await session.commit()
    await rollback_run(session, s.run_id)
    await session.commit()
    f2 = (await session.execute(select(Fountain).where(Fountain.id == f.id))).scalar_one()
    assert f2.is_hidden is True
    assert (await session.execute(select(func.count()).select_from(Rating))).scalar_one() == 1


@pytest.mark.asyncio
async def test_rollback_restores_moved_location_and_mark_removed(session):
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77000, -122.41000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    a = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    s2 = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77009, -122.41000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    await rollback_run(session, s2.run_id)
    await session.commit()
    assert (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one() == a
    prior_run = (await session.execute(select(FountainProvenance.last_import_run_id))).scalar_one()
    s3 = await merge_candidates(session, scope=SCOPE, candidates=[], skipped=[], dry_run=False)
    await session.commit()
    p = (await session.execute(select(FountainProvenance))).scalar_one()
    assert p.removed_at is not None and p.last_import_run_id == s3.run_id
    await rollback_run(session, s3.run_id)
    await session.commit()
    p2 = (await session.execute(select(FountainProvenance))).scalar_one()
    # mark_removed fully reversed: removed_at cleared AND last_import_run_id restored.
    assert p2.removed_at is None and p2.last_import_run_id == prior_run


@pytest.mark.asyncio
async def test_spatial_match_to_imported_row_applies_small_move(session):
    # A different source id ~5 m from an imported, unrated row -> spatial match: attach a
    # second provenance AND apply the movement rule (small move -> location updated).
    await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:1", 37.77000, -122.41000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    s2 = await merge_candidates(
        session,
        scope=SCOPE,
        candidates=[_cand("osm:node:2", 37.77004, -122.41000)],
        skipped=[],
        dry_run=False,
    )
    await session.commit()
    count = (await session.execute(select(func.count()).select_from(Fountain))).scalar_one()
    provs = (
        await session.execute(select(func.count()).select_from(FountainProvenance))
    ).scalar_one()
    assert count == 1 and provs == 2  # one fountain, two OSM provenances
    lat = (await session.execute(select(latitude_of(Fountain.location)))).scalar_one()
    assert round(lat, 5) == 37.77004  # moved to the spatially-matched candidate
    # the move is counted in the run summary (consistent with the durable event log)
    assert s2.provenance_attached_count == 1 and s2.updated_count == 1


# --- Task 9: concurrency (real endpoint + import) ---


async def _advisory_lock_waiters(maker, key: int) -> int:
    # Count sessions BLOCKED (ungranted) on our advisory lock. A single bigint key splits
    # into classid (high 32 bits) / objid (low 32 bits) with objsubid=1 in pg_locks.
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


@pytest.mark.asyncio
async def test_real_add_endpoint_and_import_serialize_via_advisory_lock(client, engine, test_user):
    # Drive the ACTUAL POST /api/v1/fountains concurrently with merge_candidates at the SAME
    # point. A gate transaction holds the shared advisory lock so BOTH operations queue
    # behind it (deterministic overlap). When released they run serialized -> exactly ONE
    # fountain, and the loser reconciles (add gets 409, or import attaches provenance).
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def do_import():
        async with maker() as s:
            await merge_candidates(
                s,
                scope=SCOPE,
                candidates=[_cand("osm:node:1", 37.77, -122.41)],
                skipped=[],
                dry_run=False,
            )
            await s.commit()

    add_result: dict[str, int] = {}

    async def do_add():
        r = await client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 37.77, "longitude": -122.41}, "is_working": True},
        )
        add_result["status"] = r.status_code

    async with maker() as gate:
        await gate.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
        t_import = asyncio.create_task(do_import())
        t_add = asyncio.create_task(do_add())
        for _ in range(200):
            if await _advisory_lock_waiters(maker, ADD_FOUNTAIN_LOCK_KEY) >= 2:
                break
            await asyncio.sleep(0.05)
        else:
            raise AssertionError("both workers did not block on the advisory lock in time")
        await gate.commit()
    await asyncio.gather(t_import, t_add)

    async with maker() as s:
        count = (await s.execute(select(func.count()).select_from(Fountain))).scalar_one()
        prov = (await s.execute(select(func.count()).select_from(FountainProvenance))).scalar_one()
    assert count == 1  # serialized: exactly one fountain, no near-duplicate
    assert add_result["status"] in (201, 409)
    assert add_result["status"] == 409 or prov == 1
