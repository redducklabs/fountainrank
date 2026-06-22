from app.main import app


def test_openapi_has_typed_health_schemas():
    schema = app.openapi()
    components = schema["components"]["schemas"]

    assert "HealthResponse" in components
    assert components["HealthResponse"]["properties"]["status"]["type"] == "string"

    assert "ReadyzResponse" in components
    props = components["ReadyzResponse"]["properties"]
    assert props["status"]["type"] == "string"
    assert props["postgis_version"]["type"] == "string"
    assert props["sf_to_nyc_m"]["type"] == "number"


def test_openapi_exposes_phase1_contract():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/rating-types" in paths
    assert "/api/v1/fountains" in paths
    assert "/api/v1/fountains/bbox" in paths
    assert "/api/v1/fountains/{fountain_id}" in paths
    assert "/api/v1/fountains/{fountain_id}/ratings" in paths

    components = schema["components"]["schemas"]
    for name in ("FountainDetail", "FountainPin", "AddFountainRequest", "RatingTypeOut"):
        assert name in components


def test_openapi_exposes_me_endpoint():
    schema = app.openapi()
    assert "/api/v1/me" in schema["paths"]
    assert "MeResponse" in schema["components"]["schemas"]


def test_openapi_exposes_me_sync_endpoint():
    schema = app.openapi()
    op = schema["paths"]["/api/v1/me/sync"]["post"]
    assert "SyncProfileRequest" in schema["components"]["schemas"]
    ref = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/MeResponse")


def test_openapi_exposes_contribution_data_contract():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/attribute-types" in paths
    assert "/api/v1/fountains/{fountain_id}/attributes" in paths
    assert "/api/v1/me/contributions" in paths

    components = schema["components"]["schemas"]
    for name in (
        "AttributeTypeOut",
        "AttributeConsensusOut",
        "ObserveAttributesRequest",
        "MeContributionsOut",
        "ContributionStatsOut",
    ):
        assert name in components

    # FountainDetail now carries the attribute consensus list.
    assert "attributes" in components["FountainDetail"]["properties"]


def test_openapi_exposes_conditions_contract():
    schema = app.openapi()
    assert "/api/v1/fountains/{fountain_id}/conditions" in schema["paths"]
    components = schema["components"]["schemas"]
    assert "ConditionReportRequest" in components
    # current_status / last_verified_at surfaced on pins + detail.
    assert "current_status" in components["FountainPin"]["properties"]
    assert "current_status" in components["FountainDetail"]["properties"]
