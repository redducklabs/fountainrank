# Repeat-Contribution Point Limit (#124) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the one unbounded point-farming vector — condition reporting — by gating `verify_working` + `report_condition` behind a rolling-24h, coalesced per-(user, fountain) point window, and surface it truthfully on web + mobile.

**Architecture:** A single query-based rolling gate inside `submit_condition` (already under a `Fountain … FOR UPDATE` lock) decides whether a condition report mints points; the report row and status recompute always persist. `FountainDetail` gains two additive, nullable fields — `condition_points_eligible_at` (a per-viewer pre-submit *hint* for the warning) and `condition_points_awarded` (the server-authoritative count for the success celebration, set only on the condition POST). No breaking response-shape change; one additive partial index; no new column, no backfill.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic (Python 3.13), PostGIS/Postgres, Next.js (web, Vitest + RTL), Expo/React Native (mobile, Vitest unit-only — no RN render harness), shared `@fountainrank/api-client` (openapi-fetch + openapi-typescript) and `@fountainrank/contributions` workspace packages.

## Global Constraints

- **Design source of truth:** `docs/specs/2026-07-04-repeat-contribution-point-limit-design.md` (Codex-approved). Every task's requirements implicitly include it.
- **Single clock:** one `report_time = datetime.now(tz=UTC)` per condition request anchors the report row, the awarded event's `created_at`, the lookback boundary, and the returned eligibility timestamp.
- **Boundary rule:** a prior awarded condition event with `created_at ≤ report_time − 24h` is **eligible** (awards); strictly newer is **ineligible** (0 points).
- **Coalesced:** `verify_working` and `report_condition` share one 24h window per (user, fountain).
- **Legacy rows:** the gate matches on `event_type IN ('verify_working','report_condition') AND status='awarded'` — never on `dedup_key` — so pre-existing calendar-day-keyed rows are honored with no backfill.
- **Data always persists:** the `condition_reports` row and `recompute_fountain_status` never depend on point eligibility.
- **Additive API only:** two optional/nullable `FountainDetail` fields; the condition POST body stays a `FountainDetail`. No new column; the only schema migration is one additive partial index.
- **Regenerate generated artifacts:** after any backend schema change, regenerate **and commit** `packages/api-client/openapi.json` + `packages/api-client/src/schema.d.ts`.
- **Warn, don't block:** clients warn before an ineligible submit but keep the submit control enabled.
- **Process:** TDD, frequent Conventional Commits, one task at a time. **No AI attribution** in commits/PRs; **no time estimates** anywhere. Backend CI mirror: `./run.ps1 check -Backend` (ruff check + ruff format --check + alembic upgrade head + alembic check + pytest). JS mirror: `pnpm --filter <pkg> typecheck|lint|test`.

---

## File Structure

**Backend**
- `backend/app/contributions.py` — add `ContributionSpec.created_at`; use it in `record_contributions`; remove `dk_verify`/`dk_report_condition`, add `dk_condition_award`; add `CONDITION_EVENT_TYPES`, `CONDITION_POINT_WINDOW`, the pure `condition_points_eligible_at()` helper, and the async `latest_awarded_condition_at()` lookback.
- `backend/app/models.py` — add the partial composite index to `ContributionEvent.__table_args__`.
- `backend/migrations/versions/0020_condition_award_window_index.py` — create/drop the index (chains onto `0019_photo_reports`).
- `backend/app/schemas.py` — `FountainDetail` gains `condition_points_eligible_at` + `condition_points_awarded`.
- `backend/app/routers/fountains.py` — `serialize_fountain_detail` computes eligibility + accepts awarded passthrough; `submit_condition` runs the rolling gate and returns `condition_points_awarded`; import swap.

**Generated**
- `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts` — regenerated + committed.

**Shared**
- `packages/contributions/src/index.ts` — add pure `conditionPointsBlocked()` (+ Vitest tests).

**Web**
- `web/app/actions/contribute.ts` — `ActionResult` success carries `pointsAwarded?`; `run()` reads the response body; `submitCondition` returns it.
- `web/components/fountain/ConditionForm.tsx` — accept `conditionPointsEligibleAt`; warning + eligibility-aware preview; success message from `pointsAwarded`.
- `web/components/fountain/ContributeSection.tsx` + `web/components/fountain/FountainDetail.tsx` — thread `conditionPointsEligibleAt` down.
- `web/components/fountain/ConditionForm.test.tsx` — extend.

**Mobile**
- `mobile/app/fountains/[id].tsx` — `conditionMutation.onSuccess` uses `detail.condition_points_awarded ?? 0`; thread `conditionPointsEligibleAt` to the form.
- `mobile/components/fountain/ConditionContributionForm.tsx` — accept `conditionPointsEligibleAt`; warning + eligibility-aware preview.

**Docs**
- `docs/style-guide.md` — document the "Points-ineligible inline warning" element.

---

## Task 1: `ContributionSpec.created_at` seam (single authoritative clock)

**Files:**
- Modify: `backend/app/contributions.py` (`ContributionSpec` dataclass; `record_contributions` insert `.values(...)`)
- Test: `backend/tests/test_contributions.py`

