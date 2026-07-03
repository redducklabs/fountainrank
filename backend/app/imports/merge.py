"""DB merge service for OSM candidates. Idempotent, concurrency-safe, auditable.

One transaction per call. A single advisory lock (shared with POST /fountains)
serializes the run's spatial check-then-write against concurrent user adds. Every
candidate yields a staging row; every MATERIAL production mutation yields a durable
event (insert / provenance_attach / provenance_update / update_location / mark_removed).
Provenance freshness fields (last_seen_at, last_import_run_id) advance every run as
bookkeeping — not event-logged, not rolled back.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.geo import point_geography
from app.imports.osm import OsmCandidate
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.membership import refresh_all_memberships
from app.models import (
    Fountain,
    FountainImportEvent,
    FountainProvenance,
    OsmImportCandidate,
    OsmImportRun,
)

log = logging.getLogger(__name__)


@dataclass
class RunScope:
    source_system: str
    source_dataset: str
    source_build_id: str
    source_label: str
    scope_id: str
    scope_bounds_wkt: str | None


@dataclass
class RunSummary:
    run_id: uuid.UUID
    candidate_count: int = 0
    inserted_count: int = 0
    updated_count: int = 0
    matched_existing_count: int = 0
    provenance_attached_count: int = 0
    skipped_count: int = 0
    removed_count: int = 0
    review_flagged_count: int = 0
    dry_run: bool = False


async def merge_candidates(
    session: AsyncSession,
    *,
    scope: RunScope,
    candidates: list[OsmCandidate],
    skipped: list[tuple[str, str]],
    dry_run: bool,
) -> RunSummary:
    now = datetime.now(tz=UTC)
    run = OsmImportRun(
        status="running",
        dry_run=dry_run,
        source_system=scope.source_system,
        source_dataset=scope.source_dataset,
        source_build_id=scope.source_build_id,
        source_label=scope.source_label,
        scope_id=scope.scope_id,
        scope_bounds=(
            func.ST_GeogFromText(scope.scope_bounds_wkt)
            if scope.scope_bounds_wkt is not None
            else None
        ),
    )
    session.add(run)
    await session.flush()  # assign run.id
    summary = RunSummary(run_id=run.id, dry_run=dry_run)

    if not dry_run:
        await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))

    settings = get_settings()
    for cand in candidates:
        summary.candidate_count += 1
        action, matched_id = await _merge_one(
            session,
            run=run,
            cand=cand,
            scope=scope,
            now=now,
            dry_run=dry_run,
            summary=summary,
            settings=settings,
        )
        session.add(
            OsmImportCandidate(
                run_id=run.id,
                source_external_id=cand.source_external_id,
                osm_type=cand.osm_type,
                osm_id=cand.osm_id,
                location=point_geography(cand.latitude, cand.longitude),
                tags=cand.tags,
                confidence=cand.confidence,
                skip_reason=None,
                matched_fountain_id=matched_id,
                action=action,
            )
        )

    for ext_id, reason in skipped:
        summary.skipped_count += 1
        session.add(
            OsmImportCandidate(
                run_id=run.id,
                source_external_id=ext_id,
                osm_type=None,
                osm_id=None,
                location=None,
                tags=None,
                confidence=None,
                skip_reason=reason,
                matched_fountain_id=None,
                action="skip",
            )
        )

    if not dry_run:
        await _mark_scope_removals(
            session,
            run=run,
            scope=scope,
            seen_ext_ids={c.source_external_id for c in candidates},
            now=now,
            summary=summary,
        )
        # An import doesn't change boundaries, but its inserts/moves change which fountains fall
        # in which place. Re-derive precomputed membership + counts (+ is_canonical/parent_id,
        # cheaply idempotent) once, set-based, over the whole DB (#127 Slice 1d). flush() first so
        # the set-based UPDATE sees this run's freshly inserted/moved fountain locations.
        await session.flush()
        await refresh_all_memberships(session)

    run.status = "dry_run" if dry_run else "completed"
    run.finished_at = datetime.now(tz=UTC)
    run.candidate_count = summary.candidate_count
    run.inserted_count = summary.inserted_count
    run.updated_count = summary.updated_count
    run.matched_existing_count = summary.matched_existing_count
    run.provenance_attached_count = summary.provenance_attached_count
    run.skipped_count = summary.skipped_count
    run.removed_count = summary.removed_count
    run.review_flagged_count = summary.review_flagged_count
    await session.flush()
    log.info(
        "osm_import_run_complete",
        extra={
            "run_id": str(run.id),
            "dry_run": dry_run,
            "scope_id": scope.scope_id,
            "candidates": summary.candidate_count,
            "inserted": summary.inserted_count,
            "updated": summary.updated_count,
            "provenance_attached": summary.provenance_attached_count,
            "skipped": summary.skipped_count,
            "removed": summary.removed_count,
            "review_flagged": summary.review_flagged_count,
        },
    )
    return summary


async def _merge_one(
    session: AsyncSession, *, run, cand, scope, now, dry_run, summary, settings
) -> tuple[str, uuid.UUID | None]:
    # Returns (action, matched_fountain_id) so the staging row records which fountain matched.
    prov = (
        await session.execute(
            select(FountainProvenance).where(
                FountainProvenance.source_system == scope.source_system,
                FountainProvenance.source_external_id == cand.source_external_id,
            )
        )
    ).scalar_one_or_none()
    if prov is not None:
        summary.matched_existing_count += 1
        if dry_run:
            return "update", prov.fountain_id
        fountain = (
            await session.execute(
                select(Fountain).where(Fountain.id == prov.fountain_id).with_for_update()
            )
        ).scalar_one()
        changed, prior = _refresh_provenance(prov, cand, run, now, scope)
        if changed:
            session.add(
                FountainImportEvent(
                    run_id=run.id,
                    fountain_id=prov.fountain_id,
                    provenance_id=prov.id,
                    operation="provenance_update",
                    prior_values=prior,
                )
            )
        moved = await _maybe_move(session, fountain, cand, run, settings, summary)
        if changed or moved:
            summary.updated_count += 1
        return "update", prov.fountain_id

    point = point_geography(cand.latitude, cand.longitude)
    match = (
        await session.execute(
            select(Fountain.id)
            .where(Fountain.is_hidden.is_(False))
            .where(func.ST_DWithin(Fountain.location, point, settings.duplicate_threshold_m))
            .order_by(func.ST_Distance(Fountain.location, point))
            .limit(1)
        )
    ).scalar_one_or_none()
    if match is not None:
        summary.provenance_attached_count += 1
        if dry_run:
            return "match_provenance", match
        fountain = (
            await session.execute(select(Fountain).where(Fountain.id == match).with_for_update())
        ).scalar_one()
        new_prov = _new_provenance(match, cand, run, now, scope)
        session.add(new_prov)
        await session.flush()
        session.add(
            FountainImportEvent(
                run_id=run.id,
                fountain_id=match,
                provenance_id=new_prov.id,
                operation="provenance_attach",
                prior_values=None,
            )
        )
        # Apply the movement rule (spec §6): _maybe_move only moves imported-only, unrated
        # rows; it never moves a user-created or rated fountain.
        if await _maybe_move(session, fountain, cand, run, settings, summary):
            summary.updated_count += 1
        return "match_provenance", match

    summary.inserted_count += 1
    if dry_run:
        return "insert", None
    fountain = Fountain(
        location=point, is_working=True, created_source="osm", added_by_user_id=None
    )
    session.add(fountain)
    await session.flush()
    new_prov = _new_provenance(fountain.id, cand, run, now, scope)
    session.add(new_prov)
    await session.flush()
    session.add(
        FountainImportEvent(
            run_id=run.id,
            fountain_id=fountain.id,
            provenance_id=new_prov.id,
            operation="insert",
            prior_values=None,
        )
    )
    return "insert", fountain.id


async def _maybe_move(session, fountain, cand, run, settings, summary) -> bool:
    # The fountain row is already locked FOR UPDATE by the caller. Compute distance and the
    # prior location via the column (by id) — robust vs. using a loaded WKBElement literal.
    point = point_geography(cand.latitude, cand.longitude)
    dist = (
        await session.execute(
            select(func.ST_Distance(Fountain.location, point)).where(Fountain.id == fountain.id)
        )
    ).scalar_one()
    if dist is None or dist == 0:
        return False
    # Never auto-move user-created or rated rows; flag large moves for review.
    if fountain.created_source != "osm" or fountain.rating_count > 0:
        if dist >= settings.osm_move_review_min_m:
            summary.review_flagged_count += 1
        return False
    if dist <= settings.osm_move_small_max_m:
        prior = (
            await session.execute(
                select(func.ST_AsText(Fountain.location)).where(Fountain.id == fountain.id)
            )
        ).scalar_one()
        fountain.location = point
        session.add(
            FountainImportEvent(
                run_id=run.id,
                fountain_id=fountain.id,
                provenance_id=None,
                operation="update_location",
                prior_values={"location_wkt": prior},
            )
        )
        return True
    if dist >= settings.osm_move_review_min_m:
        summary.review_flagged_count += 1
    return False


async def _mark_scope_removals(session, *, run, scope, seen_ext_ids, now, summary) -> None:
    stmt = select(FountainProvenance).where(
        FountainProvenance.source_system == scope.source_system,
        FountainProvenance.scope_id == scope.scope_id,
        FountainProvenance.removed_at.is_(None),
    )
    if seen_ext_ids:
        stmt = stmt.where(FountainProvenance.source_external_id.not_in(seen_ext_ids))
    rows = (await session.execute(stmt)).scalars().all()
    for prov in rows:
        # Scope-bounds guard: a sub-region refresh can't remove what it didn't cover.
        if scope.scope_bounds_wkt is not None:
            inside = (
                await session.execute(
                    select(
                        func.ST_Covers(
                            func.ST_GeogFromText(scope.scope_bounds_wkt),
                            select(Fountain.location)
                            .where(Fountain.id == prov.fountain_id)
                            .scalar_subquery(),
                        )
                    )
                )
            ).scalar_one()
            if not inside:
                continue
        prior_last_run = str(prov.last_import_run_id)
        prov.removed_at = now
        prov.last_import_run_id = run.id
        summary.removed_count += 1
        session.add(
            FountainImportEvent(
                run_id=run.id,
                fountain_id=prov.fountain_id,
                provenance_id=prov.id,
                operation="mark_removed",
                prior_values={"removed_at": None, "last_import_run_id": prior_last_run},
            )
        )


def _new_provenance(fountain_id, cand, run, now, scope) -> FountainProvenance:
    return FountainProvenance(
        fountain_id=fountain_id,
        source_system=scope.source_system,
        source_dataset=scope.source_dataset,
        scope_id=scope.scope_id,
        source_external_id=cand.source_external_id,
        osm_type=cand.osm_type,
        osm_id=cand.osm_id,
        source_tags=cand.tags,
        confidence=cand.confidence,
        geometry_kind=cand.geometry_kind,
        first_seen_at=now,
        last_seen_at=now,
        removed_at=None,
        first_import_run_id=run.id,
        last_import_run_id=run.id,
    )


def _refresh_provenance(prov, cand, run, now, scope) -> tuple[bool, dict | None]:
    # `changed` (material) drives whether a provenance_update event is emitted. freshness
    # fields (last_seen_at, last_import_run_id) advance every run, so a PURE freshness touch
    # emits no event and is never rolled back. But when a material event IS emitted, its
    # prior_values capture the freshness fields too so rollback fully reverses that run.
    changed = (
        prov.source_tags != cand.tags
        or prov.confidence != cand.confidence
        or prov.removed_at is not None
        or prov.scope_id != scope.scope_id
        or prov.source_dataset != scope.source_dataset
    )
    prior = None
    if changed:
        prior = {
            "source_tags": prov.source_tags,
            "confidence": prov.confidence,
            "removed_at": prov.removed_at.isoformat() if prov.removed_at else None,
            "scope_id": prov.scope_id,
            "source_dataset": prov.source_dataset,
            "last_seen_at": prov.last_seen_at.isoformat() if prov.last_seen_at else None,
            "last_import_run_id": str(prov.last_import_run_id),
        }
    prov.source_tags = cand.tags
    prov.confidence = cand.confidence
    prov.last_seen_at = now
    prov.removed_at = None
    prov.last_import_run_id = run.id
    prov.source_dataset = scope.source_dataset
    prov.scope_id = scope.scope_id
    return changed, prior


async def rollback_run(session: AsyncSession, run_id: uuid.UUID) -> int:
    # Serialize against concurrent adds/imports and lock each affected row before
    # inspecting/mutating it. Never deletes user rows or ratings.
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    events = (
        (
            await session.execute(
                select(FountainImportEvent)
                .where(FountainImportEvent.run_id == run_id)
                .order_by(FountainImportEvent.created_at.desc())  # reverse order
            )
        )
        .scalars()
        .all()
    )
    affected = 0
    for ev in events:
        if ev.operation == "insert" and ev.fountain_id is not None:
            f = (
                await session.execute(
                    select(Fountain).where(Fountain.id == ev.fountain_id).with_for_update()
                )
            ).scalar_one_or_none()
            if f is not None:
                f.is_hidden = True  # hide, never delete — preserves any user ratings
                affected += 1
        elif ev.operation == "update_location" and ev.prior_values and ev.fountain_id is not None:
            f = (
                await session.execute(
                    select(Fountain).where(Fountain.id == ev.fountain_id).with_for_update()
                )
            ).scalar_one_or_none()
            if f is not None:
                f.location = func.ST_GeogFromText(ev.prior_values["location_wkt"])
                affected += 1
        elif ev.operation == "provenance_attach" and ev.provenance_id is not None:
            prov = (
                await session.execute(
                    select(FountainProvenance)
                    .where(FountainProvenance.id == ev.provenance_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if prov is not None:
                await session.delete(prov)  # detach OSM provenance; user fountain untouched
                affected += 1
        elif (
            ev.operation == "provenance_update" and ev.provenance_id is not None and ev.prior_values
        ):
            prov = (
                await session.execute(
                    select(FountainProvenance)
                    .where(FountainProvenance.id == ev.provenance_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if prov is not None:
                prov.source_tags = ev.prior_values.get("source_tags")
                prov.confidence = ev.prior_values.get("confidence")
                rv = ev.prior_values.get("removed_at")
                prov.removed_at = datetime.fromisoformat(rv) if rv else None
                prov.scope_id = ev.prior_values.get("scope_id")
                prov.source_dataset = ev.prior_values.get("source_dataset")
                ls = ev.prior_values.get("last_seen_at")
                if ls:
                    prov.last_seen_at = datetime.fromisoformat(ls)
                lr = ev.prior_values.get("last_import_run_id")
                if lr:
                    prov.last_import_run_id = uuid.UUID(lr)
                affected += 1
        elif ev.operation == "mark_removed" and ev.provenance_id is not None:
            prov = (
                await session.execute(
                    select(FountainProvenance)
                    .where(FountainProvenance.id == ev.provenance_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if prov is not None:
                prov.removed_at = None
                lr = ev.prior_values.get("last_import_run_id")
                if lr:
                    prov.last_import_run_id = uuid.UUID(lr)
                affected += 1
    await session.flush()
    if affected:
        # A rollback hides inserted fountains and reverts moved ones — both change which fountains
        # count and where they fall. Re-derive membership + counts so fountain_count never keeps
        # counting a hidden rolled-back row or a reverted location (#127 Slice 1d).
        await refresh_all_memberships(session)
    log.info("osm_import_run_rolled_back", extra={"run_id": str(run_id), "affected": affected})
    return affected
