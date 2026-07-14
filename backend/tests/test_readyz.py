import pytest

from app.routers.health import _revision_is_at_or_ahead


class _FakeRevision:
    def __init__(self, revision: str):
        self.revision = revision


class _FakeScript:
    def __init__(self, chain: dict[str, list[str]]):
        self.chain = chain

    def iterate_revisions(self, db_revision: str, base: str):
        assert base == "base"
        if db_revision not in self.chain:
            from alembic.script.revision import ResolutionError

            raise ResolutionError("unknown revision", db_revision)
        return [_FakeRevision(revision) for revision in self.chain[db_revision]]


async def test_readyz_reports_postgis(client):
    resp = await client.get("/readyz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["schema_revision"]
    assert body["postgis_version"]  # non-empty version string, e.g. "3.5 USE_GEOS=1 ..."
    # SF (-122.4194, 37.7749) -> NYC (-73.9857, 40.7484) geodesic ~4,129 km.
    assert 4_000_000 < body["sf_to_nyc_m"] < 4_300_000


@pytest.mark.parametrize(
    ("db_revision", "image_head", "expected"),
    [
        ("0025_place_hierarchy", "0025_place_hierarchy", True),
        ("0025_place_hierarchy", "0024_write_attempts", True),
        ("0024_write_attempts", "0025_place_hierarchy", False),
        ("unknown", "0025_place_hierarchy", False),
    ],
)
def test_readyz_revision_gate_is_rollback_safe(db_revision, image_head, expected):
    script = _FakeScript(
        {
            "0025_place_hierarchy": [
                "0025_place_hierarchy",
                "0024_write_attempts",
                "0023_ratings_is_proximate",
            ],
            "0024_write_attempts": ["0024_write_attempts", "0023_ratings_is_proximate"],
        }
    )
    assert (
        _revision_is_at_or_ahead(script, db_revision=db_revision, image_head=image_head) is expected
    )