**Interfaces:**
- Produces: `ContributionSpec(..., created_at: datetime | None = None)`. When set, `record_contributions` writes it to `ContributionEvent.created_at`; when `None`, the DB `server_default` (`func.now()`) applies (unchanged behavior for all existing callers).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_contributions.py` (it already imports `ContributionEvent`, `UserContributionStats`, `session`, and has helpers; add these imports if missing: `from datetime import UTC, datetime, timedelta`, `from sqlalchemy import select`, `from app.contributions import ContributionSpec, record_contributions`):

```python
async def test_created_at_override_is_persisted(session, test_user):
    pinned = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=test_user.id,
                event_type="add_note",
                dedup_key="created-at-override-test",
                target_type="note",
                created_at=pinned,
            )
        ],
    )
    got = (
        await session.execute(
            select(ContributionEvent.created_at).where(
                ContributionEvent.dedup_key == "created-at-override-test"
            )
        )
    ).scalar_one()
    assert got == pinned
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_contributions.py::test_created_at_override_is_persisted -v`
Expected: FAIL — `ContributionSpec.__init__() got an unexpected keyword argument 'created_at'`.

- [ ] **Step 3: Add the field to the dataclass**

In `backend/app/contributions.py`, add to `ContributionSpec` (after `parent_event_id`):

```python
    parent_event_id: uuid.UUID | None = None
    # Optional authoritative timestamp. When set, record_contributions writes it to
    # ContributionEvent.created_at instead of the DB server_default — so the condition
    # point-window gate (#124) compares one clock (report_time), not insert-time skew.
    created_at: datetime | None = None
```

Ensure the imports at the top of `contributions.py` include `datetime`:

```python
from datetime import datetime, timedelta
```

- [ ] **Step 4: Use it in the insert**

In `record_contributions`, replace the `pg_insert(ContributionEvent).values(...)` block so `created_at` is included only when provided:

```python
        values = dict(
            id=uuid.uuid4(),
            user_id=spec.user_id,
            fountain_id=spec.fountain_id,
            target_type=spec.target_type,
            target_id=spec.target_id,
            event_type=spec.event_type,
            points=points_for(spec.event_type),
            location=spec.location,
            dedup_key=spec.dedup_key,
            event_metadata=spec.event_metadata,
            parent_event_id=spec.parent_event_id,
        )
        if spec.created_at is not None:
            values["created_at"] = spec.created_at
        stmt = (
            pg_insert(ContributionEvent)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["dedup_key"])
            .returning(
                ContributionEvent.id,
                ContributionEvent.user_id,
                ContributionEvent.event_type,
                ContributionEvent.points,
            )
        )
        row = (await session.execute(stmt)).first()
        if row is not None:
            inserted.append(row)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_contributions.py -v`
Expected: PASS (new test + all existing contribution tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/contributions.py backend/tests/test_contributions.py
git commit -m "feat(backend): add ContributionSpec.created_at seam for single-clock awards (#124)"
```

---

## Task 2: Condition point-window primitives

**Files:**
- Modify: `backend/app/contributions.py` (remove `dk_verify`/`dk_report_condition`; add `dk_condition_award`, `CONDITION_EVENT_TYPES`, `CONDITION_POINT_WINDOW`, `condition_points_eligible_at`, `latest_awarded_condition_at`)
- Test: `backend/tests/test_contributions.py`

**Interfaces:**
- Consumes: Task 1's `ContributionSpec.created_at`.
- Produces:
  - `dk_condition_award(report_id: uuid.UUID) -> str` → `f"cond_award:{report_id}"`
  - `CONDITION_EVENT_TYPES: tuple[str, str] = ("verify_working", "report_condition")`
  - `CONDITION_POINT_WINDOW: timedelta` (24h)
  - `condition_points_eligible_at(last_awarded_at: datetime | None, now: datetime) -> datetime | None` — returns when the user becomes eligible again, or `None` if eligible now.
  - `async latest_awarded_condition_at(session, user_id, fountain_id) -> datetime | None`

- [ ] **Step 1: Write the failing tests (pure helper boundary)**

Add to `backend/tests/test_contributions.py`:

```python
from app.contributions import (
    CONDITION_POINT_WINDOW,
    condition_points_eligible_at,
    dk_condition_award,
    latest_awarded_condition_at,
)


def test_condition_points_eligible_at_boundary():
    now = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
    # No prior award -> eligible now.
    assert condition_points_eligible_at(None, now) is None
    # Prior award exactly 24h ago -> eligible now (boundary is inclusive of eligibility).
    exactly = now - CONDITION_POINT_WINDOW
    assert condition_points_eligible_at(exactly, now) is None
    # Prior award just under 24h ago -> blocked; eligible again at award + 24h.
    just_under = now - CONDITION_POINT_WINDOW + timedelta(seconds=1)
    assert condition_points_eligible_at(just_under, now) == just_under + CONDITION_POINT_WINDOW


def test_dk_condition_award_is_per_report():
    a, b = uuid.uuid4(), uuid.uuid4()
    assert dk_condition_award(a) == f"cond_award:{a}"
    assert dk_condition_award(a) != dk_condition_award(b)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/test_contributions.py::test_condition_points_eligible_at_boundary tests/test_contributions.py::test_dk_condition_award_is_per_report -v`
Expected: FAIL — `ImportError` (names not defined).

- [ ] **Step 3: Implement the primitives**

In `backend/app/contributions.py`: (a) add `select` to the SQLAlchemy import — `from sqlalchemy import func, select, update`; (b) **remove** the `dk_verify` and `dk_report_condition` functions; (c) add near the other `dk_*` builders:

