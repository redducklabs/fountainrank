import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.config import Settings, get_settings
from app.geo import point_geography
from app.main import app
from app.models import (
    AttributeObservation,
    ConditionReport,
    ContributionEvent,
    Fountain,
    FountainAttributeConsensus,
    FountainImportEvent,
    FountainNote,
    FountainProvenance,
    OsmImportRun,
    Rating,
    User,
)

pytestmark = pytest.mark.anyio


@pytest.fixture
def admin_settings():
    app.dependency_overrides[get_settings] = lambda: Settings(
        dev_auth_enabled=True,
        admin_subjects=["admin-sub"],
    )
    yield
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def raw_client(admin_settings):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def author(session) -> User:
    user = User(logto_user_id="author-sub", email="author@example.com", display_name="Author")
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_fountain(session, author: User, *, is_hidden: bool = False) -> Fountain:
    fountain = Fountain(
        location=point_geography(37.5, -122.2),
        is_working=True,
        is_hidden=is_hidden,
        comments="old comments",
        placement_note="old placement",
        added_by_user_id=author.id,
    )
    session.add(fountain)
    await session.commit()
    await session.refresh(fountain)
    return fountain


async def _create_note(
    session,
    fountain: Fountain,
    author: User,
    *,
    is_hidden: bool = False,
) -> FountainNote:
    note = FountainNote(
        fountain_id=fountain.id,
        user_id=author.id,
        body="public note",
        is_hidden=is_hidden,
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return note


async def _assert_authz(raw_client: AsyncClient, method: str, path: str, **kwargs) -> None:
    anonymous = await raw_client.request(method, path, **kwargs)
    assert anonymous.status_code == 401

    non_admin = await raw_client.request(
        method,
        path,
        headers={"X-Dev-User": "regular-sub"},
        **kwargs,
    )
    assert non_admin.status_code == 403

    admin = await raw_client.request(method, path, headers={"X-Dev-User": "admin-sub"}, **kwargs)
    assert 200 <= admin.status_code < 300


async def test_admin_routes_authz_matrix(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    note = await _create_note(session, fountain, author)

    await _assert_authz(raw_client, "GET", f"/api/v1/admin/fountains/{fountain.id}")
    await _assert_authz(
        raw_client,
        "PATCH",
        f"/api/v1/admin/fountains/{fountain.id}",
        json={"comments": "admin edit"},
    )
    await _assert_authz(
        raw_client,
        "PATCH",
        f"/api/v1/admin/notes/{note.id}",
        json={"is_hidden": True},
    )

    to_delete = await _create_fountain(session, author)
    await _assert_authz(raw_client, "DELETE", f"/api/v1/admin/fountains/{to_delete.id}")


async def test_non_admin_forbidden_does_not_leak_existence(raw_client):
    missing = uuid.uuid4()
    resp = await raw_client.get(
        f"/api/v1/admin/fountains/{missing}",
        headers={"X-Dev-User": "regular-sub"},
    )
    assert resp.status_code == 403


async def test_soft_hide_fountain_disappears_from_public_reads_but_admin_can_read(
    raw_client, session, author
):
    fountain = await _create_fountain(session, author)

    resp = await raw_client.patch(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": True},
    )
    assert resp.status_code == 200
    assert resp.json()["is_hidden"] is True

    public_list = await raw_client.get("/api/v1/fountains", params={"lat": 37.5, "lng": -122.2})
    assert public_list.status_code == 200
    assert all(row["id"] != str(fountain.id) for row in public_list.json())

    public_bbox = await raw_client.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": 37.0, "min_lng": -123.0, "max_lat": 38.0, "max_lng": -122.0},
    )
    assert public_bbox.status_code == 200
    assert all(row["id"] != str(fountain.id) for row in public_bbox.json())

    public_detail = await raw_client.get(f"/api/v1/fountains/{fountain.id}")
    assert public_detail.status_code == 404

    admin_detail = await raw_client.get(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers={"X-Dev-User": "admin-sub"},
    )
    assert admin_detail.status_code == 200
    assert admin_detail.json()["id"] == str(fountain.id)


async def test_note_hide_excludes_publicly_admin_can_unhide(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    note = await _create_note(session, fountain, author)

    hidden = await raw_client.patch(
        f"/api/v1/admin/notes/{note.id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": True},
    )
    assert hidden.status_code == 200
    assert hidden.json()["is_hidden"] is True

    public_notes = await raw_client.get(f"/api/v1/fountains/{fountain.id}/notes")
    assert public_notes.status_code == 200
    assert public_notes.json() == []

    admin_detail = await raw_client.get(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers={"X-Dev-User": "admin-sub"},
    )
    assert admin_detail.status_code == 200
    assert admin_detail.json()["notes"][0]["id"] == str(note.id)
    assert admin_detail.json()["notes"][0]["is_hidden"] is True

    unhidden = await raw_client.patch(
        f"/api/v1/admin/notes/{note.id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": False},
    )
    assert unhidden.status_code == 200
    assert unhidden.json()["is_hidden"] is False
    public_notes = await raw_client.get(f"/api/v1/fountains/{fountain.id}/notes")
    assert [row["id"] for row in public_notes.json()] == [str(note.id)]


