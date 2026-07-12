"""#204: pre-submit earnability comes from the dedup LEDGER, not from content rows.

The dedup key is permanent; content is not. A hidden note, a hidden attribute observation, or a
deleted first photo all leave the key spent while the content disappears — so a content-derived
preview would promise points the insert will not award. These are the regressions for that.

`ViewerAwardState` is an as-of-read HINT: the POST's `points_awarded` is authoritative and always
wins (see `test_stale_hint_loses_to_the_insert`).
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

import app.routers.photos as photos_module
from app.auth import get_optional_user
from app.images import ProcessedImage
from app.main import app

pytestmark = pytest.mark.asyncio

LOC = {"latitude": 37.7749, "longitude": -122.4194}
_FILE = {"file": ("photo.jpg", b"raw-image-bytes", "image/jpeg")}


class _FakeStorage:
    def put_object(self, key: str, data: bytes, content_type: str) -> None:
        pass

    def delete_object(self, key: str) -> None:
        pass


@pytest.fixture
def storage(monkeypatch) -> _FakeStorage:
    s = _FakeStorage()
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: s)
    return s


@pytest.fixture
def process(monkeypatch) -> None:
    result = ProcessedImage(full=b"FULL-JPEG-BYTES", thumb=b"THUMB", width=1024, height=768)
    monkeypatch.setattr(photos_module, "process_image", lambda raw: result)


async def _new_fountain(client) -> str:
    res = await client.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _detail_as_viewer(client, test_user, fid) -> dict:
    """An AUTHENTICATED detail GET.

    The detail route resolves its viewer via `get_optional_user`, NOT the `get_current_user` the
    `client` fixture overrides — and the fixture sends no auth header. Without this override the GET
    is anonymous. (Same pattern as test_conditions_api.py.)
    """
    app.dependency_overrides[get_optional_user] = lambda: test_user
    try:
        res = await client.get(f"/api/v1/fountains/{fid}")
        assert res.status_code == 200, res.text
        return res.json()
    finally:
        app.dependency_overrides.pop(get_optional_user, None)


async def test_anonymous_gets_no_viewer_award_state(client):
    fid = await _new_fountain(client)
    # No get_optional_user override + no auth header => anonymous viewer.
    assert (await client.get(f"/api/v1/fountains/{fid}")).json()["viewer_award_state"] is None


async def test_rated_dimension_drops_out_of_unrated(client, test_user):
    fid = await _new_fountain(client)
    await client.post(
        f"/api/v1/fountains/{fid}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    state = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    assert 1 not in state["unrated_rating_type_ids"]
    assert 2 in state["unrated_rating_type_ids"]


async def test_hidden_own_note_is_still_not_earnable(client, test_user, session):
    """The dedup key survives moderation — a hidden note must NOT read as earnable."""
    fid = await _new_fountain(client)
    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "n"})

    # Hide it (what admin moderation does). The contribution dedup row is untouched.
    await session.execute(
        text("UPDATE fountain_notes SET is_hidden = true WHERE fountain_id = :f"), {"f": fid}
    )
    await session.commit()

    state = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    assert state["note_earnable"] is False

    # ...and the insert agrees: still 0. The hint and the award tell the same story.
    again = await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "n2"})
    assert again.json()["points_awarded"] == 0


async def test_hidden_own_attribute_observation_is_still_not_earnable(client, test_user, session):
    """The attribute-specific content-row drift the ledger design exists to prevent.

    NOT redundant with the no-consensus test below: there the user has never observed; here they
    HAVE, the award is spent, and moderation hid the row.
    """
    fid = await _new_fountain(client)
    await client.post(
        f"/api/v1/fountains/{fid}/attributes",
        json={"observations": [{"attribute_type_id": 1, "value": "yes"}]},
    )

    await session.execute(
        text("UPDATE attribute_observations SET is_hidden = true WHERE fountain_id = :f"),
        {"f": fid},
    )
    await session.commit()

    state = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    assert 1 not in state["unobserved_attribute_type_ids"]

    again = await client.post(
        f"/api/v1/fountains/{fid}/attributes",
        json={"observations": [{"attribute_type_id": 1, "value": "no"}]},
    )
    assert again.json()["points_awarded"] == 0


async def test_deleted_first_photo_leaves_photo_first_spent(client, test_user, storage, process):
    """`photo_first` is per-fountain and permanent; self-delete reverses the points, not the key."""
    fid = await _new_fountain(client)
    upload = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)
    assert upload.status_code == 201
    assert upload.json()["points_awarded"] == 5
    photo_id = upload.json()["id"]

    assert (await client.delete(f"/api/v1/fountains/{fid}/photos/{photo_id}")).status_code == 204

    state = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    # ZERO visible photos — but the fountain's photo_first key is spent, so nothing is earnable.
    # A preview derived from the visible photo list would wrongly promise +5 here.
    assert state["photo_first_earnable"] is False


async def test_attribute_with_no_consensus_row_is_still_earnable(client, test_user):
    """Candidates come from the attribute-type REGISTRY, not the response's `attributes` list.

    Computing candidates from the response's own content would silently drop exactly the attributes
    the user has never touched — the ones most likely to be earnable.
    """
    fid = await _new_fountain(client)
    detail = await _detail_as_viewer(client, test_user, fid)
    assert detail["attributes"] == []  # nobody has observed anything yet
    assert detail["viewer_award_state"]["unobserved_attribute_type_ids"]  # ...but all are earnable


async def test_stale_hint_loses_to_the_insert(client, test_user):
    """The hint is as-of-read; the POST is authoritative.

    Simulates the TOCTOU race (another tab/device spending the key between the GET and the submit).
    """
    fid = await _new_fountain(client)
    stale = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    assert stale["note_earnable"] is True  # the hint the client is holding

    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "a"})  # key gets spent
    late = await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "b"})
    assert late.json()["points_awarded"] == 0  # the insert wins, not the stale hint


async def test_detail_is_never_shared_cached(client, test_user):
    """Viewer-scoped data on a PUBLIC endpoint — a shared cache would leak it between users.

    Pre-existing hazard: this endpoint already returned `your_rating` (#65) and
    `condition_points_eligible_at` (#124) with no cache headers at all.
    """
    fid = await _new_fountain(client)
    anon = await client.get(f"/api/v1/fountains/{fid}")
    assert anon.headers["cache-control"] == "private, no-store"

    app.dependency_overrides[get_optional_user] = lambda: test_user
    try:
        authed = await client.get(f"/api/v1/fountains/{fid}")
        assert authed.headers["cache-control"] == "private, no-store"
    finally:
        app.dependency_overrides.pop(get_optional_user, None)
