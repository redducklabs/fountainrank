"""Boundary-source registry: load + validate ``.github/boundary-source-regions.yml``.

The one-owner control for the Overture ``division_area`` boundary load (spec §11.3; plan
``docs/plans/2026-07-02-crawlable-seo-pages.md`` Slice 1c). ``osm-boundary-load.yml`` calls this
**before any remote S3 read** so unknown / retired / mispinned scopes fail closed — mirroring
``app.imports.regions`` for the fountain imports, and independent of
``.github/osm-import-regions.yml``.

It binds each dispatched scope to:

- a single **active** registry row (unknown / retired / ambiguous -> reject), and
- the row's **immutable pinned** ``overture_release_id`` — a dispatched release that does not equal
  the active row's pin is rejected (the release is bound to the scope; "pin, never chase latest",
  spec §11.3). Refreshing to a new Overture release is a reviewed edit here + a deliberate
  re-dispatch, never a free dispatch-time path.

It emits the row's ``country`` (ISO 3166-1 alpha-2) so the workflow never re-types it, and the S3
path is **built from the regex-validated release id** — an arbitrary S3/HTTP path is impossible by
construction.

Pure validation is stdlib-only and unit-testable with plain dicts. YAML loading (PyYAML) happens
only in ``load_registry``/``main`` so the module is file-invocable from CI
(``python3 backend/app/imports/boundaries_registry.py …``) with no ``app`` import — mirroring
``regions.py``.
"""

from __future__ import annotations

import argparse
import re
import sys

_REQUIRED_KEYS = {"scope_id", "country", "overture_release_id", "status"}

# Fail-closed syntax allow-lists (defense-in-depth; the workflow also rejects newline/CR upstream
# because workflow_dispatch is API-callable).
# scope_id: lowercase alnum plus ``: / _ -`` separators, e.g. ``overture:us``.
_SCOPE_ID_RE = re.compile(r"^[a-z0-9]([a-z0-9:/_-]*[a-z0-9])?$")
# Overture release id, e.g. ``2026-06-17.0`` (immutable, reproducible pin). The S3 path is built
# from this — the strict shape (no quotes/spaces/path separators) is what makes that injection-safe.
_RELEASE_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.\d+$")
# ISO 3166-1 alpha-2, uppercase — the DuckDB ``country`` predicate value.
_COUNTRY_RE = re.compile(r"^[A-Z]{2}$")


class BoundaryRegistryError(ValueError):
    """Raised when a dispatched (scope_id, overture_release_id) is not one active pinned row."""


def validate_boundary_scope(rows: list[dict], *, scope_id: str, release_id: str) -> dict:
    """Return the single **active** registry row for ``scope_id``, or raise.

    Fail-closed on: bad ``scope_id``/``release_id`` syntax, unknown scope, retired-only scope,
    more than one active row, a dispatched ``release_id`` that does not equal the active row's
    pinned ``overture_release_id``, or an active row whose ``country`` is not ISO 3166-1 alpha-2.
    """
    if not _SCOPE_ID_RE.match(scope_id):
        raise BoundaryRegistryError(f"scope_id failed syntax allow-list: {scope_id!r}")
    if not _RELEASE_ID_RE.match(release_id):
        raise BoundaryRegistryError(f"overture_release_id failed syntax allow-list: {release_id!r}")

    matches = [r for r in rows if r.get("scope_id") == scope_id]
    if not matches:
        raise BoundaryRegistryError(
            f"no registry row for scope_id={scope_id!r} (unknown scope rejected)"
        )
    active = [r for r in matches if r.get("status") == "active"]
    if not active:
        raise BoundaryRegistryError(
            f"registry row for scope_id={scope_id!r} exists but is not active "
            f"(retired scope rejected)"
        )
    if len(active) > 1:
        raise BoundaryRegistryError(
            f"ambiguous registry: {len(active)} active rows for scope_id={scope_id!r}"
        )
    row = active[0]

    # Fail closed on a malformed active row (a missing required key must never be silently treated
    # as an empty/absent value in a security-sensitive registry).
    missing = _REQUIRED_KEYS - set(row)
    if missing:
        raise BoundaryRegistryError(
            f"registry row for scope_id={scope_id!r} is missing required keys: {sorted(missing)}"
        )

    pinned = str(row.get("overture_release_id", ""))
    if pinned != release_id:
        raise BoundaryRegistryError(
            f"dispatched release {release_id!r} != pinned {pinned!r} for scope {scope_id!r} "
            f"(the release is bound to the scope; edit the registry to refresh)"
        )
    country = str(row.get("country", ""))
    if not _COUNTRY_RE.match(country):
        raise BoundaryRegistryError(
            f"registry row for scope_id={scope_id!r} has invalid country={country!r} "
            f"(must be ISO 3166-1 alpha-2, uppercase)"
        )
    return row


def load_registry(path: str) -> list[dict]:
    import yaml  # deferred so the pure functions above stay stdlib-only + importable without PyYAML

    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    rows = (data or {}).get("scopes")
    if not isinstance(rows, list):
        raise BoundaryRegistryError("registry must have a top-level 'scopes' list")
    return rows


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="boundaries_registry")
    p.add_argument("--registry", default=".github/boundary-source-regions.yml")
    p.add_argument("--scope-id", required=True)
    p.add_argument("--release-id", required=True)
    # Optional: write the validated country (ISO alpha-2) to this file so the workflow can pull it
    # into $GITHUB_ENV for the DuckDB country predicate (the emit-to-file pattern regions.py uses
    # for --emit-scope-bounds-wkt).
    p.add_argument("--emit-country")
    a = p.parse_args(argv)
    try:
        rows = load_registry(a.registry)
        row = validate_boundary_scope(rows, scope_id=a.scope_id, release_id=a.release_id)
        if a.emit_country:
            with open(a.emit_country, "w", encoding="utf-8") as fh:
                fh.write(row["country"])
    except BoundaryRegistryError as e:
        print(f"::error::boundary registry validation failed: {e}", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"::error::cannot read registry {a.registry!r}: {e}", file=sys.stderr)
        return 1
    print(f"registry ok: scope_id={a.scope_id} release={a.release_id} country={row['country']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
