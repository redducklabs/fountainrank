import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.config import get_settings
from app.geo import point_geography
from app.models import Fountain, FountainPhoto, PhotoReport, UploadAttempt, User
from app.rate_limit import (
    REPORTS_PER_DAY,
    REPORTS_PER_MIN,
    UPLOAD_ATTEMPTS_PER_DAY,
    UPLOAD_ATTEMPTS_PER_MIN,
    UPLOAD_COMPLETED_PER_DAY,
    RateLimited,
    check_report_rate,
    finalize_upload,
    reserve_upload,
)


async def _mk_user(session, n: int) -> User:
    u = User(
        logto_user_id=f"rate-limit-u{n}",
        email=f"rate-limit-u{n}@example.com",
        display_name=f"RL{n}",
    )
    session.add(u)
    await session.flush()
    return u


async def _mk_fountain(session, creator: User) -> Fountain:
    f = Fountain(
        location=point_geography(37.5, -122.2),
        is_working=True,
        created_source="user",
        added_by_user_id=creator.id,
    )
    session.add(f)
    await session.flush()
    return f


async def _seed_attempt(session, user: User, status: str, created_at: datetime) -> UploadAttempt:
    attempt = UploadAttempt(user_id=user.id, status=status, created_at=created_at)
    session.add(attempt)
    await session.flush()
    return attempt


async def _seed_report(
    session, fountain: Fountain, reporter: User, created_at: datetime, n: int
) -> PhotoReport:
    # Each report targets its own photo: the (photo_id, reporter_user_id) partial-unique
    # index only forbids two *pending* reports on the SAME photo, so a bulk-seed of many
    # reports from one reporter needs distinct photos.
    photo = FountainPhoto(
        fountain_id=fountain.id,
        user_id=reporter.id,
        storage_key=f"k-{n}",
        thumbnail_key=f"t-{n}",
        content_type="image/jpeg",
        width=1,
        height=1,
        byte_size=1,
    )
    session.add(photo)
    await session.flush()
    report = PhotoReport(
        photo_id=photo.id,
        reporter_user_id=reporter.id,
        category="spam",
        status="pending",
        created_at=created_at,
    )
    session.add(report)
    await session.flush()
    return report


@pytest.fixture
async def settings():
    return get_settings()


