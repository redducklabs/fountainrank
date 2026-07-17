"""Loader session-marker composition — the reaper's authorization boundary (spec 2026-07-17).

A loader Job's database sessions carry ``application_name = loader:<job_name>:<run_id>`` so the
guaranteed-teardown reaper can terminate exactly that run's sessions and nothing else. This module
is the ONE place the marker string shape exists: the Job-manifest renderer, the session reaper,
and the teardown state machine all compose it here from independently validated components — no
caller ever passes a pre-composed marker across a tool boundary.

Stdlib-only by contract: it must import on a bare GitHub runner via
``PYTHONPATH=backend python3 -m app.imports.<module>`` (both package ``__init__`` files are
empty, so importing it pulls in no application dependencies).
"""

from __future__ import annotations

import re

# The only Jobs the loader machinery runs. Extending this allow-list is a reviewed code change —
# it is the blast-radius boundary of the session reaper, not a convenience default.
LOADER_JOB_NAMES = frozenset({"boundary-load", "osm-import", "osm-pbf-import"})

_RUN_ID_RE = re.compile(r"^[0-9]{1,20}$")

# PostgreSQL silently truncates application_name at NAMEDATALEN-1 (63) bytes; a truncated marker
# would break the reaper's exact matching, so overlength composition is a hard error.
_MAX_MARKER_BYTES = 63


def compose_session_marker(job_name: str, run_id: str) -> str:
    """Compose ``loader:<job_name>:<run_id>`` from validated components.

    Raises ``ValueError`` unless ``job_name`` is allow-listed, ``run_id`` is 1-20 decimal digits,
    and the composed marker fits PostgreSQL's 63-byte ``application_name`` limit.
    """
    if job_name not in LOADER_JOB_NAMES:
        raise ValueError(f"job_name is not an allow-listed loader Job: {job_name!r}")
    if not _RUN_ID_RE.fullmatch(run_id):
        raise ValueError("run_id must be 1-20 decimal digits")
    marker = f"loader:{job_name}:{run_id}"
    if len(marker.encode("ascii")) > _MAX_MARKER_BYTES:
        raise ValueError(
            f"composed marker exceeds PostgreSQL's {_MAX_MARKER_BYTES}-byte application_name "
            "limit; truncation would break exact matching"
        )
    return marker