async def test_admin_edit_persists_fields_and_recomputes_ranking(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    rating = Rating(fountain_id=fountain.id, user_id=author.id, rating_type_id=1, stars=5)
    session.add(rating)
    fountain.rating_count = 99
    fountain.average_rating = 1.0
    fountain.ranking_score = 1.0
    await session.commit()

    resp = await raw_client.patch(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers={"X-Dev-User": "admin-sub"},
        json={
            "location": {"latitude": 37.6, "longitude": -122.3},
            "is_working": False,
            "placement_note": "new placement",
            "comments": "new comments",
            "is_hidden": False,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["location"] == {"latitude": 37.6, "longitude": -122.3}
    assert body["is_working"] is False
    assert body["placement_note"] == "new placement"
    assert body["comments"] == "new comments"
    assert body["rating_count"] == 1
    assert body["average_rating"] == 5.0
    assert body["ranking_score"] is not None


async def test_hard_delete_cascades_children_and_preserves_contribution_event(
    raw_client,
    session,
    author,
):
    fountain = await _create_fountain(session, author)
    now = datetime.now(tz=UTC)
    import_run = OsmImportRun(
        status="finished",
        source_system="osm",
        source_dataset="test",
        source_build_id="build",
        source_label="Test",
        scope_id="scope",
        started_at=now,
        finished_at=now,
    )
    session.add(import_run)
    await session.flush()
    rows = [
        Rating(fountain_id=fountain.id, user_id=author.id, rating_type_id=1, stars=4),
        FountainNote(fountain_id=fountain.id, user_id=author.id, body="note"),
        ConditionReport(fountain_id=fountain.id, user_id=author.id, status="working"),
        AttributeObservation(
            fountain_id=fountain.id,
            user_id=author.id,
            attribute_type_id=1,
            value="yes",
        ),
        FountainAttributeConsensus(
            fountain_id=fountain.id,
            attribute_type_id=1,
            confidence="single",
            yes_count=1,
            no_count=0,
            unknown_count=0,
            observation_count=1,
            consensus_value="yes",
        ),
        FountainProvenance(
            fountain_id=fountain.id,
            source_system="osm",
            source_dataset="test",
            scope_id="scope",
            source_external_id="node/1",
            first_seen_at=now,
            last_seen_at=now,
            first_import_run_id=import_run.id,
            last_import_run_id=import_run.id,
        ),
        FountainImportEvent(
            run_id=import_run.id,
            fountain_id=fountain.id,
            operation="inserted",
        ),
        ContributionEvent(
            user_id=author.id,
            fountain_id=fountain.id,
            event_type="add_fountain",
            points=10,
            dedup_key=f"delete-test-{fountain.id}",
        ),
    ]
    session.add_all(rows)
    await session.commit()
    fountain_id = fountain.id
    dedup_key = f"delete-test-{fountain_id}"

    resp = await raw_client.delete(
        f"/api/v1/admin/fountains/{fountain_id}",
        headers={"X-Dev-User": "admin-sub"},
    )
    assert resp.status_code == 204
    session.expire_all()

    assert (
        await session.execute(
            select(func.count()).select_from(Fountain).where(Fountain.id == fountain_id)
        )
    ).scalar_one() == 0
    for model in (
        Rating,
        FountainNote,
        ConditionReport,
        AttributeObservation,
        FountainAttributeConsensus,
        FountainProvenance,
    ):
        count = (
            await session.execute(
                select(func.count()).select_from(model).where(model.fountain_id == fountain_id)
            )
        ).scalar_one()
        assert count == 0

    contribution = (
        await session.execute(
            select(ContributionEvent).where(ContributionEvent.dedup_key == dedup_key)
        )
    ).scalar_one()
    assert contribution.fountain_id is None
    import_event = (await session.execute(select(FountainImportEvent))).scalar_one()
    assert import_event.fountain_id is None


async def test_empty_patch_is_422(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    resp = await raw_client.patch(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers={"X-Dev-User": "admin-sub"},
        json={},
    )
    assert resp.status_code == 422