```python
def dk_condition_award(report_id: uuid.UUID) -> str:
    # Per-report key: the rolling-24h query (#124) is the real limiter, so this only guards
    # exact double-processing of one report row (ON CONFLICT DO NOTHING).
    return f"cond_award:{report_id}"
```

Before removing the two old builders, sweep for references so nothing breaks at import time:
`grep -rn "dk_verify\|dk_report_condition" backend` — expect hits only in `app/routers/fountains.py` (rewritten in Task 5) and possibly a unit test in `backend/tests/test_contributions.py`; update or delete any such test (the per-day-key behavior is replaced by the rolling gate, covered by the new tests here and in Task 5).

(d) add module constants near `POINTS`:

```python
# The two coalesced condition event types the 24h point window (#124) covers.
CONDITION_EVENT_TYPES: tuple[str, str] = ("verify_working", "report_condition")
CONDITION_POINT_WINDOW = timedelta(hours=24)
```

(e) add the pure helper and the DB lookback (place after `points_for`, and the lookback near the query helpers):

```python
def condition_points_eligible_at(
    last_awarded_at: datetime | None, now: datetime
) -> datetime | None:
    """Given the user's most recent AWARDED condition-event time for a fountain and the
    current instant, return when they become eligible to earn condition points again — or
    None if they are eligible now. A prior award at exactly now - 24h is eligible (#124)."""
    if last_awarded_at is None:
        return None
    eligible_at = last_awarded_at + CONDITION_POINT_WINDOW
    return eligible_at if eligible_at > now else None


async def latest_awarded_condition_at(
    session: AsyncSession, user_id: uuid.UUID, fountain_id: uuid.UUID
) -> datetime | None:
    """Most recent AWARDED condition event created_at for (user, fountain), or None.
    Matches on event_type + status (NOT dedup_key), so legacy calendar-day rows count."""
    return (
        await session.execute(
            select(ContributionEvent.created_at)
            .where(
                ContributionEvent.user_id == user_id,
                ContributionEvent.fountain_id == fountain_id,
                ContributionEvent.event_type.in_(CONDITION_EVENT_TYPES),
                ContributionEvent.status == "awarded",
            )
            .order_by(ContributionEvent.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
```

- [ ] **Step 4: Write the failing DB-lookback test**

Add to `backend/tests/test_contributions.py`:

```python
async def test_latest_awarded_condition_at_reads_legacy_keys(session, test_user):
    fid = uuid.uuid4()
    # Simulate a legacy calendar-day-keyed award row (old dk_verify shape).
    t = datetime(2026, 5, 1, 9, 0, tzinfo=UTC)
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=test_user.id,
                event_type="verify_working",
                dedup_key=f"verify:{test_user.id}:{fid}:20260501",
                fountain_id=fid,
                target_type="condition_report",
                target_id=uuid.uuid4(),
                created_at=t,
            )
        ],
    )
    assert await latest_awarded_condition_at(session, test_user.id, fid) == t
```

Note: this test inserts with a raw `fountain_id`/`target_id` (no FK enforcement on `contribution_events.target_id`; `fountain_id` is a real FK, so create a fountain first if the FK bites — if it does, add `fid = await _make_fountain(session)` using the existing fountain-creation helper in this test module, or insert a `Fountain` row directly).

- [ ] **Step 5: Run tests to verify pass**

Run: `cd backend && uv run pytest tests/test_contributions.py -v`
Expected: PASS. (If the `fountain_id` FK rejects a random UUID, create a fountain row first as noted, then re-run.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/contributions.py backend/tests/test_contributions.py
git commit -m "feat(backend): condition point-window primitives + rolling-24h eligibility helper (#124)"
```

---

## Task 3: Partial composite index (models + migration 0020)

**Files:**
- Modify: `backend/app/models.py` (`ContributionEvent.__table_args__`)
- Create: `backend/migrations/versions/0020_condition_award_window_index.py`
- Test: `backend/tests/test_condition_award_window_index_migration.py`

**Interfaces:**
- Produces: index `ix_contribution_events_condition_window` on `(user_id, fountain_id, created_at)` partial `WHERE status='awarded' AND event_type IN ('verify_working','report_condition')`. Serves the `ORDER BY created_at DESC LIMIT 1` lookback (btree scanned backwards).

- [ ] **Step 1: Write the failing migration-name assertion test**

Create `backend/tests/test_condition_award_window_index_migration.py` (mirror `test_fountains_geometry_gist_migration.py` — query `pg_indexes`):

```python
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_condition_award_window_index_exists(session):
    row = (
        await session.execute(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE indexname = 'ix_contribution_events_condition_window'"
            )
        )
    ).scalar_one_or_none()
    assert row is not None, "index missing — did migration 0020 run?"
    lowered = row.lower()
    assert "user_id" in lowered and "fountain_id" in lowered and "created_at" in lowered
    assert "status = 'awarded'" in lowered
    assert "verify_working" in lowered and "report_condition" in lowered
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/test_condition_award_window_index_migration.py -v`
Expected: FAIL — index missing (assert `row is not None`).

- [ ] **Step 3: Add the index to the ORM model**

In `backend/app/models.py`, add to `ContributionEvent.__table_args__` (after the existing `Index(...)` entries; `text` is already imported in this module):

```python
        # Rolling-24h condition point-window lookback (#124): ORDER BY created_at DESC LIMIT 1
        # over one (user, fountain). Partial → tiny; plain columns → alembic-drift-clean.
        Index(
            "ix_contribution_events_condition_window",
            "user_id",
            "fountain_id",
            "created_at",
            postgresql_where=text(
                "status = 'awarded' AND event_type IN ('verify_working', 'report_condition')"
            ),
        ),
