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
    UserContributionStats,
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
    # The audit row survives (fountain_id SET NULL) but is now reversed (#119).
    assert contribution.fountain_id is None
    assert contribution.status == "reversed"
    import_event = (await session.execute(select(FountainImportEvent))).scalar_one()
    assert import_event.fountain_id is None


async def _user_by_sub(session, sub: str) -> User:
    return (await session.execute(select(User).where(User.logto_user_id == sub))).scalar_one()


async def _stats_for(session, user_id) -> UserContributionStats:
    return (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == user_id)
        )
    ).scalar_one()


async def test_hard_delete_reverses_creator_points(raw_client, session):
    # A user adds a fountain through the real API (earning add + first-X bonus points)...
    added = await raw_client.post(
        "/api/v1/fountains",
        headers={"X-Dev-User": "creator-sub"},
        json={"location": {"latitude": 41.0, "longitude": -71.0}},
    )
    assert added.status_code == 201
    fountain_id = uuid.UUID(added.json()["id"])
    creator_id = (await _user_by_sub(session, "creator-sub")).id

    before = await _stats_for(session, creator_id)
    awarded_sum = (
        await session.execute(
            select(func.coalesce(func.sum(ContributionEvent.points), 0)).where(
                ContributionEvent.fountain_id == fountain_id,
                ContributionEvent.status == "awarded",
            )
        )
    ).scalar_one()
    assert before.total_points == awarded_sum > 0
    assert before.fountains_added == 1

    # ...the admin hard-deletes it: every contribution for it must be reversed.
    resp = await raw_client.delete(
        f"/api/v1/admin/fountains/{fountain_id}",
        headers={"X-Dev-User": "admin-sub"},
    )
    assert resp.status_code == 204
    session.expire_all()

    after = await _stats_for(session, creator_id)
    assert after.total_points == 0
    assert after.fountains_added == 0
    statuses = (
        (
            await session.execute(
                select(ContributionEvent.status).where(ContributionEvent.user_id == creator_id)
            )
        )
        .scalars()
        .all()
    )
    assert statuses  # events survive as the audit trail...
    assert all(s == "reversed" for s in statuses)  # ...all reversed

    # The creator drops off BOTH leaderboards: the local (in-area) one sums awarded events,
    # and the global one excludes zero-point users (#119 — a reversal is a drop-off, not a
    # 0-point ghost row).
    local = await raw_client.get(
        "/api/v1/leaderboard/contributors",
        params={"near_lat": 41.0, "near_lng": -71.0},
    )
    assert local.status_code == 200
    assert local.json()["rows"] == []  # #117: response is {rows, you}; anonymous -> you null
    glob = await raw_client.get("/api/v1/leaderboard/contributors")
    assert glob.status_code == 200
    assert glob.json()["rows"] == []

    # The reversed events must also disappear from the creator's own contribution feed
    # (every other read already excludes reversed; the profile feed must too).
    feed = await raw_client.get(
        "/api/v1/me/contributions",
        headers={"X-Dev-User": "creator-sub"},
    )
    assert feed.status_code == 200
    assert feed.json()["stats"]["total_points"] == 0
    assert feed.json()["recent"] == []


async def test_hard_delete_reverses_all_contributors(raw_client, session):
    # Creator adds the fountain; a *second* user rates it. Both earn points.
    added = await raw_client.post(
        "/api/v1/fountains",
        headers={"X-Dev-User": "creator-sub"},
        json={"location": {"latitude": 42.0, "longitude": -72.0}},
    )
    assert added.status_code == 201
    fountain_id = uuid.UUID(added.json()["id"])

    rated = await raw_client.post(
        f"/api/v1/fountains/{fountain_id}/ratings",
        headers={"X-Dev-User": "rater-sub"},
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    assert rated.status_code == 200

    creator_id = (await _user_by_sub(session, "creator-sub")).id
    rater_id = (await _user_by_sub(session, "rater-sub")).id
    assert (await _stats_for(session, creator_id)).total_points > 0
    rater_before = await _stats_for(session, rater_id)
    assert rater_before.total_points > 0
    assert rater_before.ratings_count == 1

    resp = await raw_client.delete(
        f"/api/v1/admin/fountains/{fountain_id}",
        headers={"X-Dev-User": "admin-sub"},
    )
    assert resp.status_code == 204
    session.expire_all()

    creator_after = await _stats_for(session, creator_id)
    rater_after = await _stats_for(session, rater_id)
    assert creator_after.total_points == 0
    assert creator_after.fountains_added == 0
    assert rater_after.total_points == 0
    assert rater_after.ratings_count == 0
    remaining_awarded = (
        await session.execute(
            select(func.count())
            .select_from(ContributionEvent)
            .where(ContributionEvent.status == "awarded")
        )
    ).scalar_one()
    assert remaining_awarded == 0


async def test_empty_patch_is_422(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    resp = await raw_client.patch(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers={"X-Dev-User": "admin-sub"},
        json={},
    )
    assert resp.status_code == 422


async def test_admin_detail_includes_admins_own_rating(raw_client, session, author):
    # Admins read a fountain via the admin endpoint (not the public detail), so the admin's
    # own per-dimension rating must still come back so the rating form pre-fills (#114).
    fountain = await _create_fountain(session, author)
    rated = await raw_client.post(
        f"/api/v1/fountains/{fountain.id}/ratings",
        headers={"X-Dev-User": "admin-sub"},
        json={"ratings": [{"rating_type_id": 1, "stars": 4}]},
    )
    assert rated.status_code == 200

    admin_detail = await raw_client.get(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers={"X-Dev-User": "admin-sub"},
    )
    assert admin_detail.status_code == 200
    dims = {d["rating_type_id"]: d for d in admin_detail.json()["dimensions"]}
    assert dims[1]["your_rating"] == 4
