import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.config import Settings, get_settings
from app.main import app
from app.models import (
    AttributeObservation,
    ConditionReport,
    ContentReport,
    DeletedAccount,
    Fountain,
    FountainNote,
    FountainPhoto,
    Rating,
    StorageCleanup,
    User,
)


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def test_me_returns_profile(client, test_user):
    resp = await client.get("/api/v1/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(test_user.id)
    assert body["display_name"] == "Dev One"
    assert body["email"] == "dev1@example.com"
    assert body["avatar_url"] is None
    assert body["is_admin"] is False
    assert "created_at" in body
    # The Logto subject is an internal identity key, never user-facing payload.
    assert "logto_user_id" not in body


async def test_me_requires_auth():
    # No dependency override and no credential -> the real resolver returns 401.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/v1/me")
    assert resp.status_code == 401


async def test_me_includes_needs_name_false_for_named(client, test_user):
    resp = await client.get("/api/v1/me")
    assert resp.status_code == 200
    assert resp.json()["needs_name"] is False  # "Dev One" != subject


async def test_me_needs_name_true_when_anonymous(client, test_user, session):
    # display_name fell back to the subject and no nickname -> needs_name; subject must not leak.
    test_user.display_name = test_user.logto_user_id
    test_user.nickname = None
    await session.commit()
    resp = await client.get("/api/v1/me")
    body = resp.json()
    assert body["needs_name"] is True
    assert body["display_name"] == ""  # never the raw Logto subject
    assert test_user.logto_user_id not in str(body)  # subject nowhere in /me


async def test_me_display_name_prefers_nickname(client, test_user, session):
    test_user.nickname = "Nick"
    await session.commit()
    resp = await client.get("/api/v1/me")
    body = resp.json()
    assert body["display_name"] == "Nick"
    assert body["needs_name"] is False


async def test_me_blanks_synthetic_subject_email(client, test_user, session):
    # The synthetic fallback email embeds the subject — it must not cross the wire.
    test_user.email = f"{test_user.logto_user_id}@users.noreply.fountainrank.com"
    await session.commit()
    resp = await client.get("/api/v1/me")
    body = resp.json()
    assert body["email"] == ""
    assert test_user.logto_user_id not in str(body)  # subject nowhere in /me


async def test_me_real_email_passes_through(client, test_user, session):
    test_user.email = "real@example.com"
    await session.commit()
    assert (await client.get("/api/v1/me")).json()["email"] == "real@example.com"


async def test_patch_me_sets_display_name(client, test_user):
    # Response behaviour: the trimmed value becomes the resolved display_name and clears needs_name.
    resp = await client.patch("/api/v1/me", json={"display_name": "  Aron  "})
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "Aron"  # trimmed, resolved from nickname
    assert body["needs_name"] is False


async def test_patch_me_persists_nickname_and_preserves_idp_name(settings_override, session):
    # Persistence through the real request session (dev seam provisions the user in the endpoint's
    # own session). The nickname is stored; the IdP-synced display_name is left intact as fallback.
    settings_override(dev_auth_enabled=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.patch(
            "/api/v1/me",
            json={"display_name": "Aron"},
            headers={"X-Dev-User": "logto-patch-1", "X-Dev-Name": "IdP Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Aron"
    row = (
        await session.execute(select(User).where(User.logto_user_id == "logto-patch-1"))
    ).scalar_one()
    assert row.nickname == "Aron"
    assert row.display_name == "IdP Name"  # IdP name preserved underneath


async def test_patch_me_rejects_blank(client):
    assert (await client.patch("/api/v1/me", json={"display_name": "   "})).status_code == 422


async def test_patch_me_rejects_too_long(client):
    assert (await client.patch("/api/v1/me", json={"display_name": "x" * 81})).status_code == 422


async def test_patch_me_rejects_value_equal_to_subject(client, test_user):
    resp = await client.patch("/api/v1/me", json={"display_name": test_user.logto_user_id})
    assert resp.status_code == 422


async def test_patch_me_requires_auth():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.patch("/api/v1/me", json={"display_name": "Aron"})
    assert resp.status_code == 401


async def test_delete_me_removes_account_notes_photos_and_anonymizes_fountain_signal(
    client, test_user, session, monkeypatch
):
    deleted_logto_users: list[str] = []
    deleted_photo_keys: list[str] = []

    async def fake_delete_user(self, logto_user_id: str) -> None:
        deleted_logto_users.append(logto_user_id)

    async def fake_delete_photos(*, photo_keys, settings) -> bool:
        deleted_photo_keys.extend(photo_keys)
        return True

    monkeypatch.setattr("app.logto_management.LogtoManagementClient.delete_user", fake_delete_user)
    monkeypatch.setattr("app.routers.users._delete_photo_objects_for_account", fake_delete_photos)

    user_id = test_user.id
    logto_user_id = test_user.logto_user_id
    fountain_id = (
        await session.execute(
            text(
                "INSERT INTO fountains (id, location, created_source, added_by_user_id) "
                "VALUES (gen_random_uuid(), "
                "ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, "
                "'user', :user_id) RETURNING id"
            ),
            {"user_id": user_id},
        )
    ).scalar_one()
    rating = Rating(fountain_id=fountain_id, user_id=user_id, rating_type_id=1, stars=5)
    observation = AttributeObservation(
        fountain_id=fountain_id,
        user_id=user_id,
        attribute_type_id=1,
        value="yes",
    )
    condition = ConditionReport(
        fountain_id=fountain_id,
        user_id=user_id,
        status="working",
    )
    note = FountainNote(fountain_id=fountain_id, user_id=user_id, body="personal note")
    photo = FountainPhoto(
        fountain_id=fountain_id,
        user_id=user_id,
        storage_key="photos/full.jpg",
        thumbnail_key="photos/thumb.jpg",
        content_type="image/jpeg",
        width=1,
        height=1,
        byte_size=1,
    )
    session.add_all([rating, observation, condition, note, photo])
    await session.flush()
    session.add_all(
        [
            ContentReport(
                content_type="note",
                content_id=note.id,
                fountain_id=fountain_id,
                reporter_user_id=user_id,
                category="other",
            ),
            ContentReport(
                content_type="photo",
                content_id=photo.id,
                fountain_id=fountain_id,
                reporter_user_id=user_id,
                category="other",
            ),
        ]
    )
    await session.commit()
    rating_id = rating.id
    observation_id = observation.id
    condition_id = condition.id
    note_id = note.id
    photo_id = photo.id

    resp = await client.delete("/api/v1/me")

    assert resp.status_code == 204, resp.text
    await session.rollback()
    session.expire_all()
    assert (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none() is None
    assert deleted_logto_users == [logto_user_id]
    assert (
        await session.execute(select(FountainNote).where(FountainNote.id == note_id))
    ).scalar_one_or_none() is None
    assert (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo_id))
    ).scalar_one_or_none() is None
    assert (await session.execute(select(ContentReport))).scalars().all() == []

    kept_fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id))
    ).scalar_one()
    assert kept_fountain.added_by_user_id is None
    kept_rating = (await session.execute(select(Rating).where(Rating.id == rating_id))).scalar_one()
    assert kept_rating.user_id is None
    assert kept_rating.deleted_actor_id == user_id
    kept_observation = (
        await session.execute(
            select(AttributeObservation).where(AttributeObservation.id == observation_id)
        )
    ).scalar_one()
    assert kept_observation.user_id is None
    assert kept_observation.deleted_actor_id == user_id
    kept_condition = (
        await session.execute(select(ConditionReport).where(ConditionReport.id == condition_id))
    ).scalar_one()
    assert kept_condition.user_id is None
    assert kept_condition.deleted_actor_id == user_id
    assert sorted(deleted_photo_keys) == ["photos/full.jpg", "photos/thumb.jpg"]
    cleanup_rows = (
        (await session.execute(select(StorageCleanup).order_by(StorageCleanup.object_key)))
        .scalars()
        .all()
    )
    assert [(row.object_key, row.status, row.reason) for row in cleanup_rows] == [
        ("photos/full.jpg", "done", "account_delete"),
        ("photos/thumb.jpg", "done", "account_delete"),
    ]
    tombstone = (
        await session.execute(
            select(DeletedAccount).where(DeletedAccount.logto_user_id == logto_user_id)
        )
    ).scalar_one()
    assert tombstone.identity_delete_status == "done"
    assert tombstone.identity_delete_attempts == 1


