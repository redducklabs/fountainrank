"""Live + logging behavior of the loader-session GUC config (spec 2026-07-17 §2a).

Proves the configured startup GUCs actually reach the server (`SHOW ...` on a real connection —
not just dict shape), that a LONE optional setting assembles server_settings by itself, that
`loader_session_config` is emitted exactly when configured (and never carries the DSN), and that
both loader CLI entrypoints emit it after logging is configured and BEFORE any database work.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings, get_settings
from app.db import engine_connect_args, log_session_config

_MARKER = "loader:boundary-load:29468135928"


def _loader_settings(**overrides) -> Settings:
    return Settings(database_url=get_settings().database_url, **overrides)


async def _show(engine, guc: str) -> str:
    async with engine.connect() as conn:
        return (await conn.execute(text(f"SHOW {guc}"))).scalar_one()


async def test_live_show_reflects_all_three_gucs():
    settings = _loader_settings(
        db_application_name=_MARKER,
        db_client_connection_check_interval_ms=30_000,
        db_lock_timeout_ms=900_000,
    )
    engine = create_async_engine(settings.database_url, connect_args=engine_connect_args(settings))
    try:
        assert await _show(engine, "application_name") == _MARKER
        assert await _show(engine, "client_connection_check_interval") == "30s"
        assert await _show(engine, "lock_timeout") == "15min"
    finally:
        await engine.dispose()


async def test_live_show_lone_setting_assembles_server_settings():
    # A single optional setting must create server_settings on its own (conditional-assembly
    # regression guard).
    settings = _loader_settings(db_client_connection_check_interval_ms=1_000)
    engine = create_async_engine(settings.database_url, connect_args=engine_connect_args(settings))
    try:
        assert await _show(engine, "client_connection_check_interval") == "1s"
        # The untouched GUCs keep their server defaults.
        assert await _show(engine, "lock_timeout") == "0"
    finally:
        await engine.dispose()


def test_log_session_config_emits_when_configured(caplog):
    settings = Settings(
        db_application_name=_MARKER,
        db_client_connection_check_interval_ms=30_000,
        db_lock_timeout_ms=900_000,
    )
    with caplog.at_level(logging.INFO, logger="app.db"):
        log_session_config(settings)
    [record] = [r for r in caplog.records if r.getMessage() == "loader_session_config"]
    assert record.application_name == _MARKER
    assert record.client_connection_check_interval_ms == 30_000
    assert record.lock_timeout_ms == 900_000
    # Never the DSN.
    assert "postgresql" not in repr(vars(record))


def test_log_session_config_silent_when_unconfigured(caplog):
    with caplog.at_level(logging.INFO, logger="app.db"):
        log_session_config(Settings())
    assert not [r for r in caplog.records if r.getMessage() == "loader_session_config"]


@pytest.mark.parametrize(
    ("module_name", "argv", "summary"),
    [
        (
            "app.imports.boundary_cli",
            ["--path", "nope.geojsonl", "--dry-run"],
            SimpleNamespace(dry_run=True),
        ),
        (
            "app.imports.cli",
            [
                "--path",
                "nope.geojson",
                "--scope-id",
                "us/ca",
                "--dataset",
                "geofabrik:us/california",
                "--build-id",
                "2026-01-01",
                "--label",
                "Test",
                "--dry-run",
            ],
            SimpleNamespace(run_id="00000000-0000-0000-0000-000000000000", dry_run=True),
        ),
    ],
)
def test_cli_entrypoints_log_before_database_work(monkeypatch, capsys, module_name, argv, summary):
    # configure_logging() clears the root handlers (so caplog cannot observe records emitted
    # after it); pin the entrypoint ORDER instead — configure logging, then the session-config
    # log, then (and only then) any database work. Emission content is covered by the direct
    # log_session_config tests above.
    import importlib

    module = importlib.import_module(module_name)
    events: list[str] = []
    real_configure = module.configure_logging
    monkeypatch.setattr(
        module, "configure_logging", lambda: (events.append("configure_logging"), real_configure())
    )
    monkeypatch.setattr(module, "log_session_config", lambda: events.append("session_config"))

    def fake_asyncio_run(coro):
        coro.close()  # never executed — the engine must not be touched
        events.append("database_work")
        return summary

    monkeypatch.setattr(module.asyncio, "run", fake_asyncio_run)
    assert module.main(argv) == 0
    capsys.readouterr()
    assert events == ["configure_logging", "session_config", "database_work"]
