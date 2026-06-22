import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from app.conditions import StatusResult, derive_status, recompute_fountain_status
from app.geo import point_geography
from app.models import ConditionReport, Fountain, User

NOW = datetime(2026, 6, 2, tzinfo=UTC)
U = [uuid.uuid4() for _ in range(6)]


def at(hours: float) -> datetime:
    return datetime(2026, 6, 1, tzinfo=UTC) + timedelta(hours=hours)


def d(reports):
    return derive_status(reports, now=NOW, freshness_days=90, corroboration_min=2)


def test_empty():
    assert d([]) == StatusResult(None, None)


def test_single_working_is_null_but_verified():
    r = d([("working", U[0], at(1))])
    assert r.current_status is None
    assert r.last_verified_at == at(1)


def test_single_broken_is_advisory():
    assert d([("broken", U[0], at(1))]).current_status == "reported_issue"


def test_two_distinct_broken_authoritative():
    assert d([("broken", U[0], at(1)), ("broken", U[1], at(2))]).current_status == "not_working"


def test_recovery_two_distinct_working():
    reports = [
        ("broken", U[0], at(1)),
        ("broken", U[1], at(2)),
        ("working", U[0], at(3)),
        ("working", U[1], at(4)),
    ]
    assert d(reports).current_status == "ok"


def test_single_actor_cannot_clear_outage():
    # One of the two corroborators recants -> stays not_working, last_verified updated.
    reports = [("broken", U[0], at(1)), ("broken", U[1], at(2)), ("working", U[0], at(3))]
    r = d(reports)
    assert r.current_status == "not_working"
    assert r.last_verified_at == at(3)


def test_two_working_same_user_stays_not_working():
    reports = [
        ("broken", U[0], at(1)),
        ("broken", U[1], at(2)),
        ("working", U[2], at(3)),
        ("working", U[2], at(4)),
    ]
    assert d(reports).current_status == "not_working"


def test_one_fresh_one_stale_working_stays_not_working():
    reports = [
        ("working", U[2], at(0)),  # stale working (before the outage)
        ("broken", U[0], at(1)),
        ("broken", U[1], at(2)),
        ("working", U[3], at(3)),  # one fresh working
    ]
    assert d(reports).current_status == "not_working"


def test_recant_without_corroboration_is_null():
    reports = [("broken", U[0], at(1)), ("working", U[0], at(2))]
    r = d(reports)
    assert r.current_status is None  # latest-overall is working -> no current issue
    assert r.last_verified_at == at(2)


def test_degraded_then_not_working_rereport_stays_not_working():
    reports = [
        ("dirty", U[0], at(9)),
        ("dirty", U[1], at(9) + timedelta(minutes=1)),
        ("broken", U[2], at(10)),
        ("broken", U[3], at(10) + timedelta(minutes=1)),
        ("dirty", U[0], at(10) + timedelta(minutes=2)),  # existing reporter re-reports
    ]
    assert d(reports).current_status == "not_working"


def test_equal_timestamp_severity_tiebreak():
    t = at(5)
    reports = [("dirty", U[0], t), ("dirty", U[1], t), ("broken", U[2], t), ("broken", U[3], t)]
    assert d(reports).current_status == "not_working"


def test_out_of_window_ignored():
    old = NOW - timedelta(days=200)
    assert d([("broken", U[0], old), ("broken", U[1], old)]).current_status is None


def test_corroboration_min_one():
    r = derive_status([("broken", U[0], at(1))], now=NOW, freshness_days=90, corroboration_min=1)
    assert r.current_status == "not_working"


@pytest.mark.asyncio
async def test_recompute_excludes_hidden(session):
    u1 = User(logto_user_id="cond-1", email="cond1@example.com", display_name="C1")
    u2 = User(logto_user_id="cond-2", email="cond2@example.com", display_name="C2")
    session.add_all([u1, u2])
    await session.flush()
    f = Fountain(
        location=point_geography(1.0, 2.0),
        is_working=True,
        created_source="user",
        added_by_user_id=u1.id,
    )
    session.add(f)
    await session.flush()
    r1 = ConditionReport(fountain_id=f.id, user_id=u1.id, status="broken")
    r2 = ConditionReport(fountain_id=f.id, user_id=u2.id, status="broken")
    session.add_all([r1, r2])
    await session.flush()

    await recompute_fountain_status(session, f.id)
    await session.refresh(f)
    assert f.current_status == "not_working"  # 2 distinct broken

    # Hide one report -> only 1 visible broken -> drops below corroboration.
    await session.execute(
        update(ConditionReport).where(ConditionReport.id == r2.id).values(is_hidden=True)
    )
    await recompute_fountain_status(session, f.id)
    await session.refresh(f)
    assert f.current_status == "reported_issue"
