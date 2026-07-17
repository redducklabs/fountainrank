"""Session reaper contract (spec 2026-07-17 §2b, Verification 3).

The reaper is a mutating operational tool: these tests prove it refuses invalid components
BEFORE any database access, terminates exactly the marker-bearing sessions on a live server
(sparing differently-marked and unmarked ones), reports honest counts, and logs metadata only —
never query text.
"""

from __future__ import annotations

import logging

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.imports import session_reaper
from app.imports.session_reaper import main, reap_sessions

_MARKER_A = "loader:boundary-load:111111"
_MARKER_B = "loader:boundary-load:222222"


@pytest.mark.parametrize(
    "argv",
    [
        ["--job-name", "fountainrank-backend", "--run-id", "1"],  # not allow-listed
        ["--job-name", "", "--run-id", "1"],
        ["--job-name", "boundary-load", "--run-id", "abc"],
        ["--job-name", "boundary-load", "--run-id", ""],
        ["--job-name", "loader:boundary-load", "--run-id", "1"],  # prefix smuggling
    ],
)
def test_invalid_components_refused_without_database_access(monkeypatch, capsys, argv):
    def _forbidden():
        raise AssertionError("engine must not be touched for invalid components")

    monkeypatch.setattr(session_reaper, "get_engine", _forbidden)
    with pytest.raises(SystemExit) as exc_info:
        main(argv)
    assert exc_info.value.code == 2
    capsys.readouterr()


def _marked_engine(marker: str | None):
    connect_args = {"server_settings": {"application_name": marker}} if marker else {}
    return create_async_engine(get_settings().database_url, connect_args=connect_args)


async def test_reaper_terminates_exact_marker_only(caplog):
    eng_a = _marked_engine(_MARKER_A)
    eng_b = _marked_engine(_MARKER_B)
    eng_plain = _marked_engine(None)
    conn_a = await eng_a.connect()
    conn_b = await eng_b.connect()
    conn_plain = await eng_plain.connect()
    try:
        with caplog.at_level(logging.INFO, logger="app.imports.session_reaper"):
            result = await reap_sessions(_MARKER_A)
        assert result == {"terminated": 1, "remaining": 0}

        # The differently-marked and unmarked sessions are untouched and still usable.
        assert (await conn_b.execute(text("SELECT 1"))).scalar_one() == 1
        assert (await conn_plain.execute(text("SELECT 1"))).scalar_one() == 1
        # The marked session is gone server-side.
        gone = (
            await conn_plain.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND application_name = :m"
                ),
                {"m": _MARKER_A},
            )
        ).scalar_one()
        assert gone == 0

        reaped = [r for r in caplog.records if r.getMessage() == "loader_session_reaped"]
        assert len(reaped) == 1
        assert reaped[0].marker == _MARKER_A
        assert reaped[0].terminated is True
        # Metadata only — never pg_stat_activity.query text.
        assert not hasattr(reaped[0], "query")
        assert "SELECT" not in repr(vars(reaped[0]))
    finally:
        for conn, eng in ((conn_a, eng_a), (conn_b, eng_b), (conn_plain, eng_plain)):
            try:
                await conn.close()
            except Exception:
                pass  # the reaped connection is expected to be dead
            await eng.dispose()


async def test_reaper_zero_matches_is_success(capsys, monkeypatch):
    result = await reap_sessions("loader:osm-import:999999999")
    assert result == {"terminated": 0, "remaining": 0}


def test_main_zero_match_exit_zero(capsys):
    assert main(["--job-name", "osm-import", "--run-id", "999999998"]) == 0
    out = capsys.readouterr().out.strip().splitlines()[-1]
    import json

    assert json.loads(out) == {"terminated": 0, "remaining": 0}