```

- [ ] **Step 4: Create the migration**

Create `backend/migrations/versions/0020_condition_award_window_index.py`:

```python
"""condition award window partial index (#124 repeat-contribution point limit)

Revision ID: 0020_condition_award_window_index
Revises: 0019_photo_reports
Create Date: 2026-07-04
"""

import sqlalchemy as sa
from alembic import op

revision = "0020_condition_award_window_index"
down_revision = "0019_photo_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_contribution_events_condition_window",
        "contribution_events",
        ["user_id", "fountain_id", "created_at"],
        postgresql_where=sa.text(
            "status = 'awarded' AND event_type IN ('verify_working', 'report_condition')"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_contribution_events_condition_window",
        table_name="contribution_events",
    )
```

- [ ] **Step 5: Apply, check drift, run the test**

Run:
```bash
cd backend && uv run alembic upgrade head && uv run alembic check && uv run pytest tests/test_condition_award_window_index_migration.py -v
```
Expected: `alembic upgrade` applies `0020`; `alembic check` reports **no drift** (the `__table_args__` mirror matches); test PASSES. If `alembic check` reports the index as drift, confirm the `postgresql_where` text in the model and the migration are byte-identical.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/0020_condition_award_window_index.py backend/tests/test_condition_award_window_index_migration.py
git commit -m "feat(backend): add partial index for condition point-window lookback (#124)"
```

---

## Task 4: `FountainDetail` fields + `serialize_fountain_detail` eligibility

**Files:**
- Modify: `backend/app/schemas.py` (`FountainDetail`)
- Modify: `backend/app/routers/fountains.py` (`serialize_fountain_detail`)
- Test: `backend/tests/test_conditions_api.py`

**Interfaces:**
- Consumes: Task 2's `latest_awarded_condition_at`, `condition_points_eligible_at`.
- Produces: `FountainDetail.condition_points_eligible_at: datetime | None`, `FountainDetail.condition_points_awarded: int | None`; `serialize_fountain_detail(session, fountain, user_id=None, condition_points_awarded=None)`.

- [ ] **Step 1: Write the failing GET test**

Add to `backend/tests/test_conditions_api.py` (it already has `_add_fountain`, `_report`, the `client`, `test_user`, `session` fixtures; add `from datetime import UTC, datetime, timedelta` and `from app.models import ContributionEvent` if not present):

```python
async def test_detail_exposes_condition_points_eligible_at(client, test_user):
    fid = await _add_fountain(client)
    # Before any condition report: eligible now -> null.
    before = (await client.get(f"/api/v1/fountains/{fid}")).json()
    assert before["condition_points_eligible_at"] is None
    assert before["condition_points_awarded"] is None
    # After a working report: eligible-again timestamp in the future.
    await _report(client, fid, "working")
    after = (await client.get(f"/api/v1/fountains/{fid}")).json()
    assert after["condition_points_eligible_at"] is not None
    assert after["condition_points_awarded"] is None  # GET never sets the award count
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/test_conditions_api.py::test_detail_exposes_condition_points_eligible_at -v`
Expected: FAIL — `KeyError: 'condition_points_eligible_at'` (field absent).

- [ ] **Step 3: Add the schema fields**

In `backend/app/schemas.py`, add to `FountainDetail` (after `attributes`):

```python
    # #124 repeat-contribution point limit. Both additive + nullable (no response-shape break):
    # eligibility is a per-viewer pre-submit HINT for the warning (null = eligible now / anon);
    # awarded is set only on the condition POST (3/2/0), null on GET and other responses.
    condition_points_eligible_at: datetime | None = None
    condition_points_awarded: int | None = None
```

- [ ] **Step 4: Compute eligibility in `serialize_fountain_detail`**

In `backend/app/routers/fountains.py`, extend the signature and compute the hint. Add the imports (`condition_points_eligible_at`, `latest_awarded_condition_at`) to the existing `from app.contributions import (...)` block. Change the signature:

```python
async def serialize_fountain_detail(
    session: AsyncSession,
    fountain: Fountain,
    user_id: uuid.UUID | None = None,
    condition_points_awarded: int | None = None,
) -> FountainDetail:
```

Near where `your_stars` is computed (also gated on `user_id is not None`), add:

```python
    condition_points_eligible = None
    if user_id is not None:
        condition_points_eligible = condition_points_eligible_at(
            await latest_awarded_condition_at(session, user_id, fountain.id),
            datetime.now(tz=UTC),
        )
```

Then add both kwargs to the existing `return FountainDetail(...)` construction:

