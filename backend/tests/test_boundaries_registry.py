from pathlib import Path

import pytest

from app.imports.boundaries_registry import (
    BoundaryRegistryError,
    load_registry,
    validate_boundary_scope,
)

# Plain-dict rows exercise the pure validator without touching the real registry (mirrors
# test_regions.py). One active US row, one active LU row, and one retired row.
ROWS = [
    {
        "scope_id": "overture:us",
        "country": "US",
        "overture_release_id": "2026-06-17.0",
        "status": "active",
    },
    {
        "scope_id": "overture:lu",
        "country": "LU",
        "overture_release_id": "2026-06-17.0",
        "status": "active",
    },
    {
        "scope_id": "overture:xx",
        "country": "XX",
        "overture_release_id": "2026-06-17.0",
        "status": "retired",
    },
]


def test_active_scope_with_matching_release_ok():
    row = validate_boundary_scope(ROWS, scope_id="overture:us", release_id="2026-06-17.0")
    assert row["country"] == "US"


def test_unknown_scope_rejected():
    with pytest.raises(BoundaryRegistryError, match="no registry row"):
        validate_boundary_scope(ROWS, scope_id="overture:de", release_id="2026-06-17.0")


def test_retired_scope_rejected_distinctly():
    with pytest.raises(BoundaryRegistryError, match="retired"):
        validate_boundary_scope(ROWS, scope_id="overture:xx", release_id="2026-06-17.0")


def test_release_mismatch_rejected():
    # The dispatched release is bound to the scope's pinned value — a different (even syntactically
    # valid) release must fail closed rather than fetch an unpinned release.
    with pytest.raises(BoundaryRegistryError, match="!= pinned"):
        validate_boundary_scope(ROWS, scope_id="overture:us", release_id="2026-05-21.0")


def test_ambiguous_registry_rejected():
    dup = [
        *ROWS,
        {
            "scope_id": "overture:us",
            "country": "US",
            "overture_release_id": "2026-06-17.0",
            "status": "active",
        },
    ]
    with pytest.raises(BoundaryRegistryError, match="ambiguous"):
        validate_boundary_scope(dup, scope_id="overture:us", release_id="2026-06-17.0")


def test_bad_scope_syntax_rejected():
    with pytest.raises(BoundaryRegistryError, match="scope_id failed syntax"):
        validate_boundary_scope(ROWS, scope_id="overture:US", release_id="2026-06-17.0")


@pytest.mark.parametrize("bad", ["2026-6-17.0", "latest", "2026-06-17", "2026-06-17.0; DROP"])
def test_bad_release_syntax_rejected(bad):
    with pytest.raises(BoundaryRegistryError, match="overture_release_id failed syntax"):
        validate_boundary_scope(ROWS, scope_id="overture:us", release_id=bad)


def test_invalid_country_in_row_rejected():
    bad_rows = [
        {
            "scope_id": "overture:zz",
            "country": "usa",  # not ISO-3166-1 alpha-2 uppercase
            "overture_release_id": "2026-06-17.0",
            "status": "active",
        }
    ]
    with pytest.raises(BoundaryRegistryError, match="invalid country"):
        validate_boundary_scope(bad_rows, scope_id="overture:zz", release_id="2026-06-17.0")


def test_real_registry_loads_and_is_well_formed():
    path = Path(__file__).resolve().parents[2] / ".github" / "boundary-source-regions.yml"
    rows = load_registry(str(path))
    assert isinstance(rows, list) and rows
    for r in rows:
        assert {"scope_id", "country", "overture_release_id", "status"} <= set(r)
        assert r["status"] in ("active", "retired")
    # Exactly one active owner per scope_id (the one-owner control).
    active = [r["scope_id"] for r in rows if r["status"] == "active"]
    assert len(active) == len(set(active))
    # Every active row must pass its own validation (syntax + release-binding).
    for r in rows:
        if r["status"] == "active":
            validated = validate_boundary_scope(
                rows, scope_id=r["scope_id"], release_id=r["overture_release_id"]
            )
            assert validated is r
