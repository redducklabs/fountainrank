async def test_readyz_reports_postgis(client):
    resp = await client.get("/readyz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["postgis_version"]  # non-empty version string, e.g. "3.5 USE_GEOS=1 ..."
    # SF (-122.4194, 37.7749) -> NYC (-73.9857, 40.7484) geodesic ~4,129 km.
    assert 4_000_000 < body["sf_to_nyc_m"] < 4_300_000
