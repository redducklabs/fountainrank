"""SEO coverage report CLI (#127 Slice 1e). Read-only; the CI-only prod path kubectl-execs this
in the backend pod (mirrors membership_cli). Prints ONE machine-readable JSON line — the result
contract.

Consistency (spec docs/specs/2026-07-04-seo-coverage-gate-design.md): acquire a SESSION-level
advisory lock (ADD_FOUNTAIN_LOCK_KEY) and COMMIT that transaction BEFORE the read transaction, so
the read's REPEATABLE READ snapshot is established only after the lock wait completes (a session
lock survives the commit). Then read inside one READ ONLY REPEATABLE READ transaction. Release the
lock in finally.

Usage:
  python -m app.imports.seo_coverage_cli [--country us]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re

from sqlalchemy import text

from app.db import get_engine
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.logging_config import configure_logging
from app.seo_coverage import CoverageReport, compute_coverage

log = logging.getLogger(__name__)

# fullmatch (below) is used, not match — a `$`-anchored pattern would accept a trailing newline
# ("us\n"), so validate against the WHOLE string instead.
_COUNTRY_RE = re.compile(r"[A-Za-z]{2}")


async def collect_locked_coverage(*, country: str | None = None) -> CoverageReport:
    """Run compute_coverage under the session advisory lock + one READ ONLY REPEATABLE READ txn."""
    engine = get_engine()
    async with engine.connect() as conn:
        # (1) Acquire the SESSION lock, then COMMIT — the lock survives (session-scoped), and the
        # commit clears the transaction so (a) isolation can be changed and (b) the next
        # transaction's snapshot is fixed AFTER the lock wait completed (the load-bearing ordering).
        await conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})
        await conn.commit()
        try:
            # (2) One READ ONLY REPEATABLE READ transaction — a single consistent snapshot.
            # Isolation is set now that no transaction is active; the first read below
            # autobegins it.
            ro = await conn.execution_options(
                isolation_level="REPEATABLE READ", postgresql_readonly=True
            )
            report = await compute_coverage(ro, country=country)
            await ro.commit()
            return report
        finally:
            await conn.rollback()
            await conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})
            await conn.commit()


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(prog="seo_coverage_cli")
    parser.add_argument("--country", default=None, help="optional ISO-3166-1 alpha-2 scope filter")
    args = parser.parse_args(argv)
    if args.country is not None and not _COUNTRY_RE.fullmatch(args.country):
        parser.error("--country must be a 2-letter code")
    report = asyncio.run(collect_locked_coverage(country=args.country))
    log.info("seo_coverage_cli_done", extra={"scopes": len(report.scopes)})
    print(json.dumps(report.to_dict(), default=str))  # documented CLI result contract
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
