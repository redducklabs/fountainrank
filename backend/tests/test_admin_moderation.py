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
    ContentReport,
    ContributionEvent,
    Fountain,
    FountainAttributeConsensus,
    FountainImportEvent,
    FountainNote,
    FountainPhoto,
    FountainProvenance,
    OsmImportRun,
    Rating,
    StorageCleanup,
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


async def _add_reporter(session, name: str) -> User:
    user = User(
        logto_user_id=f"reporter-{uuid.uuid4()}",
        email=f"{uuid.uuid4()}@example.com",
        display_name=name,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _add_photo(session, fountain: Fountain, uploader: User) -> FountainPhoto:
    pid = uuid.uuid4()
    photo = FountainPhoto(
        id=pid,
        fountain_id=fountain.id,
        user_id=uploader.id,
        storage_key=f"fountains/{fountain.id}/{pid}.jpg",
        thumbnail_key=f"fountains/{fountain.id}/{pid}_thumb.jpg",
        content_type="image/jpeg",
        width=800,
        height=600,
        byte_size=12345,
    )
    session.add(photo)
    await session.commit()
    await session.refresh(photo)
    return photo


async def _add_content_report(
    session,
    *,
    content_type: str,
    content_id: uuid.UUID,
    fountain_id: uuid.UUID,
    reporter: User,
    category: str = "spam",
    status: str = "pending",
) -> ContentReport:
    report = ContentReport(
        content_type=content_type,
        content_id=content_id,
        fountain_id=fountain_id,
        reporter_user_id=reporter.id,
        category=category,
        status=status,
        resolution=None,
        created_at=datetime.now(tz=UTC),
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return report


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


async def test_admin_fountain_patch_bounds_and_normalizes_comments(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    headers = {"X-Dev-User": "admin-sub"}

    normalized = await raw_client.patch(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers=headers,
        json={"comments": "  Updated by moderation.  "},
    )
    assert normalized.status_code == 200
    assert normalized.json()["comments"] == "Updated by moderation."

    oversized = await raw_client.patch(
        f"/api/v1/admin/fountains/{fountain.id}",
        headers=headers,
        json={"comments": "x" * 1001},
    )
    assert oversized.status_code == 422


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
    # Two photos (one hidden) — their Spaces objects must be enqueued for cleanup BEFORE the
    # cascade removes the fountain_photos rows, so the sweep worker can still find them
    # (Codex whole-branch review finding: hard-delete must not silently orphan Spaces objects).
    photos = [
        FountainPhoto(
            fountain_id=fountain.id,
            user_id=author.id,
            storage_key=f"fountains/{fountain.id}/photo-1.jpg",
            thumbnail_key=f"fountains/{fountain.id}/photo-1_thumb.jpg",
            content_type="image/jpeg",
            width=800,
            height=600,
            byte_size=12345,
        ),
        FountainPhoto(
            fountain_id=fountain.id,
            user_id=author.id,
            storage_key=f"fountains/{fountain.id}/photo-2.jpg",
            thumbnail_key=f"fountains/{fountain.id}/photo-2_thumb.jpg",
            content_type="image/jpeg",
            width=800,
            height=600,
            byte_size=12345,
            is_hidden=True,
        ),
    ]
    session.add_all(photos)
    await session.commit()
    fountain_id = fountain.id
    dedup_key = f"delete-test-{fountain_id}"
    expected_photo_keys = sorted(
        key for photo in photos for key in (photo.storage_key, photo.thumbnail_key)
    )

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
        FountainPhoto,
    ):
        count = (
            await session.execute(
                select(func.count()).select_from(model).where(model.fountain_id == fountain_id)
            )
        ).scalar_one()
        assert count == 0

    cleanup_rows = (
        (
            await session.execute(
                select(StorageCleanup).where(StorageCleanup.reason == "moderation_delete")
            )
        )
        .scalars()
        .all()
    )
    assert sorted(row.object_key for row in cleanup_rows) == expected_photo_keys
    assert all(row.status == "pending" for row in cleanup_rows)

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
        headers={"X-Dev-User": "creator-sub", "X-Dev-Name": "Creator"},
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
        headers={"X-Dev-User": "creator-sub", "X-Dev-Name": "Creator"},
        json={"location": {"latitude": 42.0, "longitude": -72.0}},
    )
    assert added.status_code == 201
    fountain_id = uuid.UUID(added.json()["id"])

    rated = await raw_client.post(
        f"/api/v1/fountains/{fountain_id}/ratings",
        headers={"X-Dev-User": "rater-sub", "X-Dev-Name": "Rater"},
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
        headers={"X-Dev-User": "admin-sub", "X-Dev-Name": "Admin"},
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


# --- resolve-on-action: hiding a note/fountain resolves its pending reports (#12) --------
# NOTE: capture report ids into locals BEFORE any request/`expire_all()` — accessing a mapped
# attribute on an expired ORM object triggers a sync lazy-load (MissingGreenlet).


async def _report_status(session, report_id: uuid.UUID) -> ContentReport:
    return (
        await session.execute(select(ContentReport).where(ContentReport.id == report_id))
    ).scalar_one()


async def test_note_hide_resolves_its_pending_reports_only(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    note_id = (await _create_note(session, fountain, author)).id
    reporter = await _add_reporter(session, "Reporter")

    r1_id = (
        await _add_content_report(
            session,
            content_type="note",
            content_id=note_id,
            fountain_id=fountain.id,
            reporter=reporter,
        )
    ).id

    # A second, unrelated note whose report must stay pending (proves isolation). Notes are
    # one-per-user-per-fountain, so this note needs a different author.
    other_author = await _add_reporter(session, "OtherAuthor")
    other_note_id = (await _create_note(session, fountain, other_author)).id
    r_other_id = (
        await _add_content_report(
            session,
            content_type="note",
            content_id=other_note_id,
            fountain_id=fountain.id,
            reporter=reporter,
        )
    ).id
    # A photo report under the same fountain must also stay pending.
    photo_id = (await _add_photo(session, fountain, author)).id
    r_photo_id = (
        await _add_content_report(
            session,
            content_type="photo",
            content_id=photo_id,
            fountain_id=fountain.id,
            reporter=reporter,
        )
    ).id

    resp = await raw_client.patch(
        f"/api/v1/admin/notes/{note_id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": True},
    )
    assert resp.status_code == 200

    session.expire_all()
    admin = await _user_by_sub(session, "admin-sub")

    hidden = await _report_status(session, r1_id)
    assert hidden.status == "resolved"
    assert hidden.resolution == "hidden"
    assert hidden.resolved_by_user_id == admin.id
    assert hidden.resolved_at is not None

    for other_id in (r_other_id, r_photo_id):
        row = await _report_status(session, other_id)
        assert row.status == "pending"
        assert row.resolution is None


async def test_note_unhide_does_not_reopen_reports(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    note_id = (await _create_note(session, fountain, author)).id
    reporter = await _add_reporter(session, "Reporter")
    report_id = (
        await _add_content_report(
            session,
            content_type="note",
            content_id=note_id,
            fountain_id=fountain.id,
            reporter=reporter,
        )
    ).id

    await raw_client.patch(
        f"/api/v1/admin/notes/{note_id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": True},
    )
    unhidden = await raw_client.patch(
        f"/api/v1/admin/notes/{note_id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": False},
    )
    assert unhidden.status_code == 200

    session.expire_all()
    row = await _report_status(session, report_id)
    assert row.status == "resolved"  # unhide does not re-open
    assert row.resolution == "hidden"


async def test_fountain_hide_resolves_only_fountain_type_reports(raw_client, session, author):
    fountain = await _create_fountain(session, author)
    fountain_id = fountain.id
    reporter = await _add_reporter(session, "Reporter")

    fountain_report_id = (
        await _add_content_report(
            session,
            content_type="fountain",
            content_id=fountain_id,
            fountain_id=fountain_id,
            reporter=reporter,
            category="not_a_fountain",
        )
    ).id
    note_id = (await _create_note(session, fountain, author)).id
    note_report_id = (
        await _add_content_report(
            session,
            content_type="note",
            content_id=note_id,
            fountain_id=fountain_id,
            reporter=reporter,
        )
    ).id
    photo_id = (await _add_photo(session, fountain, author)).id
    photo_report_id = (
        await _add_content_report(
            session,
            content_type="photo",
            content_id=photo_id,
            fountain_id=fountain_id,
            reporter=reporter,
        )
    ).id

    resp = await raw_client.patch(
        f"/api/v1/admin/fountains/{fountain_id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": True},
    )
    assert resp.status_code == 200

    session.expire_all()
    admin = await _user_by_sub(session, "admin-sub")

    resolved = await _report_status(session, fountain_report_id)
    assert resolved.status == "resolved"
    assert resolved.resolution == "hidden"
    assert resolved.resolved_by_user_id == admin.id

    # Note/photo reports UNDER the fountain stay pending — hiding the fountain moderates only
    # the fountain item (spec §4).
    for other_id in (note_report_id, photo_report_id):
        row = await _report_status(session, other_id)
        assert row.status == "pending"