```python
        condition_points_eligible_at=condition_points_eligible,
        condition_points_awarded=condition_points_awarded,
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd backend && uv run pytest tests/test_conditions_api.py -v`
Expected: PASS (new test + existing condition API tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/fountains.py backend/tests/test_conditions_api.py
git commit -m "feat(backend): expose per-viewer condition_points_eligible_at on FountainDetail (#124)"
```

---

## Task 5: `submit_condition` rolling gate + `condition_points_awarded`

**Files:**
- Modify: `backend/app/routers/fountains.py` (`submit_condition`, ~lines 964–1031; import swap)
- Test: `backend/tests/test_conditions_api.py`

**Interfaces:**
- Consumes: Task 2 primitives; Task 4's `serialize_fountain_detail(..., condition_points_awarded=...)`.
- Produces: the condition POST awards at most one point-earning condition event per (user, fountain) per rolling 24h; the 200 body's `condition_points_awarded` is 3/2/0.

- [ ] **Step 1: Write the failing behavior tests**

Add to `backend/tests/test_conditions_api.py`:

```python
async def _total_points(session, user_id):
    from app.models import UserContributionStats
    from sqlalchemy import select

    return (
        await session.execute(
            select(UserContributionStats.total_points).where(
                UserContributionStats.user_id == user_id
            )
        )
    ).scalar_one_or_none() or 0


async def test_repeat_condition_within_24h_awards_zero(client, test_user, session):
    fid = await _add_fountain(client)
    r1 = await _report(client, fid, "working")
    assert r1.json()["condition_points_awarded"] == 3
    p1 = await _total_points(session, test_user.id)
    # A different condition type on the same fountain within 24h is coalesced -> 0.
    r2 = await _report(client, fid, "broken")
    assert r2.json()["condition_points_awarded"] == 0
    assert await _total_points(session, test_user.id) == p1
    # The report row still persisted (data always persists).
    from app.models import ConditionReport
    from sqlalchemy import func, select

    n = (
        await session.execute(
            select(func.count()).select_from(ConditionReport).where(
                ConditionReport.user_id == test_user.id
            )
        )
    ).scalar_one()
    assert n == 2


async def test_condition_awards_again_after_window(client, test_user, session):
    from app.models import ContributionEvent
    from sqlalchemy import update

    fid = await _add_fountain(client)
    await _report(client, fid, "working")  # awards 3
    # Age the awarded event to just over 24h ago so the next report is eligible.
    await session.execute(
        update(ContributionEvent)
        .where(ContributionEvent.user_id == test_user.id)
        .values(created_at=datetime.now(tz=UTC) - timedelta(hours=24, minutes=1))
    )
    await session.commit()
    r = await _report(client, fid, "working")
    assert r.json()["condition_points_awarded"] == 3


async def test_legacy_calendar_key_blocks_new_award(client, test_user, session):
    from app.contributions import ContributionSpec, record_contributions

    fid = await _add_fountain(client)
    # Seed a legacy calendar-day-keyed award 1h ago (old dk_verify shape).
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=test_user.id,
                event_type="verify_working",
                dedup_key=f"verify:{test_user.id}:{fid}:legacy",
                fountain_id=fid,
                target_type="condition_report",
                target_id=__import__("uuid").uuid4(),
                created_at=datetime.now(tz=UTC) - timedelta(hours=1),
            )
        ],
    )
    await session.commit()
    r = await _report(client, fid, "working")
    assert r.json()["condition_points_awarded"] == 0
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_conditions_api.py -k "repeat_condition or after_window or legacy_calendar" -v`
Expected: FAIL — `condition_points_awarded` is `None`/absent and repeat still awards (old per-day dedup).

- [ ] **Step 3: Swap imports**

In `backend/app/routers/fountains.py`, update the `from app.contributions import (...)` block: **remove** `dk_report_condition`, `dk_verify`; **add** `condition_points_eligible_at`, `dk_condition_award`, `latest_awarded_condition_at`, `points_for` (keep `ContributionSpec`, `record_contributions`, and the other `dk_*` used elsewhere).

- [ ] **Step 4: Rewrite the gate in `submit_condition`**

Replace the current block (from `day = report_time.strftime("%Y%m%d")` through the `return await serialize_fountain_detail(...)`) with:

```python
    is_verify = payload.status == "working"
    # Rolling-24h, coalesced point gate (#124). The Fountain FOR UPDATE lock above serialises
    # condition writes per fountain, so a single user cannot race two awards past this check.
    last_awarded_at = await latest_awarded_condition_at(session, user.id, fountain.id)
    eligible = condition_points_eligible_at(last_awarded_at, report_time) is None
    points_awarded = 0
    if eligible:
        event_type = "verify_working" if is_verify else "report_condition"
        spec = ContributionSpec(
            user_id=user.id,
            event_type=event_type,
            dedup_key=dk_condition_award(report.id),
            fountain_id=fountain.id,
            location=point_geography(float(lat), float(lng)),
            target_type="condition_report",
            target_id=report.id,
            event_metadata={"status": payload.status},
            created_at=report_time,
        )
        inserted = await record_contributions(session, [spec])
        points_awarded = points_for(event_type) if inserted else 0
    await session.commit()
    await session.refresh(fountain)
    logger.info(
        "condition reported fountain=%s user=%s report=%s status=%s current_status=%s->%s "
        "points_awarded=%d",
        fountain.id,
        user.id,
        report.id,
        payload.status,
        prev_status,
        fountain.current_status,
        points_awarded,
    )
    return await serialize_fountain_detail(
        session, fountain, user_id=user.id, condition_points_awarded=points_awarded
    )
