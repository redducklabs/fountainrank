"""Loader session reaper — guaranteed-teardown cleanup of a specific run's DB sessions.

Spec 2026-07-17 (candidate-capture + loader-cancellation design §2b). A killed loader Job's
PostgreSQL session can keep executing server-side (the busy backend never reads its dead socket)
while holding ``ADD_FOUNTAIN_LOCK`` — the 2026-07-16 Spain incident ran 37+ hours and cascaded
seven advisory waiters. The workflow teardown runs this CLI (via ``kubectl exec`` into the
serving backend) to terminate exactly the sessions of one workflow run.

Authorization boundary: the CLI accepts only validated COMPONENTS (``--job-name`` from the fixed
allow-list, ``--run-id`` decimal) and composes the ``application_name`` marker itself via
:mod:`app.imports.loader_session` — it structurally cannot be pointed at the serving backend's
(empty) ``application_name`` or any other session population. Termination is exact-match only and
never targets its own backend PID.

Usage:
  python -m app.imports.session_reaper --job-name boundary-load --run-id 12345678

Prints ONE machine-readable JSON result line: ``{"terminated": n, "remaining": m}``. Zero matches
is success (the normal case). Logs ``loader_session_reaped`` per terminated session with metadata
only — never query text (the logging standard forbids raw payloads; truncation is not redaction).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging

from sqlalchemy import text

from app.db import get_engine
from app.imports.loader_session import LOADER_JOB_NAMES, compose_session_marker
from app.logging_config import configure_logging

log = logging.getLogger(__name__)

_REAP_SQL = text(
    """
    SELECT pid, state, wait_event_type, wait_event,
           EXTRACT(EPOCH FROM (now() - xact_start)) AS xact_age_s,
           pg_terminate_backend(pid) AS terminated
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name = :marker
      AND pid <> pg_backend_pid()
    """
)

_REMAINING_SQL = text(
    """
    SELECT count(*)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name = :marker
      AND pid <> pg_backend_pid()
    """
)


# pg_terminate_backend is asynchronous (it signals the backend); give the signalled backends a
# short bounded grace to actually exit so the normal path reports remaining == 0 deterministically.
# The teardown state machine's outer re-query loop owns the pathological case (spec §2b phase 4).
_REMAINING_GRACE_S = 5.0
_REMAINING_POLL_S = 0.25


async def reap_sessions(marker: str) -> dict[str, int]:
    """Terminate every session bearing exactly ``marker``; re-query and report survivors."""
    engine = get_engine()
    async with engine.connect() as conn:
        rows = (await conn.execute(_REAP_SQL, {"marker": marker})).all()
        terminated = 0
        for row in rows:
            if row.terminated:
                terminated += 1
            # Metadata only — NEVER pg_stat_activity.query (raw-payload logging is forbidden).
            log.info(
                "loader_session_reaped",
                extra={
                    "marker": marker,
                    "pid": row.pid,
                    "session_state": row.state,
                    "wait_event_type": row.wait_event_type,
                    "wait_event": row.wait_event,
                    "xact_age_s": float(row.xact_age_s) if row.xact_age_s is not None else None,
                    "terminated": bool(row.terminated),
                },
            )
        deadline = asyncio.get_running_loop().time() + _REMAINING_GRACE_S
        while True:
            # pg_stat_activity is snapshot-cached for the rest of the transaction — without
            # clearing it, this loop would keep seeing already-dead backends and report a
            # false `remaining` forever.
            await conn.execute(text("SELECT pg_stat_clear_snapshot()"))
            remaining = (await conn.execute(_REMAINING_SQL, {"marker": marker})).scalar_one()
            if remaining == 0 or asyncio.get_running_loop().time() >= deadline:
                break
            await asyncio.sleep(_REMAINING_POLL_S)
    return {"terminated": terminated, "remaining": int(remaining)}


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    p = argparse.ArgumentParser(prog="app.imports.session_reaper")
    p.add_argument("--job-name", required=True, help=f"one of: {sorted(LOADER_JOB_NAMES)}")
    p.add_argument("--run-id", required=True, help="the GitHub run id (decimal digits)")
    a = p.parse_args(argv)
    try:
        # Validation happens HERE, before any engine/database access.
        marker = compose_session_marker(a.job_name, a.run_id)
    except ValueError as exc:
        p.error(str(exc))  # exits 2; argparse prints to stderr
        raise AssertionError("unreachable") from exc
    result = asyncio.run(reap_sessions(marker))
    log.info("session_reaper_done", extra={"marker": marker, **result})
    print(json.dumps(result))  # the machine-readable result contract for the teardown
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
