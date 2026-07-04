"""Slice 1e — per-scope SEO coverage report (app.seo_coverage)."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text

from app.membership import refresh_all_memberships
from app.seo_coverage import compute_coverage


def _sq(x0, y0, x1, y1):
    return f"POLYGON(({x0} {y0}, {x1} {y0}, {x1} {y1}, {x0} {y1}, {x0} {y0}))"


async def _boundary(session, *, oid, subtype, cc, name, slug, wkt):
    await session.execute(
        text(
            """
            INSERT INTO place_boundaries
                (id, overture_id, subtype, class, name, country_code, slug, is_canonical,
                 fountain_count, boundary, created_at, updated_at)
            VALUES (gen_random_uuid(), :oid, :subtype, 'land', :name, :cc, :slug, false, 0,
                    ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
            """
        ),
        {"oid": oid, "subtype": subtype, "cc": cc, "name": name, "slug": slug, "wkt": wkt},
    )


async def _fountain(session, lat, lng, *, hidden=False):
    await session.execute(
        text(
            "INSERT INTO fountains (id, location, is_hidden, created_source) VALUES "
            "(gen_random_uuid(), ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, "
            ":h, 'admin_import')"
        ),
        {"lat": lat, "lng": lng, "h": hidden},
    )


async def _scope(session, cc, subtypes, ready):
    await session.execute(
        text(
            "INSERT INTO place_scope_config "
            "(country_code, eligible_city_subtypes, city_routes_ready) "
            "VALUES (:cc, :s, :r) ON CONFLICT (country_code) DO UPDATE SET "
            "eligible_city_subtypes = EXCLUDED.eligible_city_subtypes, "
            "city_routes_ready = EXCLUDED.city_routes_ready"
        ),
        {"cc": cc, "s": list(subtypes), "r": ready},
    )


@pytest.fixture
async def _fixture(session):
    # Country AA (0..10) with one locality city AA-1 covering 0..2. Ready.
    await _boundary(
        session,
        oid="aa",
        subtype="country",
        cc="aa",
        name="Aaland",
        slug="aaland",
        wkt=_sq(0, 0, 10, 10),
    )
    await _boundary(
        session,
        oid="aa-1",
        subtype="locality",
        cc="aa",
        name="Aatown",
        slug="aatown",
        wkt=_sq(0, 0, 2, 2),
    )
    await _scope(session, "aa", ["locality", "localadmin"], ready=True)
    # 3 fountains in the city, 1 in-country-but-no-city (country_only).
    for lng, lat in [(1, 1), (0.5, 0.5), (1.5, 1.5), (5, 5)]:
        await _fountain(session, lat, lng)
    # A no-row country BB (default eligible set) with its own country + locality, one city fountain.
    await _boundary(
        session,
        oid="bb",
        subtype="country",
        cc="bb",
        name="Beeland",
        slug="beeland",
        wkt=_sq(20, 20, 30, 30),
    )
    await _boundary(
        session,
        oid="bb-1",
        subtype="locality",
        cc="bb",
        name="Beetown",
        slug="beetown",
        wkt=_sq(20, 20, 22, 22),
    )
    await _fountain(session, 21, 21)
    # An unmatched fountain outside every country.
    await _fountain(session, 80, 80)
    await refresh_all_memberships(session)
    await session.commit()


@pytest.mark.asyncio
async def test_scope_counts_and_coverage(session, _fixture):
    report = await compute_coverage(session)
    aa = next(s for s in report.scopes if s.country_code == "aa")
    assert aa.city_routes_ready is True
    assert aa.effective_eligible_city_subtypes == ["locality", "localadmin"]
    assert aa.eligible_from_config is True
    assert aa.fountains_in_country == 4
    assert aa.city_matched == 3
    assert aa.country_only == 1
    assert aa.city_coverage_pct == pytest.approx(0.75)
    assert aa.boundary_counts.get("locality") == 1
    assert aa.invalid_boundaries == 0
    assert aa.recommended_ready is True  # 0.75 >= 0.5
    shares = {s.subtype: s.count for s in aa.city_assignment_by_subtype}
    assert shares == {"locality": 3}


@pytest.mark.asyncio
async def test_no_config_row_reports_default_eligible_set(session, _fixture):
    report = await compute_coverage(session)
    bb = next(s for s in report.scopes if s.country_code == "bb")
    assert bb.city_routes_ready is False
    assert bb.eligible_from_config is False
    assert bb.effective_eligible_city_subtypes == ["locality", "localadmin"]


@pytest.mark.asyncio
async def test_global_unmatched_tail(session, _fixture):
    report = await compute_coverage(session)
    assert report.unmatched_no_country == 1
    assert len(report.unmatched_no_country_clusters) >= 1


@pytest.mark.asyncio
async def test_country_filter(session, _fixture):
    report = await compute_coverage(session, country="aa")
    assert [s.country_code for s in report.scopes] == ["aa"]


@pytest.mark.asyncio
async def test_coverage_pct_null_when_no_matched(session):
    await _boundary(
        session,
        oid="cc",
        subtype="country",
        cc="cc",
        name="Ceeland",
        slug="ceeland",
        wkt=_sq(40, 40, 50, 50),
    )
    await refresh_all_memberships(session)
    await session.commit()
    report = await compute_coverage(session)
    cc = next(s for s in report.scopes if s.country_code == "cc")
    assert cc.fountains_in_country == 0
    assert cc.city_coverage_pct is None


@pytest.mark.asyncio
async def test_compute_coverage_performs_no_writes(session, _fixture):
    before = (await session.execute(text("SELECT count(*) FROM fountains"))).scalar_one()
    fc_before = (
        await session.execute(text("SELECT coalesce(sum(fountain_count),0) FROM place_boundaries"))
    ).scalar_one()
    await compute_coverage(session)
    after = (await session.execute(text("SELECT count(*) FROM fountains"))).scalar_one()
    fc_after = (
        await session.execute(text("SELECT coalesce(sum(fountain_count),0) FROM place_boundaries"))
    ).scalar_one()
    assert (before, fc_before) == (after, fc_after)


@pytest.mark.asyncio
async def test_collect_locked_coverage_matches_and_releases_lock(session, _fixture):
    from app.imports.seo_coverage_cli import collect_locked_coverage
    from app.locks import ADD_FOUNTAIN_LOCK_KEY

    report = await collect_locked_coverage()
    assert {s.country_code for s in report.scopes} >= {"aa", "bb"}

    # The session advisory lock must be released after the run: another session can take it.
    got = (
        await session.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})
    ).scalar_one()
    assert got is True
    await session.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})
    await session.commit()


@pytest.mark.asyncio
async def test_lock_is_held_during_read(session, _fixture, monkeypatch):
    """Regression guard for the lock-then-snapshot contract: while the report reads, the advisory
    lock is HELD (a separate connection's pg_try_advisory_lock fails). If the lock were taken as the
    read transaction's first statement / not held across the read, this would fail."""
    import app.imports.seo_coverage_cli as cli
    from app.db import get_engine
    from app.locks import ADD_FOUNTAIN_LOCK_KEY

    real = cli.compute_coverage
    seen = {}

    async def probe(bind, **kw):
        async with get_engine().connect() as other:
            got = (
                await other.execute(
                    text("SELECT pg_try_advisory_lock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY}
                )
            ).scalar_one()
            seen["held"] = got is False
            if got:  # defensive: if we somehow acquired it, release so we don't leak the lock
                await other.execute(
                    text("SELECT pg_advisory_unlock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY}
                )
            await other.rollback()
        return await real(bind, **kw)

    monkeypatch.setattr(cli, "compute_coverage", probe)
    await cli.collect_locked_coverage()
    assert seen["held"] is True


@pytest.mark.asyncio
async def test_collect_locked_coverage_no_writes(session, _fixture):
    from app.imports.seo_coverage_cli import collect_locked_coverage

    before = (await session.execute(text("SELECT count(*) FROM fountains"))).scalar_one()
    await collect_locked_coverage()
    after = (await session.execute(text("SELECT count(*) FROM fountains"))).scalar_one()
    assert before == after


def test_country_regex_validation():
    from app.imports.seo_coverage_cli import _COUNTRY_RE

    assert _COUNTRY_RE.fullmatch("us") and _COUNTRY_RE.fullmatch("US")
    assert not _COUNTRY_RE.fullmatch("usa")
    assert not _COUNTRY_RE.fullmatch("u")
    assert not _COUNTRY_RE.fullmatch("u1")
    assert not _COUNTRY_RE.fullmatch("us\n")


def test_cli_main_prints_json(capsys, monkeypatch):
    """main() is a sync entrypoint (argparse + asyncio.run + print). Stub the DB-touching collector
    so this stays a pure sync test — no nested event loop, no DB."""
    import app.imports.seo_coverage_cli as cli
    from app.seo_coverage import CoverageReport

    async def fake(*, country=None):
        return CoverageReport(scopes=[], unmatched_no_country=0)

    monkeypatch.setattr(cli, "collect_locked_coverage", fake)
    rc = cli.main([])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload == {"scopes": [], "unmatched_no_country": 0, "unmatched_no_country_clusters": []}


def test_cli_main_rejects_bad_country():
    import app.imports.seo_coverage_cli as cli

    with pytest.raises(SystemExit):
        cli.main(["--country", "usa"])