```

- [ ] **Step 5: Run the full condition + contributions suites**

Run: `cd backend && uv run pytest tests/test_conditions_api.py tests/test_contributions.py -v`
Expected: PASS. Note: the existing `test_event_emitted_with_target_and_per_day_dedup` asserts "second report same day → no extra points" — still true under the rolling gate (second is within 24h), so it keeps passing; if it asserts on the old `verify:...:YYYYMMDD` dedup_key shape, update it to assert `condition_points_awarded == 0` and unchanged `total_points`.

- [ ] **Step 6: Run the backend CI mirror**

Run: `./run.ps1 check -Backend`
Expected: ruff clean, `alembic check` no drift, all pytest green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/fountains.py backend/tests/test_conditions_api.py
git commit -m "feat(backend): rolling-24h coalesced condition point gate + condition_points_awarded (#124)"
```

---

## Task 6: Regenerate OpenAPI + api-client artifacts

**Files:**
- Modify (generated): `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`
- Verify: `backend/tests/test_openapi.py`

**Interfaces:**
- Produces: TS type `components["schemas"]["FountainDetail"]` gains `condition_points_eligible_at?: string | null` and `condition_points_awarded?: number | null` for all downstream clients.

- [ ] **Step 1: Regenerate**

Run: `pnpm --filter @fountainrank/api-client run generate`
(Equivalently `./run.ps1 generate`.) This runs `app.export_openapi` (DB-free) → `openapi.json`, then `openapi-typescript` → `schema.d.ts`.

- [ ] **Step 2: Verify the new fields are present**

Run: `grep -n "condition_points_eligible_at\|condition_points_awarded" packages/api-client/src/schema.d.ts`
Expected: both appear under the `FountainDetail` schema as optional nullable fields.

- [ ] **Step 3: Run the OpenAPI + api-client checks**

Run: `cd backend && uv run pytest tests/test_openapi.py -v` and `pnpm --filter @fountainrank/api-client typecheck`
Expected: PASS. If `test_openapi.py` pins an exact schema snapshot, update the expectation to include the two new fields.

- [ ] **Step 4: Commit**

```bash
git add packages/api-client/openapi.json packages/api-client/src/schema.d.ts backend/tests/test_openapi.py
git commit -m "chore(api-client): regenerate OpenAPI + types for condition point fields (#124)"
```

---

## Task 7: Shared `conditionPointsBlocked` helper

**Files:**
- Modify: `packages/contributions/src/index.ts`
- Test: `packages/contributions/src/index.test.ts`

**Interfaces:**
- Produces: `conditionPointsBlocked(eligibleAt: string | null | undefined, now: Date): boolean` — true iff `eligibleAt` is a timestamp strictly in the future (the pre-submit "won't earn points" state, used by both clients).

- [ ] **Step 1: Write the failing test**

Add to `packages/contributions/src/index.test.ts`:

```ts
import { conditionPointsBlocked } from "./index";

describe("conditionPointsBlocked", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  it("is false when eligibility is null/undefined (eligible now)", () => {
    expect(conditionPointsBlocked(null, now)).toBe(false);
    expect(conditionPointsBlocked(undefined, now)).toBe(false);
  });
  it("is true when eligibility is in the future", () => {
    expect(conditionPointsBlocked("2026-06-01T18:00:00Z", now)).toBe(true);
  });
  it("is false when eligibility is now or in the past", () => {
    expect(conditionPointsBlocked("2026-06-01T12:00:00Z", now)).toBe(false);
    expect(conditionPointsBlocked("2026-06-01T06:00:00Z", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fountainrank/contributions test`
Expected: FAIL — `conditionPointsBlocked` is not exported.

- [ ] **Step 3: Implement**

Add to `packages/contributions/src/index.ts`:

```ts
/**
 * Pre-submit hint (#124): true when the viewer already earned condition points on this
 * fountain within the last 24h, so a new condition report will earn 0. Best-effort — the
 * server is authoritative for the actual award (condition_points_awarded on the POST).
 */
export function conditionPointsBlocked(
  eligibleAt: string | null | undefined,
  now: Date,
): boolean {
  return eligibleAt != null && new Date(eligibleAt).getTime() > now.getTime();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @fountainrank/contributions test && pnpm --filter @fountainrank/contributions typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contributions/src/index.ts packages/contributions/src/index.test.ts
git commit -m "feat(contributions): add conditionPointsBlocked pre-submit hint helper (#124)"
```

---

## Task 8: Web — warning, truthful points, prop plumbing

**Files:**
- Modify: `web/app/actions/contribute.ts`, `web/components/fountain/ConditionForm.tsx`, `web/components/fountain/ContributeSection.tsx`, `web/components/fountain/FountainDetail.tsx`
- Test: `web/components/fountain/ConditionForm.test.tsx`

**Interfaces:**
- Consumes: `condition_points_awarded`, `condition_points_eligible_at` (Task 6 types); `conditionPointsBlocked` (Task 7).
- Produces: `ActionResult` success `{ ok: true; pointsAwarded?: number }`; `ConditionForm` accepts `conditionPointsEligibleAt?: string | null`.

- [ ] **Step 1: Extend the server action to carry awarded points**

In `web/app/actions/contribute.ts`:

Change the success type and `mapStatus` to accept an optional awarded count:

```ts
export type ActionResult = { ok: true; pointsAwarded?: number } | { ok: false; error: ContributeError };
```

