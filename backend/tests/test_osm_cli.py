from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.imports.cli import RunScope, run_import
from app.models import Fountain

FIX = Path(__file__).parent / "fixtures"
SCOPE = RunScope("osm", "test:sf", "b1", "SF test", "test:sf", None)


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
