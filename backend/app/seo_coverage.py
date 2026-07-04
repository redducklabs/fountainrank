"""Per-scope SEO coverage report (#127 Slice 1e).

Spec: docs/specs/2026-07-04-seo-coverage-gate-design.md

Read-only. For each loaded scope (a subtype='country' place) it reports boundary counts, how many of
the scope's non-hidden fountains resolved to a city vs country-only, the city-assignment split by
subtype, coarse clusters of where city coverage is missing, an invalid-geometry health check, and a
ready/not-ready RECOMMENDATION the owner reads before the signoff migration. Plus a global tail for
fountains in no loaded country.

`compute_coverage` issues plain reads against the given ``bind`` (an ``AsyncConnection`` or
``AsyncSession``) — no writes, no commit. The CLI (app/imports/seo_coverage_cli) wraps a whole run
in a session advisory lock + one READ ONLY REPEATABLE READ transaction so a production report can
never certify a half-loaded state (see the CLI and the spec's Consistency contract). Counting is
over NON-HIDDEN fountains throughout — the population that drives the public fountain_count and SEO
surfaces.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field

from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession
from sqlalchemy.orm import aliased

from app.config import get_settings
from app.geo import latitude_of, longitude_of
from app.membership import DEFAULT_ELIGIBLE_CITY_SUBTYPES
from app.models import Fountain, PlaceBoundary

log = logging.getLogger(__name__)


@dataclass
class Cluster:
    lat: float
    lon: float
    count: int


@dataclass
class SubtypeShare:
    subtype: str
    count: int
    pct: float | None


@dataclass
class ScopeCoverage:
    country_code: str
    country_name: str
    city_routes_ready: bool
    effective_eligible_city_subtypes: list[str]
    eligible_from_config: bool
    boundary_counts: dict[str, int] = field(default_factory=dict)
    fountains_in_country: int = 0
    city_matched: int = 0
    country_only: int = 0
    city_coverage_pct: float | None = None
    city_assignment_by_subtype: list[SubtypeShare] = field(default_factory=list)
    top_unmatched_clusters: list[Cluster] = field(default_factory=list)
    invalid_boundaries: int = 0
    recommended_ready: bool = False


@dataclass
class CoverageReport:
    scopes: list[ScopeCoverage] = field(default_factory=list)
    unmatched_no_country: int = 0
    unmatched_no_country_clusters: list[Cluster] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _pct(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


async def compute_coverage(
    bind: AsyncConnection | AsyncSession, *, country: str | None = None
) -> CoverageReport:
    """Compute the coverage report from CURRENT DB state. Plain reads; no writes, no commit."""
    settings = get_settings()
    grid = settings.seo_coverage_grid_deg
    top_n = settings.seo_coverage_top_clusters

    # 1) The scopes: one per subtype='country' row (optionally filtered).
    country_q = select(PlaceBoundary.country_code, PlaceBoundary.name).where(
        PlaceBoundary.subtype == "country"
    )
    if country is not None:
        country_q = country_q.where(PlaceBoundary.country_code == country.lower())
    country_rows = (await bind.execute(country_q.order_by(PlaceBoundary.country_code))).all()

    # 2) place_scope_config: eligible sets + readiness, keyed by country_code.
    cfg = {
        r.country_code: (list(r.eligible_city_subtypes), r.city_routes_ready)
        for r in (
            await bind.execute(
                text(
                    "SELECT country_code, eligible_city_subtypes, city_routes_ready "
                    "FROM place_scope_config"
                )
            )
        ).all()
    }

    # 3) boundary counts by (country_code, subtype).
    bcounts: dict[str, dict[str, int]] = {}
    for r in (
        await bind.execute(
            text(
                "SELECT country_code, subtype, count(*) AS n FROM place_boundaries "
                "GROUP BY country_code, subtype"
            )
        )
    ).all():
        bcounts.setdefault(r.country_code, {})[r.subtype] = r.n

    # 4) invalid geometry health by country_code (boundary is geography -> ::geometry).
    invalid = {
        r.country_code: r.n
        for r in (
            await bind.execute(
                text(
                    "SELECT country_code, count(*) AS n FROM place_boundaries "
                    "WHERE NOT ST_IsValid(boundary::geometry) GROUP BY country_code"
                )
            )
        ).all()
    }

    # 5) per-scope fountain aggregates (non-hidden), keyed by the country place's country_code.
    agg = {
        r.cc: (r.in_country, r.city_matched, r.country_only)
        for r in (
            await bind.execute(
                text(
                    """
                    SELECT cpb.country_code AS cc,
                           count(*) AS in_country,
                           count(*) FILTER (WHERE f.city_place_id IS NOT NULL) AS city_matched,
                           count(*) FILTER (WHERE f.city_place_id IS NULL) AS country_only
                    FROM fountains f
                    JOIN place_boundaries cpb
                      ON cpb.id = f.country_place_id AND cpb.subtype = 'country'
                    WHERE f.is_hidden = false
                    GROUP BY cpb.country_code
                    """
                )
            )
        ).all()
    }

    # 6) city-assignment split by the city place's subtype, per country_code.
    by_subtype: dict[str, dict[str, int]] = {}
    for r in (
        await bind.execute(
            text(
                """
                SELECT cpb.country_code AS cc, citypb.subtype AS subtype, count(*) AS n
                FROM fountains f
                JOIN place_boundaries cpb ON cpb.id = f.country_place_id
                JOIN place_boundaries citypb ON citypb.id = f.city_place_id
                WHERE f.is_hidden = false AND f.city_place_id IS NOT NULL
                GROUP BY cpb.country_code, citypb.subtype
                """
            )
        )
    ).all():
        by_subtype.setdefault(r.cc, {})[r.subtype] = r.n

    # 7) unmatched clusters: country_only fountains, coarse-binned by grid, per country_code.
    #    Uses app.geo for lat/lon; casts to geometry for ST_SnapToGrid. The snapped-cell WKT is a
    #    deterministic tie-break so equal-count cells order stably (no flaky JSON / tests).
    country_pb = aliased(PlaceBoundary)
    cell = func.ST_AsText(func.ST_SnapToGrid(cast(Fountain.location, Geometry), grid))
    clusters: dict[str, list[Cluster]] = {}
    for r in (
        await bind.execute(
            select(
                country_pb.country_code.label("cc"),
                func.count().label("n"),
                func.avg(latitude_of(Fountain.location)).label("lat"),
                func.avg(longitude_of(Fountain.location)).label("lon"),
            )
            .select_from(Fountain)
            .join(country_pb, country_pb.id == Fountain.country_place_id)
            .where(Fountain.is_hidden.is_(False), Fountain.city_place_id.is_(None))
            .group_by(country_pb.country_code, cell)
            .order_by(country_pb.country_code, func.count().desc(), cell)
        )
    ).all():
        bucket = clusters.setdefault(r.cc, [])
        if len(bucket) < top_n:
            bucket.append(Cluster(lat=float(r.lat), lon=float(r.lon), count=int(r.n)))

    scopes: list[ScopeCoverage] = []
    for cr in country_rows:
        cc = cr.country_code
        eligible, ready = cfg.get(cc, (list(DEFAULT_ELIGIBLE_CITY_SUBTYPES), False))
        in_country, city_matched, country_only = agg.get(cc, (0, 0, 0))
        shares = [
            SubtypeShare(subtype=st, count=n, pct=_pct(n, city_matched))
            for st, n in sorted(by_subtype.get(cc, {}).items())
        ]
        pct = _pct(city_matched, in_country)
        scopes.append(
            ScopeCoverage(
                country_code=cc,
                country_name=cr.name,
                city_routes_ready=ready,
                effective_eligible_city_subtypes=eligible,
                eligible_from_config=cc in cfg,
                boundary_counts=bcounts.get(cc, {}),
                fountains_in_country=in_country,
                city_matched=city_matched,
                country_only=country_only,
                city_coverage_pct=pct,
                city_assignment_by_subtype=shares,
                top_unmatched_clusters=clusters.get(cc, []),
                invalid_boundaries=invalid.get(cc, 0),
                recommended_ready=pct is not None and pct >= settings.seo_coverage_ready_pct,
            )
        )

    # 8) global tail: non-hidden fountains in NO loaded country.
    unmatched = (
        await bind.execute(
            text(
                "SELECT count(*) AS n FROM fountains "
                "WHERE is_hidden = false AND country_place_id IS NULL"
            )
        )
    ).scalar_one()
    gclusters: list[Cluster] = []
    for r in (
        await bind.execute(
            select(
                func.count().label("n"),
                func.avg(latitude_of(Fountain.location)).label("lat"),
                func.avg(longitude_of(Fountain.location)).label("lon"),
            )
            .where(Fountain.is_hidden.is_(False), Fountain.country_place_id.is_(None))
            .group_by(cell)
            .order_by(func.count().desc(), cell)
        )
    ).all():
        if len(gclusters) < top_n:
            gclusters.append(Cluster(lat=float(r.lat), lon=float(r.lon), count=int(r.n)))

    report = CoverageReport(
        scopes=scopes,
        unmatched_no_country=int(unmatched),
        unmatched_no_country_clusters=gclusters,
    )
    log.info(
        "seo_coverage_computed",
        extra={"scopes": len(scopes), "unmatched_no_country": report.unmatched_no_country},
    )
    return report