In `run()`, read the response body and thread the award count. Change the `call` return type and the destructure:

```ts
    call: (
      client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>,
    ) => Promise<{ response?: { status: number }; data?: { condition_points_awarded?: number | null } }>,
```

and in the `try`:

```ts
      const { response, data } = await call(client);
      const status = response?.status ?? 0;
      if (status >= 200 && status < 300) {
        revalidatePath(`/fountains/${fountainId}`);
        revalidatePath("/");
        const pointsAwarded =
          typeof data?.condition_points_awarded === "number"
            ? data.condition_points_awarded
            : undefined;
        log("info", "contribute action", { requestId, action, fountainId, status });
        return { ok: true, pointsAwarded };
      }
      const result = mapStatus(status);
      log("warn", "contribute action", { requestId, action, fountainId, status });
      return result;
```

(Leave `mapStatus` handling the non-2xx branches as-is.)

- [ ] **Step 2: Write the failing web form tests**

Extend `web/components/fountain/ConditionForm.test.tsx`:

```ts
it("shows the ineligible warning when conditionPointsEligibleAt is in the future", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  render(<ConditionForm fountainId="fid" conditionPointsEligibleAt={future} />);
  expect(screen.getByText(/won't earn points/i)).toBeInTheDocument();
  // Warn, don't block: the submit control stays enabled.
  expect(screen.getByRole("button", { name: /i checked/i })).not.toBeDisabled();
});

it("celebrates the server's awarded points, not a client guess", async () => {
  submitCondition.mockResolvedValue({ ok: true, pointsAwarded: 0 });
  render(<ConditionForm fountainId="fid" />);
  fireEvent.click(screen.getByRole("button", { name: /i checked/i }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(/already counted recently/i),
  );
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter web test -- ConditionForm`
Expected: FAIL — prop not accepted / warning + zero-award copy absent.

- [ ] **Step 4: Update `ConditionForm`**

In `web/components/fountain/ConditionForm.tsx`: accept the new prop, import the helper, render the warning, and drive the success message from `pointsAwarded`:

```tsx
import { conditionPointsBlocked, conditionPointsPreview } from "@fountainrank/contributions";
// ...
export function ConditionForm({
  fountainId,
  conditionPointsEligibleAt,
}: {
  fountainId: string;
  conditionPointsEligibleAt?: string | null;
}) {
  // ...
  const blocked = conditionPointsBlocked(conditionPointsEligibleAt, new Date());
  // ...
  function report(status: ConditionStatus) {
    start(async () => {
      const res = await submitCondition(fountainId, status);
      if (res.ok) {
        const earned = res.pointsAwarded ?? 0;
        setMsg({
          tone: "ok",
          text:
            earned > 0
              ? `Thanks — you earned ${earned} points.`
              : "Thanks — saved. (Already counted recently, so no points this time.)",
        });
        window.dispatchEvent(new Event("fountainrank:contribution"));
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }
```

And near the `<PointsPreview .../>` block, show the warning instead of the "+possible points" estimate when blocked:

```tsx
        <div className="mt-3">
          {blocked ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800">
              You&rsquo;ve earned points for updating this fountain recently — you can still
              update its status, but it won&rsquo;t earn points right now.
            </p>
          ) : (
            <PointsPreview lines={conditionPointsPreview(showProblems ? "problem" : "working")} />
          )}
        </div>
```

- [ ] **Step 5: Thread the prop from the parent**

In `web/components/fountain/ContributeSection.tsx`, add `conditionPointsEligibleAt` to the props and forward it:

```tsx
export function ContributeSection({
  fountainId,
  dimensions,
  isAuthenticated,
  conditionPointsEligibleAt,
}: {
  fountainId: string;
  dimensions: Dimension[];
  isAuthenticated: boolean;
  conditionPointsEligibleAt?: string | null;
}) {
  // ...
  <ConditionForm fountainId={fountainId} conditionPointsEligibleAt={conditionPointsEligibleAt} />
```

In `web/components/fountain/FountainDetail.tsx`, pass it from `detail`:

```tsx
        <ContributeSection
          fountainId={detail.id}
          dimensions={detail.dimensions}
          isAuthenticated={isAuthenticated}
          conditionPointsEligibleAt={detail.condition_points_eligible_at}
        />
```

- [ ] **Step 6: Run web checks**

Run: `pnpm --filter web test -- ConditionForm && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/app/actions/contribute.ts web/components/fountain/ConditionForm.tsx web/components/fountain/ContributeSection.tsx web/components/fountain/FountainDetail.tsx web/components/fountain/ConditionForm.test.tsx
git commit -m "feat(web): condition point-limit warning + server-authoritative award feedback (#124)"
```

---

## Task 9: Mobile — truthful points + warning plumbing

**Files:**
- Modify: `mobile/app/fountains/[id].tsx`, `mobile/components/fountain/ConditionContributionForm.tsx`

**Interfaces:**
- Consumes: `condition_points_awarded`, `condition_points_eligible_at` (Task 6 types); `conditionPointsBlocked` (Task 7).
- Produces: mobile celebration reads the server award; the form shows the pre-submit warning.

Note: mobile has **no RN render-test harness** (all mobile tests are Vitest over pure `lib/**`); the testable logic (`conditionPointsBlocked`) is already unit-tested in Task 7. This task is wiring, verified by `tsc` + lint + the existing Vitest suite.

