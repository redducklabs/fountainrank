"""Slice 1a — place_boundaries table (crawlable SEO pages, #127).

Schema per spec §5 as amended by §11.4/§11.6 (Overture Divisions source):
identity key is the Overture GERS `overture_id` (unique); `osm_type`/`osm_id` are
nullable provenance; `subtype` + `class` added; `admin_level` nullable; boundary is
`Geography(MULTIPOLYGON,4326)` GIST-indexed; the public-namespace uniqueness is a
partial unique index on `(country_code, slug) WHERE is_canonical`.
"""

import uuid

import pytest
from sqlalchemy import select, text


async def _indexes(session) -> dict[str, str]:
    """{index_name: index_definition} for place_boundaries (from pg_indexes)."""
    rows = await session.execute(
        text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'place_boundaries'")
    )
    return dict(rows.all())


@pytest.mark.asyncio
async def test_columns_and_nullability(session):
    cols = dict(
        (
            await session.execute(
                text(
                    "SELECT column_name, is_nullable FROM information_schema.columns "
                    "WHERE table_name='place_boundaries'"
                )
            )
        ).all()
    )
    # NOT NULL columns
    for c in (
        "id",
        "overture_id",
        "subtype",
        "class",
        "name",
        "country_code",
        "slug",
        "is_canonical",
        "boundary",
        "created_at",
        "updated_at",
    ):
        assert cols.get(c) == "NO", f"expected {c} NOT NULL, got {cols.get(c)!r}"
    # Nullable columns (Overture-normalized / best-effort provenance / containment-derived)
    for c in ("admin_level", "osm_type", "osm_id", "parent_id"):
        assert cols.get(c) == "YES", f"expected {c} nullable, got {cols.get(c)!r}"


@pytest.mark.asyncio
async def test_overture_id_unique_index(session):
    idx = await _indexes(session)
    assert "uq_place_boundaries_overture_id" in idx
    assert "unique" in idx["uq_place_boundaries_overture_id"].lower()


@pytest.mark.asyncio
async def test_boundary_gist_index(session):
    idx = await _indexes(session)
    # GeoAlchemy2 names the spatial index idx_<table>_<column>.
    assert "idx_place_boundaries_boundary" in idx
    assert "gist" in idx["idx_place_boundaries_boundary"].lower()


@pytest.mark.asyncio
async def test_partial_unique_country_slug_canonical(session):
    idx = await _indexes(session)
    assert "uq_place_boundaries_country_slug_canonical" in idx
    definition = idx["uq_place_boundaries_country_slug_canonical"].lower()
    assert "unique" in definition
    assert "country_code" in definition and "slug" in definition
    # Partial predicate — matches the public URL, which omits admin_level (spec §11.5).
    assert "is_canonical" in definition
    assert "where" in definition


@pytest.mark.asyncio
async def test_self_fk_parent(session):
    fks = set(
        (
            await session.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE contype='f' "
                    "AND conrelid='place_boundaries'::regclass"
                )
            )
        )
        .scalars()
        .all()
    )
    assert "fk_place_boundaries_parent" in fks


@pytest.mark.asyncio
async def test_partial_unique_allows_multiple_non_canonical(session):
    """The (country_code, slug) uniqueness applies ONLY to is_canonical rows: the same
    slug may repeat across non-canonical candidates in a country (spec §11.5 canonical
    selection retains non-canonical candidates)."""
    from app.models import PlaceBoundary

    poly = "SRID=4326;MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0)))"
    # Two non-canonical rows sharing (country_code, slug) — allowed.
    session.add_all(
        [
            PlaceBoundary(
                overture_id=f"ov-{uuid.uuid4()}",
                subtype="county",
                place_class="land",
                name="Dup A",
                country_code="xx",
                slug="dup-town",
                is_canonical=False,
                boundary=poly,
            ),
            PlaceBoundary(
                overture_id=f"ov-{uuid.uuid4()}",
                subtype="locality",
                place_class="land",
                name="Dup B",
                country_code="xx",
                slug="dup-town",
                is_canonical=False,
                boundary=poly,
            ),
        ]
    )
    await session.commit()  # must NOT raise (partial index excludes non-canonical)


@pytest.mark.asyncio
async def test_model_round_trip_and_st_covers(session):
    from app.models import PlaceBoundary

    oid = f"ov-{uuid.uuid4()}"
    pb = PlaceBoundary(
        overture_id=oid,
        subtype="country",
        place_class="land",
        admin_level=0,
        osm_type="relation",
        osm_id=2171347,
        name="Testland",
        country_code="xx",
        slug="testland",
        is_canonical=True,
        boundary="SRID=4326;MULTIPOLYGON(((0 0,2 0,2 2,0 2,0 0)))",
    )
    session.add(pb)
    await session.commit()

    # Read back through the ORM.
    got = (
        await session.execute(select(PlaceBoundary).where(PlaceBoundary.overture_id == oid))
    ).scalar_one()
    assert got.name == "Testland"
    assert got.subtype == "country"
    assert got.place_class == "land"
    assert got.osm_type == "relation" and got.osm_id == 2171347
    assert got.parent_id is None

    # Point-in-polygon membership (the whole point of the boundary): (lon=1, lat=1) inside.
    covered = (
        await session.execute(
            text(
                "SELECT ST_Covers(boundary, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography) "
                "FROM place_boundaries WHERE overture_id = :oid"
            ),
            {"lng": 1.0, "lat": 1.0, "oid": oid},
        )
    ).scalar_one()
    assert covered is True
