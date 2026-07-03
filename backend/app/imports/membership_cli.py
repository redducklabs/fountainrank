"""Membership backfill CLI — re-derive fountain -> place membership DB-wide (#127 Slice 1d).

The refresh-only counterpart to ``app.imports.boundary_cli``. A boundary load already refreshes
membership at the end (spec §11.5 — "deterministic refresh on boundary load"), so this CLI is for
the cases a load doesn't cover:

- the **one-time backfill** after Slice 1d ships (LU + US boundaries were loaded by Slice 1c BEFORE
  membership existed, so the already-present fountains need their first assignment), and
- re-deriving membership WITHOUT re-fetching boundaries from S3 (e.g. after loading several
  countries with ``--skip-membership-refresh``).

It re-derives everything :func:`app.membership.refresh_all_memberships` owns — the
``place_boundary_cells`` point-in-polygon index (rebuilt from ``place_boundaries``), per-fountain
country/city assignment, denormalized ``fountain_count``, ``is_canonical`` per ``(country_code,
slug)``, and ``parent_id`` (city -> country by ``country_code``) — in one set-based transaction,
then prints one machine-readable JSON summary line (the CLI result contract). Like ``boundary_cli``
it is the loader entry a CI workflow ``kubectl exec``s into the running backend pod; it takes no
input file. This is the path to run the one-time backfill after the cell perf fix ships (it
populates the freshly-migrated, empty ``place_boundary_cells`` and assigns every fountain).

Usage:
  python -m app.imports.membership_cli
"""

from __future__ import annotations

import asyncio
import json
import logging

from app.db import get_sessionmaker
from app.logging_config import configure_logging
from app.membership import MembershipRefreshSummary, refresh_all_memberships

log = logging.getLogger(__name__)


async def run_membership_backfill() -> MembershipRefreshSummary:
    """Run the full membership refresh in one transaction and commit. Opens its own session
    (kubectl-exec entry), mirroring ``boundary_cli.run_boundary_load``."""
    maker = get_sessionmaker()
    async with maker() as session:
        summary = await refresh_all_memberships(session)
        await session.commit()
    return summary


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    summary = asyncio.run(run_membership_backfill())
    # Diagnostics already went through structured logging (refresh_all_memberships emits the
    # membership_refresh_complete summary). This ONE stdout line is the CLI's machine-readable
    # RESULT contract for operators/CI.
    log.info("membership_backfill_cli_done")
    print(json.dumps(summary.__dict__, default=str))  # documented CLI result contract
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