- [ ] **Step 1: Use the server's awarded points for the celebration**

In `mobile/app/fountains/[id].tsx`, change `conditionMutation.onSuccess` to read the server value instead of the hardcoded `CONTRIBUTION_POINTS` constant:

```tsx
    onSuccess: (detail) => refreshDetailAfterWrite(detail, detail.condition_points_awarded ?? 0),
```

(You can drop the now-unused `body` arg and the `CONTRIBUTION_POINTS.verify_working/report_condition` branch here. Keep the `CONTRIBUTION_POINTS` import if the rating/attribute mutations still use it — they do.)

- [ ] **Step 2: Thread eligibility into the form**

Still in `[id].tsx`, pass the detail's eligibility hint to the form (the detail is the query data in scope, e.g. `detailQuery.data`):

```tsx
                  <ConditionContributionForm
                    fountainId={fountainId}
                    pending={conditionMutation.isPending}
                    conditionPointsEligibleAt={detailQuery.data?.condition_points_eligible_at}
                    onSubmit={async (body) => {
                      try {
                        await conditionMutation.mutateAsync(body);
                        return { ok: true };
                      } catch (error) {
                        return handleMutationError(error);
                      }
                    }}
                  />
```

- [ ] **Step 3: Render the warning in the form**

In `mobile/components/fountain/ConditionContributionForm.tsx`, accept the prop, compute `blocked`, and render a warning instead of the "+possible points" preview when blocked:

```tsx
import { conditionPointsBlocked, conditionPointsPreview } from "@fountainrank/contributions";
// ...
export function ConditionContributionForm({
  fountainId,
  pending,
  onSubmit,
  conditionPointsEligibleAt,
}: {
  fountainId: string;
  pending: boolean;
  onSubmit: (
    body: ConditionReportRequest,
  ) => Promise<{ ok: true } | { ok: false; error: ContributionError }>;
  conditionPointsEligibleAt?: string | null;
}) {
  const blocked = conditionPointsBlocked(conditionPointsEligibleAt, new Date());
  // ...
```

Replace each of the two `<PointsPreview lines={conditionPointsPreview(...)} />` renders with a conditional:

```tsx
      {blocked ? (
        <Text style={styles.limitNote}>
          You&rsquo;ve earned points for updating this fountain recently — you can still update
          its status, but it won&rsquo;t earn points right now.
        </Text>
      ) : (
        <PointsPreview lines={conditionPointsPreview("working")} />
      )}
```

(Do the same for the `"problem"` preview near the "Submit problem" button — render the warning once, or gate both previews on `blocked`. Add a `limitNote` style mirroring the existing muted/`typography.meta` style with an amber tone.)

- [ ] **Step 4: Run mobile checks**

Run (from `mobile/`): `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. (`pnpm test` runs the existing Vitest unit suite, incl. the `packages/contributions` helper via the monorepo runner if configured; otherwise the helper is covered in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add mobile/app/fountains/[id].tsx mobile/components/fountain/ConditionContributionForm.tsx
git commit -m "feat(mobile): condition point-limit warning + server-authoritative award feedback (#124)"
```

---

## Task 10: Style guide + wrap-up

**Files:**
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Document the new UI element**

Add a "Points-ineligible inline warning" entry to `docs/style-guide.md` (purpose, when it appears — condition report within the 24h window; web: amber inline note; mobile: amber `Text`; states: shown iff `condition_points_eligible_at` is in the future; submit stays enabled; accessibility: it is advisory text, not an error, and does not disable the control). Include the web JSX snippet from Task 8 Step 4 and the mobile snippet from Task 9 Step 3.

- [ ] **Step 2: Full local CI mirror**

Run: `./run.ps1 check`
Expected: backend (ruff + alembic check + pytest), web (typecheck/lint/test/build), mobile (typecheck/lint/test) all green.

- [ ] **Step 3: Commit**

```bash
git add docs/style-guide.md
git commit -m "docs: document the points-ineligible inline warning element (#124)"
```

- [ ] **Step 4: Open the PR and run the gates**

Push the branch, open the PR (`gh pr create`), get CI green, run the Codex PR-review loop to `VERDICT: APPROVED`, address every PR comment, then squash-merge (per `claude_help/codex-review-process.md`).

---

## Self-Review notes (coverage vs spec)

- Rolling-24h gate + coalescing + single clock → Tasks 1, 2, 5. Boundary (==24h eligible, just-under ineligible) → Task 2 pure test + Task 5 API tests. Legacy rows honored → Task 2 + Task 5. Data-always-persists → Task 5 test. Concurrency relies on the pre-existing `FOR UPDATE` lock (Task 5) — an explicit concurrent-request test is optional and omitted to avoid brittle timing (documented in the spec).
- Pre-submit eligibility field (per-viewer, null for anon) → Task 4. Additive/backward-compatible + no shape break → Tasks 4/6 (bare `FountainDetail` body retained). Partial index + drift-clean → Task 3. OpenAPI/api-client regen for **both** fields → Task 6.
- Server-authoritative `condition_points_awarded` (3/2/0) → Tasks 4/5; web feedback → Task 8; mobile feedback → Task 9. Pre-submit warning (warn-don't-block) web + mobile → Tasks 8/9 via shared `conditionPointsBlocked` (Task 7). Style guide → Task 10.
