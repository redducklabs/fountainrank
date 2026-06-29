import pytest
from sqlalchemy import text


# ---------------- migration 0011: fountains (location::geometry) GiST index (#113) ----------------
@pytest.mark.asyncio
async def test_location_geometry_gist_index_present(session):
    idx = dict(
        (
            await session.execute(
                text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='fountains'")
            )
        ).all()
    )
    assert "ix_fountains_location_geometry" in idx
    definition = idx["ix_fountains_location_geometry"].lower()
    # GiST, over the geometry CAST of the geography column (the near-global bbox
    # fallback path) — distinct from the geography index idx_fountains_location.
    assert "gist" in definition
    assert "::geometry" in definition  # the cast expression, not just any "geometry"
    assert "idx_fountains_location" in idx  # the geography GiST index still exists