async def test_delete_me_returns_success_with_pending_photo_cleanup_when_storage_unavailable(
    client, test_user, session
):
    user_id = test_user.id
    logto_user_id = test_user.logto_user_id
    photo = FountainPhoto(
        fountain_id=(
            await session.execute(
                text(
                    "INSERT INTO fountains (id, location, created_source, added_by_user_id) "
                    "VALUES (gen_random_uuid(), "
                    "ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, "
                    "'user', :user_id) RETURNING id"
                ),
                {"user_id": user_id},
            )
        ).scalar_one(),
        user_id=user_id,
        storage_key="photos/full.jpg",
        thumbnail_key="photos/thumb.jpg",
        content_type="image/jpeg",
        width=1,
        height=1,
        byte_size=1,
    )
    session.add(photo)
    await session.commit()

    resp = await client.delete("/api/v1/me")

    assert resp.status_code == 204
    await session.rollback()
    assert (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none() is None
    assert (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo.id))
    ).scalar_one_or_none() is None
    cleanup_rows = (
        (await session.execute(select(StorageCleanup).order_by(StorageCleanup.object_key)))
        .scalars()
        .all()
    )
    assert [(row.object_key, row.status, row.reason) for row in cleanup_rows] == [
        ("photos/full.jpg", "pending", "account_delete"),
        ("photos/thumb.jpg", "pending", "account_delete"),
    ]
    assert (
        await session.execute(
            select(DeletedAccount).where(DeletedAccount.logto_user_id == logto_user_id)
        )
    ).scalar_one_or_none() is not None


