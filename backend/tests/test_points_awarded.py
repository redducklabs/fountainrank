"""#204: every contribution write reports what it ACTUALLY awarded — 0 when it deduped.

The bug this locks down: the API returned no award, so both clients guessed
(`chosen.length * CONTRIBUTION_POINTS.rate`) and celebrated a full award on every re-submit.
The ledger was always correct; the reporting was not.
"""

import pytest

pytestmark = pytest.mark.asyncio

LOC = {"latitude": 37.7749, "longitude": -122.4194}


async def _new_fountain(client) -> str:
    res = await client.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def test_rating_awards_then_zero_on_rerate(client):
    """The reported #204 symptom: re-rating must report 0, not a fresh full award."""
    fid = await _new_fountain(client)
    body = {"ratings": [{"rating_type_id": 1, "stars": 5}, {"rating_type_id": 2, "stars": 4}]}

    first = await client.post(f"/api/v1/fountains/{fid}/ratings", json=body)
    assert first.status_code == 200
    assert first.json()["points_awarded"] == 9  # 2 dims x rate@2 + first_rating_bonus@5

    again = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 1}, {"rating_type_id": 2, "stars": 1}]},
    )
    assert again.status_code == 200
    assert again.json()["points_awarded"] == 0


async def test_rating_partial_award_counts_only_the_new_dimension(client):
    fid = await _new_fountain(client)
    await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    res = await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 3}, {"rating_type_id": 2, "stars": 4}]},
    )
    assert res.json()["points_awarded"] == 2  # only rating_type_id 2 is new


async def test_attributes_award_then_zero_on_reobserve(client):
    fid = await _new_fountain(client)
    body = {"observations": [{"attribute_type_id": 1, "value": "yes"}]}
    first = await client.post(f"/api/v1/fountains/{fid}/attributes", json=body)
    assert first.json()["points_awarded"] == 2
    again = await client.post(f"/api/v1/fountains/{fid}/attributes", json=body)
    assert again.json()["points_awarded"] == 0


async def test_second_note_awards_zero(client):
    """`dk_note` is once-ever per (user, fountain) — a 2nd note earns nothing."""
    fid = await _new_fountain(client)
    first = await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "first"})
    assert first.json()["points_awarded"] == 2
    again = await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "second"})
    assert again.json()["points_awarded"] == 0


async def test_condition_sets_both_canonical_and_legacy_fields(client):
    fid = await _new_fountain(client)
    data = (
        await client.post(f"/api/v1/fountains/{fid}/conditions", json={"status": "working"})
    ).json()
    assert data["points_awarded"] == 3
    # Deprecated-compat: already-released mobile clients still read this. One value, two fields —
    # never computed separately, so they cannot drift.
    assert data["condition_points_awarded"] == 3


async def test_condition_inside_the_24h_window_awards_zero(client):
    """#124's window, now reported through the canonical field too."""
    fid = await _new_fountain(client)
    await client.post(f"/api/v1/fountains/{fid}/conditions", json={"status": "working"})
    again = await client.post(f"/api/v1/fountains/{fid}/conditions", json={"status": "working"})
    assert again.json()["points_awarded"] == 0
    assert again.json()["condition_points_awarded"] == 0


async def test_add_fountain_reports_its_award(client):
    """The add-fountain award was never visible to a client before (#204)."""
    res = await client.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
    # add_fountain@10 + first_fountain_bonus@5 + first_in_area_bonus@15 on a clean DB.
    assert res.json()["points_awarded"] == 30


async def test_get_detail_reports_no_award(client):
    """`points_awarded` is a WRITE-response field — a GET must never claim an award."""
    fid = await _new_fountain(client)
    assert (await client.get(f"/api/v1/fountains/{fid}")).json()["points_awarded"] is None