class TestReserveUpload:
    async def test_tenth_reservation_succeeds_eleventh_rate_limited(self, session, settings):
        user = await _mk_user(session, 1)
        await session.commit()

        now = datetime.now(UTC)
        for i in range(UPLOAD_ATTEMPTS_PER_MIN - 1):
            await _seed_attempt(session, user, "reserved", now - timedelta(seconds=i))
        await session.commit()

        # 10th reservation (9 seeded + this one) should still succeed.
        attempt_id = await reserve_upload(session, user.id, settings)
        await session.commit()
        assert isinstance(attempt_id, uuid.UUID)

        with pytest.raises(RateLimited) as exc_info:
            await reserve_upload(session, user.id, settings)
        assert exc_info.value.retry_after > 0

    async def test_61_attempts_spread_over_24h_hits_daily_cap_not_minute_cap(
        self, session, settings
    ):
        user = await _mk_user(session, 2)
        await session.commit()

        now = datetime.now(UTC)
        # Spread UPLOAD_ATTEMPTS_PER_DAY (60) attempts across the last 23 hours, well outside
        # any 60s window, so the minute cap is never breached. Use "failed" (not "reserved")
        # since these are older than the reservation TTL and an old "reserved" row is treated
        # as an abandoned reservation, excluded from the count -- "failed"/"completed" rows
        # never expire.
        step = timedelta(hours=23) / UPLOAD_ATTEMPTS_PER_DAY
        for i in range(UPLOAD_ATTEMPTS_PER_DAY):
            await _seed_attempt(session, user, "failed", now - step * i)
        await session.commit()

        with pytest.raises(RateLimited) as exc_info:
            await reserve_upload(session, user.id, settings)
        assert exc_info.value.reason == "upload_attempts_per_day"

    async def test_failed_attempt_still_counts_toward_attempt_windows(self, session, settings):
        user = await _mk_user(session, 3)
        await session.commit()

        now = datetime.now(UTC)
        for i in range(UPLOAD_ATTEMPTS_PER_MIN):
            status = "failed" if i % 2 == 0 else "reserved"
            await _seed_attempt(session, user, status, now - timedelta(seconds=i))
        await session.commit()

        with pytest.raises(RateLimited):
            await reserve_upload(session, user.id, settings)

    async def test_completed_beyond_daily_quota_rate_limits_without_attempt_cap_breach(
        self, session, settings
    ):
        user = await _mk_user(session, 4)
        await session.commit()

        now = datetime.now(UTC)
        # 30 completed attempts, spread over 24h so the attempt-rate windows (10/60, 60/day)
        # are never breached, but the completed-per-day quota (30) is exhausted.
        step = timedelta(hours=23) / UPLOAD_COMPLETED_PER_DAY
        for i in range(UPLOAD_COMPLETED_PER_DAY):
            await _seed_attempt(session, user, "completed", now - step * i)
        await session.commit()

        with pytest.raises(RateLimited) as exc_info:
            await reserve_upload(session, user.id, settings)
        assert exc_info.value.reason == "upload_completed_per_day"

    async def test_expired_reserved_row_does_not_count(self, session, settings):
        user = await _mk_user(session, 5)
        await session.commit()

        now = datetime.now(UTC)
        ttl = settings.upload_reservation_ttl_seconds
        # 9 fresh reserved rows (under the per-minute cap of 10) plus one that WOULD push it
        # to 10 except it is past the reservation TTL, so it must be excluded.
        for i in range(UPLOAD_ATTEMPTS_PER_MIN - 1):
            await _seed_attempt(session, user, "reserved", now - timedelta(seconds=i))
        expired = await _seed_attempt(session, user, "reserved", now - timedelta(seconds=ttl + 5))
        await session.commit()

        # Force created_at past the TTL via a direct UPDATE (the ORM default would otherwise
        # be overridden by autoflush timing quirks) -- belt and suspenders on top of the
        # constructor value above.
        await session.execute(
            text("UPDATE upload_attempts SET created_at = :ts WHERE id = :id"),
            {"ts": now - timedelta(seconds=ttl + 5), "id": expired.id},
        )
        await session.commit()

        # Should succeed: the expired reserved row is excluded, so only 9 non-expired rows
        # exist plus this new reservation = 10, still within the cap check semantics (this
        # call itself becomes the 10th and must be allowed since only 9 counted before it).
        attempt_id = await reserve_upload(session, user.id, settings)
        await session.commit()
        assert isinstance(attempt_id, uuid.UUID)

    async def test_retry_after_is_set(self, session, settings):
        user = await _mk_user(session, 6)
        await session.commit()

        now = datetime.now(UTC)
        for i in range(UPLOAD_ATTEMPTS_PER_MIN):
            await _seed_attempt(session, user, "reserved", now - timedelta(seconds=i))
        await session.commit()

        with pytest.raises(RateLimited) as exc_info:
            await reserve_upload(session, user.id, settings)
        assert exc_info.value.retry_after == 60


class TestFinalizeUpload:
    async def test_finalize_sets_status(self, session, settings):
        user = await _mk_user(session, 7)
        await session.commit()

        attempt_id = await reserve_upload(session, user.id, settings)
        await session.commit()

        await finalize_upload(session, attempt_id, "completed")
        await session.commit()

        attempt = await session.get(UploadAttempt, attempt_id)
        assert attempt.status == "completed"
        assert attempt.finalized_at is not None


class TestCheckReportRate:
    async def test_caps_at_20_per_minute(self, session):
        user = await _mk_user(session, 8)
        fountain = await _mk_fountain(session, user)
        await session.commit()

        now = datetime.now(UTC)
        for i in range(REPORTS_PER_MIN):
            await _seed_report(session, fountain, user, now - timedelta(seconds=i), i)
        await session.commit()

        with pytest.raises(RateLimited) as exc_info:
            await check_report_rate(session, user.id)
        assert exc_info.value.reason == "reports_per_minute"

    async def test_caps_at_100_per_day_when_spread_out(self, session):
        user = await _mk_user(session, 9)
        fountain = await _mk_fountain(session, user)
        await session.commit()

        now = datetime.now(UTC)
        step = timedelta(hours=23) / REPORTS_PER_DAY
        for i in range(REPORTS_PER_DAY):
            await _seed_report(session, fountain, user, now - step * i, i)
        await session.commit()

        with pytest.raises(RateLimited) as exc_info:
            await check_report_rate(session, user.id)
        assert exc_info.value.reason == "reports_per_day"

    async def test_under_limits_does_not_raise(self, session):
        user = await _mk_user(session, 10)
        fountain = await _mk_fountain(session, user)
        await session.commit()

        now = datetime.now(UTC)
        for i in range(REPORTS_PER_MIN - 1):
            await _seed_report(session, fountain, user, now - timedelta(seconds=i), i)
        await session.commit()

        await check_report_rate(session, user.id)  # should not raise