async def test_delete_me_returns_204_when_storage_cleanup_raises_unexpectedly(
    client, test_user, session, monkeypatch
):
    """Post-commit cleanup is best effort. The local account is already irreversibly gone, so an
    unexpected storage error must not surface as a 500 telling the user deletion failed."""

    async def fake_delete_user(self, logto_user_id: str) -> None:
        return None

    def exploding_get_storage(settings):
        raise RuntimeError("boto3 client construction blew up")

    monkeypatch.setattr("app.logto_management.LogtoManagementClient.delete_user", fake_delete_user)
    monkeypatch.setattr("app.routers.users.get_storage", exploding_get_storage)

    user_id = test_user.id
    logto_user_id = test_user.logto_user_id
    fountain_id = (
        await session.execute(
            text(
                "INSERT INTO fountains (id, location, created_source, added_by_user_id) "
                "VALUES (gen_random_uuid(), "
                "ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, "
                "'user', :user_id) RETURNING id"
            ),
            {"user_id": user_id},
        )
    ).scalar_one()
    session.add(
        FountainPhoto(
            fountain_id=fountain_id,
            user_id=user_id,
            storage_key="photos/full.jpg",
            thumbnail_key="photos/thumb.jpg",
            content_type="image/jpeg",
            width=1,
            height=1,
            byte_size=1,
        )
    )
    await session.commit()

    resp = await client.delete("/api/v1/me")

    assert resp.status_code == 204, resp.text
    await session.rollback()
    assert (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none() is None
    # Photo objects stay on the ledger for the retry CLI...
    cleanup_rows = (await session.execute(select(StorageCleanup))).scalars().all()
    assert {row.status for row in cleanup_rows} == {"pending"}
    # ...and the identity cleanup still ran despite the photo step failing.
    tombstone = (
        await session.execute(
            select(DeletedAccount).where(DeletedAccount.logto_user_id == logto_user_id)
        )
    ).scalar_one()
    assert tombstone.identity_delete_status == "done"


async def test_delete_me_returns_204_when_logto_client_raises_unexpectedly(
    client, test_user, session, monkeypatch
):
    """A non-LogtoManagementError escaping the Logto client must not 500 the request either;
    the tombstone simply stays pending for the retry CLI."""

    async def exploding_delete_user(self, logto_user_id: str) -> None:
        raise RuntimeError("unexpected client bug")

    async def fake_delete_photos(*, photo_keys, settings) -> bool:
        return True

    monkeypatch.setattr(
        "app.logto_management.LogtoManagementClient.delete_user", exploding_delete_user
    )
    monkeypatch.setattr("app.routers.users._delete_photo_objects_for_account", fake_delete_photos)

    user_id = test_user.id
    logto_user_id = test_user.logto_user_id

    resp = await client.delete("/api/v1/me")

    assert resp.status_code == 204, resp.text
    await session.rollback()
    assert (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none() is None
    tombstone = (
        await session.execute(
            select(DeletedAccount).where(DeletedAccount.logto_user_id == logto_user_id)
        )
    ).scalar_one()
    assert tombstone.identity_delete_status == "pending"


async def test_delete_me_succeeds_when_tombstone_already_exists(
    client, test_user, session, monkeypatch
):
    """Two concurrent DELETE /me calls both resolve the user before either commits, so the
    loser must replay harmlessly instead of losing the tombstone PK race with a 500."""

    async def fake_delete_user(self, logto_user_id: str) -> None:
        return None

    async def fake_delete_photos(*, photo_keys, settings) -> bool:
        return True

    monkeypatch.setattr("app.logto_management.LogtoManagementClient.delete_user", fake_delete_user)
    monkeypatch.setattr("app.routers.users._delete_photo_objects_for_account", fake_delete_photos)

    user_id = test_user.id
    logto_user_id = test_user.logto_user_id
    session.add(DeletedAccount(logto_user_id=logto_user_id))
    await session.commit()

    resp = await client.delete("/api/v1/me")

    assert resp.status_code == 204, resp.text
    await session.rollback()
    assert (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none() is None
    tombstones = (
        (
            await session.execute(
                select(DeletedAccount).where(DeletedAccount.logto_user_id == logto_user_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(tombstones) == 1


async def test_delete_me_returns_success_with_pending_logto_cleanup_when_unconfigured(
    client, test_user, session, monkeypatch
):
    user_id = test_user.id
    logto_user_id = test_user.logto_user_id

    async def fake_delete_photos(*, photo_keys, settings) -> bool:
        return True

    monkeypatch.setattr("app.routers.users._delete_photo_objects_for_account", fake_delete_photos)

    resp = await client.delete("/api/v1/me")

    assert resp.status_code == 204
    await session.rollback()
    assert (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none() is None
    tombstone = (
        await session.execute(
            select(DeletedAccount).where(DeletedAccount.logto_user_id == logto_user_id)
        )
    ).scalar_one()
    assert tombstone.identity_delete_status == "pending"
    assert tombstone.identity_delete_attempts == 1
