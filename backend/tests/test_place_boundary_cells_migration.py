"""Migration 0016 — place_boundary_cells (membership perf hardening, #127).

Subdivided pieces of place_boundaries polygons so country-scale point-in-polygon hits a GiST index
of small cells instead of one 136k-vertex country polygon. Validates the schema the membership
rewrite depends on: NOT NULL columns, the GiST index on ``geom``, the btree index on ``place_id``,
and the ``ON DELETE CASCADE`` FK to ``place_boundaries``.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text


async def _indexes(session) -> dict[str, str]:
    """{index_name: index_definition} for place_boundary_cells (from pg_indexes)."""
    rows = await session.execute(
        text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'place_boundary_cells'")
    )
    return dict(rows.all())


@pytest.mark.asyncio
async def test_columns_and_nullability(session):
    cols = dict(
        (
            await session.execute(
                text(
                    "SELECT column_name, is_nullable FROM information_schema.columns "
                    "WHERE table_name='place_boundary_cells'"
                )
            )
        ).all()
    )
    for c in ("id", "place_id", "geom"):
        assert cols.get(c) == "NO", f"expected {c} NOT NULL, got {cols.get(c)!r}"


@pytest.mark.asyncio
async def test_geom_gist_index(session):
    idx = await _indexes(session)
    # GeoAlchemy2 names the spatial index idx_<table>_<column>.
    assert "idx_place_boundary_cells_geom" in idx
    assert "gist" in idx["idx_place_boundary_cells_geom"].lower()


@pytest.mark.asyncio
async def test_place_id_btree_index(session):
    idx = await _indexes(session)
    assert "ix_place_boundary_cells_place_id" in idx
    assert "place_id" in idx["ix_place_boundary_cells_place_id"].lower()


@pytest.mark.asyncio
async def test_fk_cascade_to_place_boundaries(session):
    """The FK is ON DELETE CASCADE: deleting a boundary deletes its cells (cells are a rebuildable
    derivative, never allowed to dangle)."""
    fk = (
        await session.execute(
            text(
                "SELECT confdeltype FROM pg_constraint "
                "WHERE conname='fk_place_boundary_cells_place'"
            )
        )
    ).scalar_one_or_none()
    # confdeltype is a "char" column; asyncpg returns it as bytes (b'c'). 'c' = CASCADE.
    if isinstance(fk, bytes):
        fk = fk.decode()
    assert fk == "c", f"expected ON DELETE CASCADE ('c'), got {fk!r}"

    oid = f"ov-{uuid.uuid4()}"
    place_id = (
        await session.execute(
            text(
                """
                INSERT INTO place_boundaries
                    (id, overture_id, subtype, class, name, country_code, slug,
                     is_canonical, fountain_count, boundary, created_at, updated_at)
                VALUES (gen_random_uuid(), :oid, 'locality', 'land', 'Cellville', 'xx',
                        'cellville', false, 0,
                        ST_Multi(
                            ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326)
                        )::geography,
                        now(), now())
                RETURNING id
                """
            ),
            {"oid": oid},
        )
    ).scalar_one()
    await session.execute(
        text(
            "INSERT INTO place_boundary_cells (id, place_id, geom) VALUES "
            "(gen_random_uuid(), :pid, ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326))"
        ),
        {"pid": place_id},
    )
    assert (
        await session.execute(
            text("SELECT count(*) FROM place_boundary_cells WHERE place_id = :pid"),
            {"pid": place_id},
        )
    ).scalar_one() == 1

    await session.execute(text("DELETE FROM place_boundaries WHERE id = :pid"), {"pid": place_id})
    assert (
        await session.execute(
            text("SELECT count(*) FROM place_boundary_cells WHERE place_id = :pid"),
            {"pid": place_id},
        )
    ).scalar_one() == 0  # cascade removed the cell
