"""Marker-composition contract for the loader session identity (spec 2026-07-17).

The marker is the authorization boundary for the session reaper: only sessions whose
``application_name`` exactly equals a marker composed from an allow-listed Job name and a decimal
run id may ever be terminated. These tests pin acceptance for the three known loader Jobs and
refusal for everything else — including the 63-byte PostgreSQL ``application_name`` truncation
bound, which would silently break exact matching if ever exceeded.
"""

from __future__ import annotations

import pytest

from app.imports import loader_session
from app.imports.loader_session import LOADER_JOB_NAMES, compose_session_marker


@pytest.mark.parametrize("job_name", sorted(LOADER_JOB_NAMES))
def test_allow_listed_names_compose(job_name):
    marker = compose_session_marker(job_name, "29468135928")
    assert marker == f"loader:{job_name}:29468135928"
    assert len(marker.encode("ascii")) <= 63


def test_allow_list_is_exactly_the_three_loader_jobs():
    assert LOADER_JOB_NAMES == frozenset({"boundary-load", "osm-import", "osm-pbf-import"})


@pytest.mark.parametrize(
    "job_name",
    [
        "",
        "unknown-job",
        "boundary-load2",  # lookalike suffix
        "Boundary-Load",  # case variant
        "BOUNDARY-LOAD",
        " boundary-load",  # whitespace
        "boundary-load ",
        "boundary\x00load",  # control character
        "boundary-load\n",
        "loader:boundary-load",  # prefix smuggling
        "fountainrank-backend",  # the serving deployment's name
    ],
)
def test_job_names_outside_the_allow_list_are_rejected(job_name):
    with pytest.raises(ValueError):
        compose_session_marker(job_name, "1")


@pytest.mark.parametrize(
    "run_id",
    [
        "",
        "abc",
        "12a",
        "-1",
        "1.5",
        " 1",
        "1 ",
        "1\n",
        "1" * 21,  # over the 20-digit bound
    ],
)
def test_bad_run_ids_are_rejected(run_id):
    with pytest.raises(ValueError):
        compose_session_marker("boundary-load", run_id)


def test_overlength_composition_is_rejected_via_the_public_function(monkeypatch):
    # An allow-list entry long enough to push the composed marker past PostgreSQL's 63-byte
    # application_name limit must be refused by compose_session_marker itself — truncation on the
    # server side would silently break the reaper's exact matching.
    long_name = "x" * 60
    monkeypatch.setattr(loader_session, "LOADER_JOB_NAMES", frozenset({long_name}))
    with pytest.raises(ValueError, match="63"):
        compose_session_marker(long_name, "12345678901234567890")


def test_module_is_stdlib_only():
    # The module must import on a bare GitHub runner (PYTHONPATH=backend python3 -m ...): no
    # third-party or application imports.
    import ast
    import inspect
    import sys

    tree = ast.parse(inspect.getsource(loader_session))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            imported.add(node.module.split(".")[0])
    assert imported <= (set(sys.stdlib_module_names) | {"__future__"}), imported
