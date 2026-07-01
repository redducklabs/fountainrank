from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.imports.cli import RunScope, _resolve_scope_bounds_wkt, run_import
from app.models import Fountain, OsmImportRun

FIX = Path(__file__).parent / "fixtures"
SCOPE = RunScope("osm", "test:sf", "b1", "SF test", "test:sf", None)
SF_WKT = "POLYGON((-123 37, -121 37, -121 39, -123 39, -123 37))"


@pytest.mark.asyncio
async def test_cli_dry_run_then_apply(session):
    # The CLI opens its OWN session via app.db.get_sessionmaker() and commits; the test's
    # `session` fixture (separate connection, same DB on 5436) reads the committed result.
    path = str(FIX / "osm_basic.geojson")
    dry = await run_import(path, scope=SCOPE, dry_run=True)
    assert dry.dry_run is True and dry.inserted_count == 2
    assert (await session.execute(select(func.count()).select_from(Fountain))).scalar_one() == 0
    applied = await run_import(path, scope=SCOPE, dry_run=False)
    assert applied.inserted_count == 2
    assert (await session.execute(select(func.count()).select_from(Fountain))).scalar_one() == 2


@pytest.mark.asyncio
async def test_cli_rejects_url_like_source_identity(session):
    # A credentialed/raw URL in an identity field must be refused before any DB write.
    bad = RunScope(
        "osm",
        "https://user:tok@example.com/extract.geojson?sig=x",
        "b1",
        "L",
        "test:sf",
        None,
    )
    with pytest.raises(ValueError):
        await run_import(str(FIX / "osm_basic.geojson"), scope=bad, dry_run=True)
    assert (await session.execute(select(func.count()).select_from(OsmImportRun))).scalar_one() == 0


def test_resolve_scope_bounds_wkt_from_file(tmp_path):
    f = tmp_path / "scope.wkt"
    f.write_text(SF_WKT + "\n", encoding="utf-8")
    assert _resolve_scope_bounds_wkt(None, str(f)) == SF_WKT
    assert _resolve_scope_bounds_wkt(SF_WKT, None) == SF_WKT
    assert _resolve_scope_bounds_wkt(None, None) is None
    # Mutually exclusive.
    with pytest.raises(ValueError):
        _resolve_scope_bounds_wkt(SF_WKT, str(f))


@pytest.mark.asyncio
async def test_require_scope_bounds_blocks_apply_without_wkt(session):
    # A non-dry-run without a validated polygon must fail BEFORE any DB write.
    with pytest.raises(ValueError, match="scope_bounds is required"):
        await run_import(
            str(FIX / "osm_basic.geojson"), scope=SCOPE, dry_run=False, require_scope_bounds=True
        )
    assert (await session.execute(select(func.count()).select_from(OsmImportRun))).scalar_one() == 0


@pytest.mark.asyncio
async def test_require_scope_bounds_allows_dry_run(session):
    # Dry-run never removes, so the guard permits it even without bounds.
    s = await run_import(
        str(FIX / "osm_basic.geojson"), scope=SCOPE, dry_run=True, require_scope_bounds=True
    )
    assert s.dry_run is True


@pytest.mark.asyncio
async def test_scope_bounds_wkt_is_stored(session):
    scope = RunScope("osm", "test:sf", "b1", "SF test", "test:sf", SF_WKT)
    s = await run_import(str(FIX / "osm_basic.geojson"), scope=scope, dry_run=True)
    run = (
        await session.execute(select(OsmImportRun).where(OsmImportRun.id == s.run_id))
    ).scalar_one()
    assert run.scope_bounds is not None
