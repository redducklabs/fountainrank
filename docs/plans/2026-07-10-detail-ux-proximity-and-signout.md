# Detail UX, Rating Proximity, and Mobile Sign-Out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve six reported issues on one branch — add-photo-submits-rating, celebration redesign, a best-effort 50-mile rating proximity guard, keyboard scrolling, and a correct mobile sign-out.

**Architecture:** Backend gains an optional coordinate on the rating and condition endpoints, a centralized `within_radius` geo helper, a monotonic `ratings.is_proximate` column, and a logging-only validation handler. Clients attach coordinates at submit time (never blocking on the permission prompt), lift the rating draft above the tabs so a photo upload can flush it, redraw the reward around the pin logo, fix keyboard avoidance on the detail tabs, and make mobile sign-out perform a real RP-initiated logout with `prompt=login`.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic (Python 3.13), PostGIS. Next.js (web, Vitest + RTL). Expo/React Native 0.85 New Arch (mobile, Vitest unit-only — no RN render harness). Shared `@fountainrank/api-client` (openapi-fetch + openapi-typescript) and `@fountainrank/contributions` packages. `@logto/rn` 1.2.0 (mobile), `@logto/next` (web).

## Global Constraints

- **Design source of truth:** `docs/specs/2026-07-10-detail-ux-proximity-and-signout-design.md` (Codex-approved). Every task's requirements implicitly include it.
- **This is not a security control.** The proximity guard is best-effort; coordinate-less ratings are accepted. Do not claim it enforces "all ratings within 50 mi" (spec §1.1, §8).
- **`ratings.is_proximate` is monotonic:** `is_proximate = ratings.is_proximate OR excluded.is_proximate`. A no-coordinate re-rate must never downgrade a prior `true` (spec §4.5).
- **Coordinates are used and discarded.** Never persist, never log the submitted coordinates or the computed distance. The `RequestValidationError` handler logs field-name + error-type only, and returns FastAPI's default 422 body **byte-for-byte unchanged** (spec §6, §7).
- **All proximity SQL goes through `geo.within_radius(...)`.** No bare `ST_DWithin` in a route handler (spec §4.5).
- **Regenerate generated artifacts:** after any backend schema change, run `./run.ps1 generate` and **commit** `packages/api-client/openapi.json` + `packages/api-client/src/schema.d.ts`.
- **A failed rating never blocks the (ungated) photo upload** (spec §4.1).
- **No new animation dependency.** Mobile uses built-in `Animated`; web uses CSS. No Reanimated/Lottie/framer-motion/confetti. CI's `minimumReleaseAge` gate blocks deps < 24h anyway.
- **Commit order (each commit leaves the tree green):** Phase A backend #3 → Phase B #3 clients → Phase C #1 → Phase D #2/#5 → Phase E #4 → Phase F #6. Conventional Commits; **no AI attribution; no time estimates.**
- **CI is the source of truth.** Backend mirror: `./run.ps1 check -Backend` (ruff check + ruff format --check + alembic upgrade head + alembic check + pytest). JS: `pnpm --filter <pkg> typecheck|lint|test`. Mobile component render, full JS suites, expo-doctor, and React-Compiler lint are **CI-only** on this Windows/WSL host (`claude_help/local-dev.md`).
- **#6 does not close on merge.** Two Logto-console changes (register post-logout redirect URI; Google connector Prompts = `select_account`) are a release gate documented in `docs/setup/06-logto.md` (spec §4.6.3).

---

## File Structure

**Backend**
- `backend/app/geo.py` — add `within_radius(location_col, latitude, longitude, radius_m)`.
- `backend/app/config.py` — add `rating_max_distance_m = 80_467.0`, `proximate_radius_m = 100.0`.
- `backend/app/models.py` — add `Rating.is_proximate`.
- `backend/migrations/versions/0023_ratings_is_proximate.py` — additive column, reversible.
- `backend/app/schemas.py` — `RateRequest` + `ConditionReportRequest` gain optional `latitude`/`longitude`; both-or-neither validators; `ConditionReportRequest.is_proximate` deprecated + `true` rejected via validator.
- `backend/app/routers/fountains.py` — `submit_ratings` proximity gate + monotonic upsert; `submit_condition` server-derives `is_proximate`.
- `backend/app/main.py` — add `RequestValidationError` handler (logging-only).
- `backend/tests/test_fountains.py`, `backend/tests/test_contributions.py` — new tests.

**Generated**
- `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts` — regenerated + committed.

**Shared**
- `packages/contributions/src/index.ts` — add pure `isRatingDraftDirty(...)` (+ tests).

**Web**
- `web/app/actions/contribute.ts` — `submitRating`/`submitCondition` accept optional coords; `mapStatus` maps 403 → `too_far`; `ContributeError` gains `too_far`.
- `web/components/fountain/contributeError.ts` — copy for `too_far`.
- `web/components/fountain/FountainDetail.tsx` — `RatingDraftProvider` wrapping the tabs.
- `web/components/fountain/RatingForm.tsx`, `web/components/fountain/PhotoUpload.tsx` — consume the draft context; photo flushes the draft.
- `web/components/fountain/ConditionForm.tsx` — attach coords; drop `is_proximate`.
- `web/lib/geo/current-position.ts` (new) — browser `getCurrentPosition` wrapper.
- `web/components/map/MapStates.tsx` — `WaterCelebration` gains `points`, renders `/icon.png`.
- `web/app/globals.css` — celebration keyframes.
- `web/components/map/MapBrowser.tsx`, `web/components/contributions/ContributionStatusOverlay.tsx`, `web/components/HeaderPoints.tsx` — read `CustomEvent.detail.points`.
- `web/app/privacy/page.tsx` — location amendment.

**Mobile**
- `mobile/lib/location-request.ts` (new) — `requestCurrentCoords()` extracted from the hook.
- `mobile/hooks/useForegroundLocation.ts` — consume the extracted adapter.
- `mobile/lib/contributions/payloads.ts` — rating/condition payloads accept coords; drop hardcoded `is_proximate`.
- `mobile/lib/contributions/state.ts` — `ContributionError` gains `too_far`; map 403.
- `mobile/app/fountains/[id].tsx` — lift rating draft; add-photo flushes it; celebration wiring.
- `mobile/components/fountain/RatingContributionForm.tsx` — controlled stars.
- `mobile/components/fountain/PhotoUploadButton.tsx` — expose dirty-draft-aware submit.
- `mobile/components/fountain/FountainDetailTabs.tsx` — `KeyboardAvoidingView` + scroll props.
- `mobile/components/feedback/WaterCelebration.tsx` — pin logo.
- `mobile/lib/auth/config.ts` — `prompt: ["login","consent"]`.
- `mobile/lib/auth/logout.ts` (new) — `endSessionUrl(...)` (+ tests).
- `mobile/providers/auth-provider.tsx` — RP-initiated logout.
- `mobile/app.config.ts` — (fallback only) `softwareKeyboardLayoutMode`.

**Docs**
- `docs/style-guide.md` — redesigned celebration element.
- `docs/setup/06-logto.md` — the #6 release-gate console steps.
- `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` — retire the `is_proximate` client-asserted accepted-risk entry.

---

# Phase A — Backend #3 (proximity, condition `is_proximate`, geo helper, validation handler, migration)

## Task A1: `geo.within_radius` helper + config settings

**Files:**
- Modify: `backend/app/geo.py`
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_geo.py` (create if absent)

**Interfaces:**
- Produces: `within_radius(location_col, latitude: float, longitude: float, radius_m: float) -> ColumnElement` — a boolean `ST_DWithin(location_col::geography, point, radius_m)` expression using centralized `(lon, lat)` ordering via `point_geography`.
- Produces: `Settings.rating_max_distance_m: float = 80_467.0`, `Settings.proximate_radius_m: float = 100.0`.

- [ ] **Step 1: Write the failing test**

Add `backend/tests/test_geo.py`:

```python
from sqlalchemy import select, literal
from app.geo import point_geography, within_radius


async def test_within_radius_true_when_point_inside(session):
    # A fountain point and a query point ~10 m away; 50 m radius -> inside.
    loc = point_geography(40.0, -73.0)
    expr = within_radius(loc, 40.00005, -73.0, 50.0)
    result = (await session.execute(select(expr))).scalar_one()
    assert result is True


async def test_within_radius_false_when_point_outside(session):
    loc = point_geography(40.0, -73.0)
    expr = within_radius(loc, 41.0, -73.0, 50.0)  # ~111 km away
    result = (await session.execute(select(expr))).scalar_one()
    assert result is False
```

- [ ] **Step 2: Run it — expect failure**

Run: `./run.ps1 check -Backend` (or `uv run pytest tests/test_geo.py -v` in `backend/`).
Expected: FAIL — `ImportError: cannot import name 'within_radius'`.

- [ ] **Step 3: Implement `within_radius`**

Append to `backend/app/geo.py`:

```python
def within_radius(location_col, latitude: float, longitude: float, radius_m: float) -> ColumnElement:
    """True when `location_col` is within `radius_m` metres of (latitude, longitude).

    All proximity checks route through here so the (lon, lat) ordering lives in exactly
    one place (see point_geography). `ST_DWithin` on geography uses metres and is
    inclusive at the boundary.
    """
    return func.ST_DWithin(cast(location_col, Geography), point_geography(latitude, longitude), radius_m)
```

- [ ] **Step 4: Add config settings**

In `backend/app/config.py`, beside `first_in_area_radius_m`:

```python
    # Reject a rating whose client-supplied location is more than this far from the fountain
    # (best-effort quality guard, spec §4.5 — NOT a security control). 50 statute miles.
    rating_max_distance_m: float = 80_467.0
    # A contribution is "proximate" when the client-supplied location is within this radius of
    # the fountain (consumer GPS is ~5-20 m open-sky; 100 m is a conservative "at this fountain").
    proximate_radius_m: float = 100.0
```

- [ ] **Step 5: Run tests — expect pass**

Run: `./run.ps1 check -Backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/geo.py backend/app/config.py backend/tests/test_geo.py
git commit -m "feat(backend): add geo.within_radius helper and proximity config settings (#3)"
```

## Task A2: `ratings.is_proximate` column (model + migration)

**Files:**
- Modify: `backend/app/models.py` (`Rating`)
- Create: `backend/migrations/versions/0023_ratings_is_proximate.py`

**Interfaces:**
- Produces: `Rating.is_proximate: Mapped[bool]` (not null, default false, server_default false).

- [ ] **Step 1: Add the column to the model**

In `backend/app/models.py`, in `class Rating`, after `stars`:

```python
    # Server-computed proximity trust signal (spec §4.5). MONOTONIC: once true it never
    # downgrades — a re-rate with no location leaves a prior verified true intact. true ⟺ at
    # least one submission was within rating_max_distance_m of the fountain's location AS
    # STORED AT THAT SUBMISSION (coordinates are never persisted and cannot be re-derived).
    is_proximate: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false()
    )
```

Ensure `Boolean` and `false` are imported from `sqlalchemy` at the top of the file (add to the existing import if missing).

- [ ] **Step 2: Create the migration**

`backend/migrations/versions/0023_ratings_is_proximate.py`:

```python
"""ratings.is_proximate — server-computed proximity trust signal (#3)

Revision ID: 0023_ratings_is_proximate
Revises: 0022_account_deletion
"""

from alembic import op
import sqlalchemy as sa

revision = "0023_ratings_is_proximate"
down_revision = "0022_account_deletion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ratings",
        sa.Column(
            "is_proximate",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("ratings", "is_proximate")
```

> Confirm `down_revision` matches the actual latest head — run `uv run alembic heads` in `backend/`; if it is not `0022_account_deletion`, use the real head.

- [ ] **Step 3: Run the migration + drift check**

Run in `backend/`: `uv run alembic upgrade head && uv run alembic check`
Expected: upgrade succeeds; `alembic check` reports no drift (model matches DB).

- [ ] **Step 4: Verify reversibility**

Run: `uv run alembic downgrade -1 && uv run alembic upgrade head`
Expected: both succeed with no error.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/0023_ratings_is_proximate.py
git commit -m "feat(backend): add ratings.is_proximate column + migration 0023 (#3)"
```

## Task A3: `RateRequest` coordinates (schema + both-or-neither validation)

**Files:**
- Modify: `backend/app/schemas.py` (`RateRequest`)
- Test: `backend/tests/test_fountains.py`

**Interfaces:**
- Produces: `RateRequest.latitude: float | None`, `RateRequest.longitude: float | None`, rejected with 422 unless both present or both absent.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_fountains.py` (use existing auth/fountain fixtures — mirror a nearby rating test for the client + fountain setup):

```python
async def test_rating_latitude_without_longitude_is_422(client, existing_fountain, rating_type):
    resp = await client.post(
        f"/api/v1/fountains/{existing_fountain.id}/ratings",
        json={"ratings": [{"rating_type_id": rating_type.id, "stars": 5}], "latitude": 40.0},
    )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run it — expect failure** (currently 200/other).

Run: `uv run pytest tests/test_fountains.py::test_rating_latitude_without_longitude_is_422 -v`

- [ ] **Step 3: Extend `RateRequest`**

Replace `RateRequest` in `backend/app/schemas.py`:

```python
class RateRequest(BaseModel):
    ratings: list[RatingInput] = Field(min_length=1)
    # Optional client-asserted location for the proximity guard (spec §4.5). Both-or-neither.
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)

    @model_validator(mode="after")
    def _coords_both_or_neither(self) -> "RateRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        return self
```

Ensure `model_validator` is imported from `pydantic`.

- [ ] **Step 4: Run tests — expect pass**

Run: `uv run pytest tests/test_fountains.py::test_rating_latitude_without_longitude_is_422 -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/tests/test_fountains.py
git commit -m "feat(backend): RateRequest optional both-or-neither coordinates (#3)"
```

## Task A4: `submit_ratings` proximity gate + monotonic `is_proximate`

**Files:**
- Modify: `backend/app/routers/fountains.py` (`submit_ratings`, `_upsert_ratings`)
- Test: `backend/tests/test_fountains.py`

**Interfaces:**
- Consumes: `within_radius` (A1), `settings.rating_max_distance_m` (A1), `Rating.is_proximate` (A2), `RateRequest.latitude/longitude` (A3).
- Produces: `POST /fountains/{id}/ratings` → `403 {"detail": "outside_rating_radius"}` when coords are outside the radius (no row written); accepts and sets `is_proximate` true (in-radius) / false (no coords); `_upsert_ratings` gains an `is_proximate: bool` parameter and ORs it on conflict.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_fountains.py`. Use a helper for the fountain's own coordinates (read them, or use the coordinates the fountain was created with).

```python
async def test_rating_within_radius_sets_proximate(client, session, existing_fountain, rating_type):
    lat, lng = existing_fountain_coords  # the coords the fountain was created at
    resp = await client.post(
        f"/api/v1/fountains/{existing_fountain.id}/ratings",
        json={"ratings": [{"rating_type_id": rating_type.id, "stars": 5}],
              "latitude": lat, "longitude": lng},
    )
    assert resp.status_code == 200
    row = (await session.execute(select(Rating).where(Rating.fountain_id == existing_fountain.id))).scalar_one()
    assert row.is_proximate is True


async def test_rating_outside_radius_is_403_and_writes_nothing(client, session, existing_fountain, rating_type):
    resp = await client.post(
        f"/api/v1/fountains/{existing_fountain.id}/ratings",
        json={"ratings": [{"rating_type_id": rating_type.id, "stars": 5}],
              "latitude": 0.0, "longitude": 0.0},  # far from the fountain
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "outside_rating_radius"
    count = (await session.execute(select(func.count()).select_from(Rating).where(Rating.fountain_id == existing_fountain.id))).scalar_one()
    assert count == 0


async def test_rating_without_coords_is_accepted_not_proximate(client, session, existing_fountain, rating_type):
    resp = await client.post(
        f"/api/v1/fountains/{existing_fountain.id}/ratings",
        json={"ratings": [{"rating_type_id": rating_type.id, "stars": 4}]},
    )
    assert resp.status_code == 200
    row = (await session.execute(select(Rating).where(Rating.fountain_id == existing_fountain.id))).scalar_one()
    assert row.is_proximate is False


async def test_rerate_without_coords_does_not_downgrade_proximate(client, session, existing_fountain, rating_type):
    lat, lng = existing_fountain_coords
    await client.post(f"/api/v1/fountains/{existing_fountain.id}/ratings",
                      json={"ratings": [{"rating_type_id": rating_type.id, "stars": 5}], "latitude": lat, "longitude": lng})
    # Re-rate with NO coords: stars change, but is_proximate stays true.
    await client.post(f"/api/v1/fountains/{existing_fountain.id}/ratings",
                      json={"ratings": [{"rating_type_id": rating_type.id, "stars": 3}]})
    row = (await session.execute(select(Rating).where(Rating.fountain_id == existing_fountain.id))).scalar_one()
    assert row.stars == 3
    assert row.is_proximate is True
```

- [ ] **Step 2: Run them — expect failure.**

Run: `uv run pytest tests/test_fountains.py -k "proximate or outside_radius" -v`

- [ ] **Step 3: Gate the handler**

In `submit_ratings`, after the fountain is loaded + `_validate_rating_types`, before `_upsert_ratings`:

```python
    is_proximate = False
    if payload.latitude is not None and payload.longitude is not None:
        proximate = (
            await session.execute(
                select(
                    within_radius(
                        Fountain.location,
                        payload.latitude,
                        payload.longitude,
                        settings.rating_max_distance_m,
                    )
                ).where(Fountain.id == fountain.id)
            )
        ).scalar_one()
        if not proximate:
            logger.info("rating rejected: outside radius", extra={"fountain_id": str(fountain.id)})
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="outside_rating_radius")
        is_proximate = True
```

Then pass it through:

```python
    rating_ids = await _upsert_ratings(
        session, fountain_id=fountain.id, user_id=user.id, ratings=payload.ratings,
        is_proximate=is_proximate,
    )
```

Import `within_radius` from `app.geo` and `settings` from config as the module already does (check the existing imports; `settings` is already used for `duplicate_threshold_m` etc.). Confirm `logger` exists in this module (it does — used elsewhere); if not, `logger = logging.getLogger("app")`.

- [ ] **Step 4: Make the upsert monotonic**

In `_upsert_ratings`, add the parameter and set the column, ORing on conflict:

```python
async def _upsert_ratings(
    session: AsyncSession, *, fountain_id: uuid.UUID, user_id: uuid.UUID,
    ratings: list[RatingInput], is_proximate: bool,
) -> dict[int, uuid.UUID]:
    ...
    stmt = pg_insert(Rating).values(
        [
            {
                "id": uuid.uuid4(),
                "fountain_id": fountain_id,
                "user_id": user_id,
                "rating_type_id": rating_type_id,
                "stars": stars,
                "is_proximate": is_proximate,
            }
            for rating_type_id, stars in stars_by_type.items()
        ]
    )
    ...
    stmt = stmt.on_conflict_do_update(
        index_elements=["fountain_id", "user_id", "rating_type_id"],
        set_={
            "stars": stmt.excluded.stars,
            "updated_at": func.now(),
            # MONOTONIC: absence of a coordinate is UNKNOWN, not negative — never overwrite
            # a prior verified true with false (spec §4.5).
            "is_proximate": Rating.is_proximate.op("OR")(stmt.excluded.is_proximate),
        },
    ).returning(Rating.rating_type_id, Rating.id)
```

Prefer `sqlalchemy.or_(Rating.is_proximate, stmt.excluded.is_proximate)` if it renders correctly in the `SET`; verify the generated SQL is `is_proximate = ratings.is_proximate OR excluded.is_proximate`. (If `or_` on the excluded pseudo-table misrenders, fall back to `sqlalchemy.func.bool_or` is NOT applicable here — use the explicit `Rating.is_proximate.op("OR")(stmt.excluded.is_proximate)` form above.)

- [ ] **Step 5: Run tests — expect pass**

Run: `uv run pytest tests/test_fountains.py -k "proximate or outside_radius" -v`
Expected: PASS (all four).

- [ ] **Step 6: Full backend mirror + commit**

```bash
./run.ps1 check -Backend
git add backend/app/routers/fountains.py backend/tests/test_fountains.py
git commit -m "feat(backend): reject out-of-radius ratings (403) + monotonic is_proximate (#3)"
```

## Task A5: `submit_condition` server-derives `is_proximate`; reject client `true`

**Files:**
- Modify: `backend/app/schemas.py` (`ConditionReportRequest`)
- Modify: `backend/app/routers/fountains.py` (`submit_condition`)
- Test: `backend/tests/test_fountains.py`

**Interfaces:**
- Produces: `ConditionReportRequest.latitude/longitude` optional both-or-neither; `is_proximate` field deprecated — `true` → 422 `{"detail": "is_proximate_is_server_computed"}`; server computes `is_proximate` from coords via `within_radius(..., proximate_radius_m)`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_condition_true_is_proximate_rejected(client, existing_fountain):
    resp = await client.post(
        f"/api/v1/fountains/{existing_fountain.id}/conditions",
        json={"status": "working", "is_proximate": True},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "is_proximate_is_server_computed"


async def test_condition_derives_proximate_from_coords(client, session, existing_fountain):
    lat, lng = existing_fountain_coords
    resp = await client.post(
        f"/api/v1/fountains/{existing_fountain.id}/conditions",
        json={"status": "working", "latitude": lat, "longitude": lng},
    )
    assert resp.status_code == 200
    row = (await session.execute(select(ConditionReport).where(ConditionReport.fountain_id == existing_fountain.id))).scalar_one()
    assert row.is_proximate is True


async def test_condition_no_coords_is_not_proximate(client, session, existing_fountain):
    resp = await client.post(
        f"/api/v1/fountains/{existing_fountain.id}/conditions",
        json={"status": "working"},
    )
    assert resp.status_code == 200
    row = (await session.execute(select(ConditionReport).where(ConditionReport.fountain_id == existing_fountain.id))).scalar_one()
    assert row.is_proximate is False
```

- [ ] **Step 2: Run them — expect failure.**

- [ ] **Step 3: Update the schema**

Replace `ConditionReportRequest` in `backend/app/schemas.py`:

```python
class ConditionReportRequest(BaseModel):
    status: ConditionStatus
    # DEPRECATED (spec §4.5): proximity is now server-computed. Kept for backward compatibility —
    # false/null accepted (both first-party clients historically send false); true is rejected
    # because a client may not self-assert proximity it never had.
    is_proximate: bool | None = Field(default=None, deprecated=True)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)

    @model_validator(mode="after")
    def _validate(self) -> "ConditionReportRequest":
        if self.is_proximate is True:
            raise ValueError("is_proximate_is_server_computed")
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        return self
```

> Note: a `ValueError` in a validator surfaces as a 422 whose `detail` is a list of errors, not a bare string. To return `{"detail": "is_proximate_is_server_computed"}` exactly, do the `is_proximate is True` check **in the handler** and raise `HTTPException(422, detail="is_proximate_is_server_computed")` there, keeping only the both-or-neither rule in the validator. Implement it in the handler (Step 4) and keep the validator to coords-only; adjust the schema above to drop the `is_proximate is True` branch from `_validate`.

- [ ] **Step 4: Update the handler**

In `submit_condition`, after loading the fountain, before building the `ConditionReport`:

```python
    if payload.is_proximate is True:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="is_proximate_is_server_computed")
    is_proximate = False
    if payload.latitude is not None and payload.longitude is not None:
        is_proximate = (
            await session.execute(
                select(
                    within_radius(Fountain.location, payload.latitude, payload.longitude,
                                  settings.proximate_radius_m)
                ).where(Fountain.id == fountain.id)
            )
        ).scalar_one()
```

Then change the `ConditionReport(...)` construction to use the derived value:

```python
    report = ConditionReport(
        fountain_id=fountain.id,
        user_id=user.id,
        status=payload.status,
        is_proximate=is_proximate,
        created_at=report_time,
    )
```

- [ ] **Step 5: Run tests + full backend mirror**

```bash
uv run pytest tests/test_fountains.py -k "condition" -v
./run.ps1 check -Backend
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/fountains.py backend/tests/test_fountains.py
git commit -m "feat(backend): server-derive condition is_proximate; reject client true (422) (#3)"
```

## Task A6: `RequestValidationError` handler (logging-only, response unchanged)

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_main.py` (or the nearest existing app-level test module)

**Interfaces:**
- Produces: a `RequestValidationError` handler that logs `[{loc, type}]` (field + error type) with **no `input` / `ctx`**, and returns the **same JSON body FastAPI produces by default** (status 422), so no response shape changes.

- [ ] **Step 1: Write the failing test**

```python
async def test_validation_error_does_not_log_submitted_value(client, existing_fountain, caplog):
    with caplog.at_level("INFO"):
        resp = await client.post(
            f"/api/v1/fountains/{existing_fountain.id}/ratings",
            json={"ratings": [{"rating_type_id": 1, "stars": 5}], "latitude": 999.0, "longitude": 1.0},
        )
    assert resp.status_code == 422
    # The out-of-range coordinate must not appear anywhere in the logs.
    assert "999" not in caplog.text
```

- [ ] **Step 2: Run it — expect failure** (default FastAPI logs may include the value, or the assertion baseline is set; if the default handler logs nothing, this test still guards against a future body-logging regression — keep it).

- [ ] **Step 3: Add the handler**

In `backend/app/main.py`, near the existing exception handler:

```python
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> Response:
    # Log field name + error type ONLY. Pydantic's error payload carries `input` — for
    # latitude/longitude that value IS the user's location and must never enter a log (spec §7).
    logging.getLogger("app").info(
        "request validation failed",
        extra={
            "method": request.method,
            "path": request.url.path,
            "errors": [{"loc": e.get("loc"), "type": e.get("type")} for e in exc.errors()],
        },
    )
    # Delegate the RESPONSE to FastAPI's default handler so the 422 body is byte-for-byte
    # unchanged (spec §6 — no API-wide response-shape change).
    return await request_validation_exception_handler(request, exc)
```

Ensure `Response` and `Request` are imported.

- [ ] **Step 4: Run test — expect pass**

Run: `uv run pytest tests/test_main.py -k validation -v`

- [ ] **Step 5: Full backend mirror + commit**

```bash
./run.ps1 check -Backend
git add backend/app/main.py backend/tests/test_main.py
git commit -m "feat(backend): log-only RequestValidationError handler; never log coordinates (#3)"
```

## Task A7: Regenerate the api-client

**Files:**
- Modify (generated): `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`

- [ ] **Step 1: Regenerate**

Run: `./run.ps1 generate`

- [ ] **Step 2: Verify the new fields appear**

Confirm `schema.d.ts` now has `latitude`/`longitude` on `RateRequest` and `ConditionReportRequest`, and `is_proximate` marked deprecated on the latter.

- [ ] **Step 3: Typecheck the shared client + commit**

```bash
./run.ps1 check -ApiClient
git add packages/api-client/openapi.json packages/api-client/src/schema.d.ts
git commit -m "chore(api-client): regenerate for rating/condition coordinates (#3)"
```

---

# Phase B — #3 clients (attach coordinates at submit time)

## Task B1: Shared draft helper (`packages/contributions`)

**Files:**
- Modify: `packages/contributions/src/index.ts`
- Test: `packages/contributions/src/index.test.ts`

**Interfaces:**
- Produces: `isRatingDraftDirty(dimensions: {rating_type_id: number; your_rating?: number | null}[], edits: Record<number, number>): boolean` — true iff at least one edit differs from the saved `your_rating` for its dimension.

- [ ] **Step 1: Write the failing tests**

```ts
import { isRatingDraftDirty } from "./index";

const dims = [
  { rating_type_id: 1, your_rating: 3 },
  { rating_type_id: 2, your_rating: null },
];

test("no edits -> not dirty", () => {
  expect(isRatingDraftDirty(dims, {})).toBe(false);
});
test("edit equal to saved -> not dirty", () => {
  expect(isRatingDraftDirty(dims, { 1: 3 })).toBe(false);
});
test("edit differs from saved -> dirty", () => {
  expect(isRatingDraftDirty(dims, { 1: 5 })).toBe(true);
});
test("edit on a previously-unrated dimension -> dirty", () => {
  expect(isRatingDraftDirty(dims, { 2: 4 })).toBe(true);
});
```

- [ ] **Step 2: Run — expect failure.** `pnpm --filter @fountainrank/contributions test`

- [ ] **Step 3: Implement**

Append to `packages/contributions/src/index.ts`:

```ts
export function isRatingDraftDirty(
  dimensions: { rating_type_id: number; your_rating?: number | null }[],
  edits: Record<number, number>,
): boolean {
  return dimensions.some((d) => {
    const edit = edits[d.rating_type_id];
    if (edit == null) return false;
    return edit !== (d.your_rating ?? 0);
  });
}
```

- [ ] **Step 4: Run — expect pass.** Then `pnpm --filter @fountainrank/contributions typecheck lint`

- [ ] **Step 5: Commit**

```bash
git add packages/contributions/src/index.ts packages/contributions/src/index.test.ts
git commit -m "feat(contributions): isRatingDraftDirty helper (#1)"
```

## Task B2: Web coordinate capture + rating/condition wiring + 403 mapping

**Files:**
- Create: `web/lib/geo/current-position.ts`
- Modify: `web/app/actions/contribute.ts`, `web/components/fountain/contributeError.ts`
- Modify: `web/components/fountain/RatingForm.tsx`, `web/components/fountain/ConditionForm.tsx`
- Test: `web/lib/geo/current-position.test.ts`, `web/app/actions/contribute.test.ts` (extend), `web/components/fountain/contributeError.test.ts` (create/extend)

**Interfaces:**
- Consumes: regenerated api-client (A7).
- Produces: `getCurrentPositionSafe(timeoutMs?: number): Promise<{latitude:number; longitude:number} | null>` — resolves null on denial/timeout/unavailable, never rejects.
- Produces: `submitRating(fountainId, ratings, coords?)` and `submitCondition(fountainId, status, coords?)` passing coords through; `mapStatus` maps `403` → `too_far`; `ContributeError` gains `"too_far"`; `errorText("too_far")` names the 50-mile rule.

- [ ] **Step 1: Write the failing tests**

`web/lib/geo/current-position.test.ts`: mock `navigator.geolocation.getCurrentPosition` for success, denial (error callback), and a never-resolving call (timeout) — assert coords, null, null respectively.

Extend `web/app/actions/contribute.test.ts`: a mocked `403` response → `{ ok: false, error: "too_far" }`.

`web/components/fountain/contributeError.test.ts`: `errorText("too_far")` contains "50 mi".

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `getCurrentPositionSafe`**

```ts
// web/lib/geo/current-position.ts
export function getCurrentPositionSafe(
  timeoutMs = 8000,
): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { latitude: number; longitude: number } | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
```

- [ ] **Step 4: Thread coords + map 403**

In `web/app/actions/contribute.ts`: add `"too_far"` to `ContributeError`; in `mapStatus`, add `if (status === 403) return fail("too_far");` before the fallback; extend `submitRating`/`submitCondition` to accept an optional `coords?: { latitude: number; longitude: number }` and spread it into the `body` (drop `is_proximate` from the condition body entirely). In `contributeError.ts`, add `case "too_far": return "You need to be within 50 mi of this fountain to rate it.";`.

- [ ] **Step 5: Capture coords in the forms**

In `RatingForm.tsx` `submit()`, before calling `submitRating`, `const coords = await getCurrentPositionSafe();` and pass it. In `ConditionForm.tsx` do the same for `submitCondition`. Neither blocks: `getCurrentPositionSafe` always resolves.

- [ ] **Step 6: Run web unit tests — expect pass**

Run: `pnpm --filter web test -- current-position contribute contributeError`
Then `pnpm --filter web typecheck lint`.

- [ ] **Step 7: Commit**

```bash
git add web/lib/geo web/app/actions/contribute.ts web/components/fountain/contributeError.ts web/components/fountain/RatingForm.tsx web/components/fountain/ConditionForm.tsx web/app/actions/contribute.test.ts web/components/fountain/contributeError.test.ts
git commit -m "feat(web): attach rating/condition coordinates; map 403 to too_far (#3)"
```

## Task B3: Mobile coordinate capture + payload wiring + 403 mapping

**Files:**
- Create: `mobile/lib/location-request.ts`
- Modify: `mobile/hooks/useForegroundLocation.ts`, `mobile/lib/contributions/payloads.ts`, `mobile/lib/contributions/state.ts`
- Modify: `mobile/app/fountains/[id].tsx` (rating + condition mutations attach coords)
- Test: `mobile/lib/contributions/payloads.test.ts` (extend), `mobile/lib/contributions/state.test.ts` (extend)

**Interfaces:**
- Produces: `requestCurrentCoords(): Promise<Coords | null>` in `mobile/lib/location-request.ts` — the expo-location adapter extracted from `useForegroundLocation.ts` (permission + `getCurrentPositionAsync` with timeout + last-known fallback). Resolves null on denial/failure, never throws, never logs coordinates.
- Produces: `buildRatingPayload(fountainId, starsByRatingType, coords?)` and `buildConditionPayload(fountainId, status, coords?)` including `latitude`/`longitude` when coords present; condition payload no longer sends `is_proximate`.
- Produces: `mapContributionError` maps `403` → new `"too_far"` variant; `contributionErrorText("too_far")` names the 50-mile rule.

- [ ] **Step 1: Extract the adapter (no behavior change first)**

Create `mobile/lib/location-request.ts` exporting `requestCurrentCoords`, moving `requestPermission` + `getCurrentPosition` out of `useForegroundLocation.ts`. Have the hook import `requestCurrentCoords` (or the two sub-adapters) so `lib/location.ts` stays free of an `expo-location` import. Run `pnpm --filter mobile typecheck` — expect PASS with no behavior change.

- [ ] **Step 2: Write the failing payload + error tests**

Extend `payloads.test.ts`: `buildRatingPayload(id, {1:5}, {latitude:40,longitude:-73})` → value includes `latitude`/`longitude`; without coords → no lat/lng keys. `buildConditionPayload(id, "working")` → value has **no** `is_proximate`.
Extend `state.test.ts`: an `ApiError` with `status: 403` → `"too_far"`; `contributionErrorText("too_far")` contains "50 mi".

- [ ] **Step 3: Run — expect failure.**

- [ ] **Step 4: Implement payload + error changes**

Add optional `coords?: { latitude: number; longitude: number }` to `buildRatingPayload` and `buildConditionPayload`; spread into the returned value when present. Drop `is_proximate: false` from the condition payload. In `state.ts`: add `"too_far"` to `ContributionError`, `if (error.status === 403) return "too_far";` in `mapContributionError`, and a `case "too_far":` in `contributionErrorText` returning e.g. `"You need to be within 50 mi of this fountain to rate it."`.

- [ ] **Step 5: Attach coords in the screen**

In `mobile/app/fountains/[id].tsx`, the rating and condition submit paths call `requestCurrentCoords()` (awaited, non-blocking — resolves null) and pass the result into `buildRatingPayload`/`buildConditionPayload`. (The RatingContributionForm's `submit()` builds the payload; thread a `coords` fetch there or lift the call — coordinate capture happens on the submit gesture.)

- [ ] **Step 6: Run mobile unit tests + typecheck**

Run: `pnpm --filter mobile test -- payloads state` then `pnpm --filter mobile typecheck lint`.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/location-request.ts mobile/hooks/useForegroundLocation.ts mobile/lib/contributions/payloads.ts mobile/lib/contributions/state.ts "mobile/app/fountains/[id].tsx" mobile/lib/contributions/payloads.test.ts mobile/lib/contributions/state.test.ts
git commit -m "feat(mobile): attach rating/condition coordinates; map 403 to too_far (#3)"
```

## Task B4: Privacy-policy amendment

**Files:**
- Modify: `web/app/privacy/page.tsx`

**Interfaces:** none (content only). Spec §6 requires this to ship in this PR.

- [ ] **Step 1: Amend the location clause**

The current bullet (`web/app/privacy/page.tsx:18`) says location is used "to find nearby fountains or add a fountain". Extend it to state that location may also be used to **verify proximity when you submit a rating or a condition report**, and that in that case the coordinates are **checked against the fountain's location and then discarded — not stored**. Keep the existing "you can control location permissions" sentence.

- [ ] **Step 2: Confirm the page still renders**

Run: `pnpm --filter web typecheck lint`. (The page is static content; a render test is optional.)

- [ ] **Step 3: Commit**

```bash
git add web/app/privacy/page.tsx
git commit -m "docs(web): privacy policy — rating/condition proximity uses and discards location (#3)"
```

---

# Phase C — #1 Add photo submits the unsaved rating

## Task C1: Web — lift the draft, flush on photo upload

**Files:**
- Modify: `web/components/fountain/FountainDetail.tsx` (add `RatingDraftProvider` context)
- Modify: `web/components/fountain/RatingForm.tsx` (consume context), `web/components/fountain/PhotoUpload.tsx` (flush draft before upload)
- Test: `web/components/fountain/PhotoUpload.test.tsx`, `web/components/fountain/RatingDraftContext.test.tsx`

**Interfaces:**
- Produces: a `RatingDraftContext` exposing `{ edits, setEdit, dimensions, clear }`, provided in `FountainDetail.tsx` wrapping the tabs (mirror the existing `useFountainDetailTabs()` pattern in `FountainDetailTabs.tsx`).
- Consumes: `isRatingDraftDirty` (B1), `submitRating` + `getCurrentPositionSafe` (B2).

- [ ] **Step 1: Write the failing tests**

`PhotoUpload.test.tsx`: render within a provider seeded with a dirty draft; trigger upload; assert `submitRating` was called **before** `uploadPhoto`, and that a `submitRating` returning `{ok:false,error:"too_far"}` still results in `uploadPhoto` being called (photo not blocked) and the draft retained. Clean draft → `submitRating` not called.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement the context + provider**

Add `RatingDraftProvider` + `useRatingDraft()` (new small file `web/components/fountain/RatingDraftContext.tsx`), wrap the tab panels in `FountainDetail.tsx`. `RatingForm` reads `edits`/`setEdit`/`dimensions` from context instead of local `useState`.

- [ ] **Step 4: Flush in PhotoUpload**

In `PhotoUpload.handleChange`, before uploading: if `isRatingDraftDirty(dimensions, edits)`, `const coords = await getCurrentPositionSafe(); const res = await submitRating(fountainId, draftRatings, coords ?? undefined);` — then **always** proceed to `uploadPhoto`. On `res.ok`, dispatch the rating celebration + `clear()` the draft; on `!res.ok`, keep the draft and show the rating notice (special-case `too_far`), but still upload.

- [ ] **Step 5: Run tests + typecheck/lint — expect pass**

- [ ] **Step 6: Commit**

```bash
git add web/components/fountain/FountainDetail.tsx web/components/fountain/RatingDraftContext.tsx web/components/fountain/RatingForm.tsx web/components/fountain/PhotoUpload.tsx web/components/fountain/PhotoUpload.test.tsx web/components/fountain/RatingDraftContext.test.tsx
git commit -m "feat(web): add photo submits the unsaved rating draft (#1)"
```

## Task C2: Mobile — lift the draft, flush on photo upload

**Files:**
- Modify: `mobile/app/fountains/[id].tsx` (own the draft `edits` state), `mobile/components/fountain/RatingContributionForm.tsx` (controlled), `mobile/components/fountain/PhotoUploadButton.tsx` (flush)
- Test: pure logic already covered by B1; screen wiring is emulator-verified.

**Interfaces:**
- Consumes: `isRatingDraftDirty` (B1), `buildRatingPayload` + `requestCurrentCoords` (B3).
- Produces: `RatingContributionForm` becomes controlled — props `stars: Record<number, number>` and `onStarPress(ratingTypeId, value)`; the draft `edits` lives in `FountainDetailScreen`.

- [ ] **Step 1: Make the form controlled**

Lift `edits`/`setEdits` from `RatingContributionForm` to `FountainDetailScreen`. Pass `stars` + `onStarPress` down. The form's `submit()` still calls the rating mutation; the screen owns the draft so the photo flow can read it.

- [ ] **Step 2: Flush on Add photo**

In the photo pick handler, before uploading: if `isRatingDraftDirty(dimensions, edits)`, build the rating payload with `requestCurrentCoords()` and call `ratingMutation.mutateAsync`, catching failure. **Always** proceed to the photo upload regardless of the rating outcome. On rating success clear `edits` + celebrate; on `too_far`/other failure keep `edits` and surface the notice, but upload anyway.

- [ ] **Step 3: Typecheck + lint (CI verifies render)**

Run: `pnpm --filter mobile typecheck lint`.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/fountains/[id].tsx" mobile/components/fountain/RatingContributionForm.tsx mobile/components/fountain/PhotoUploadButton.tsx
git commit -m "feat(mobile): add photo submits the unsaved rating draft (#1)"
```

---

# Phase D — #2 / #5 Celebration redesign (pin logo, both clients)

## Task D1: Mobile celebration → pin logo

**Files:**
- Modify: `mobile/components/feedback/WaterCelebration.tsx`
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Replace the drawn glyph with the asset**

Remove `iconCircle`/`dropStem`/`dropBowl` Views + styles. Render `<Image source={require("../../assets/logo-pin.png")} style={styles.pin} resizeMode="contain" />` inside the existing `Animated.View`. Keep the `progress` interpolation but retune to pop-and-settle (`scale: 0.7 → 1.08 → 0.96`). Soften the backdrop from `rgba(10,53,126,0.18)` to a lighter value (e.g. `0.10`). Keep the droplets but visually subordinate to the pin. Preserve the `AccessibilityInfo.isReduceMotionEnabled()` branch and the `+N points` text.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter mobile typecheck lint`.

- [ ] **Step 3: Document the element**

Add a "Points celebration" entry to `docs/style-guide.md` (mandatory for new/changed UI): the pin-logo burst, `+N points`, reduce-motion behavior, and the "use the raster logo asset, never redraw" rule it now honors.

- [ ] **Step 4: Commit**

```bash
git add mobile/components/feedback/WaterCelebration.tsx docs/style-guide.md
git commit -m "feat(mobile): celebration uses the pin logo, pop-and-settle (#2, #5)"
```

## Task D2: Web celebration parity (`points` + pin, `CustomEvent`)

**Files:**
- Modify: `web/components/map/MapStates.tsx` (`WaterCelebration` gains `points`, renders `/icon.png`)
- Modify: `web/app/globals.css` (keyframes)
- Modify: the six dispatchers + three listeners to carry `{ points }`
- Test: `web/components/contributions/ContributionStatusOverlay.test.tsx` (extend), a `WaterCelebration` render test

**Interfaces:**
- Produces: `WaterCelebration({ triggerKey, points }: { triggerKey: number; points?: number })` renders `<img src="/icon.png">` + `+{points} points` when `points != null`.
- Contract: the `"fountainrank:contribution"` event becomes `CustomEvent<{ points?: number }>`. Dispatchers pass the awarded points; listeners read `e.detail?.points` and tolerate absence (render no number).

- [ ] **Step 1: Write the failing tests**

`WaterCelebration` with `points={7}` renders "+7 points" and an `img[src="/icon.png"]`; with `points` undefined renders no number. `ContributionStatusOverlay` forwards `detail.points` to the celebration.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement**

Update `WaterCelebration`, keyframes, the six dispatchers (`RatingForm`, `AttributeForm`, `ConditionForm`, `NoteForm`, `PhotoUpload`, `useAddFountainMode`) to `new CustomEvent("fountainrank:contribution", { detail: { points } })`, and the three listeners (`ContributionStatusOverlay`, `MapBrowser`, `HeaderPoints`) to read `(e as CustomEvent<{points?:number}>).detail?.points`. Where a dispatcher knows the awarded points (e.g. `ActionResult.pointsAwarded`), pass it; otherwise omit.

- [ ] **Step 4: Run web tests + typecheck/lint — expect pass**

- [ ] **Step 5: Commit**

```bash
git add web/components/map/MapStates.tsx web/app/globals.css web/components/fountain/*.tsx web/components/map/MapBrowser.tsx web/components/map/useAddFountainMode.tsx web/components/contributions/ContributionStatusOverlay.tsx web/components/HeaderPoints.tsx web/components/contributions/ContributionStatusOverlay.test.tsx
git commit -m "feat(web): celebration parity — pin logo + points number (#2, #5)"
```

---

# Phase E — #4 Keyboard scrolling on the detail tabs

## Task E1: `KeyboardAvoidingView` + scroll props

**Files:**
- Modify: `mobile/components/fountain/FountainDetailTabs.tsx`
- (Fallback only) `mobile/app.config.ts`

- [ ] **Step 1: Wrap the panels + set scroll props**

Wrap the `panels` container in `KeyboardAvoidingView` carrying `style={styles.panels}` (it takes over the `flex:1`; the flex chain depth is unchanged), `behavior={Platform.OS === "ios" ? "padding" : "height"}`, and `keyboardVerticalOffset={<measured header + tab-bar height>}`. Add `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}` to each per-tab `ScrollView`. Do not add a fourth ScrollView.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter mobile typecheck lint`.

- [ ] **Step 3: Emulator verification (the four acceptance criteria, spec §4.4)**

Build/run the Android emulator (see `claude_help/local-dev.md`). With the Details tab active and "Your note" focused, verify and screenshot: (1) input fully visible above keyboard; (2) panel scrolls to reveal Submit; (3) Submit responds to a single tap; (4) switching tabs with keyboard open strands no panel. **If occluded**, apply the §4.4 fallback ladder — first set `android.softwareKeyboardLayoutMode: "resize"` in `app.config.ts` and re-test; then the `Keyboard`-listener `paddingBottom` approach; escalate before adding any dependency.

- [ ] **Step 4: Commit**

```bash
git add mobile/components/fountain/FountainDetailTabs.tsx
git commit -m "fix(mobile): keyboard-aware scrolling on the fountain detail tabs (#4)"
```

---

# Phase F — #6 Mobile sign-out

## Task F1: Force re-authentication (`prompt=login`)

**Files:**
- Modify: `mobile/lib/auth/config.ts`
- Test: `mobile/lib/auth/config.test.ts` (extend)

**Interfaces:**
- Produces: `logtoConfig.prompt = ["login", "consent"]` (string literals — `Prompt.Login === "login"`, `Prompt.Consent === "consent"`, verified in `@logto/js`), overriding the SDK's `[Prompt.Consent]` default (spread after it in `@logto/rn` client).

- [ ] **Step 1: Write the failing test**

Extend `config.test.ts`: a configured `nativeAuthConfig(...)` returns `logtoConfig.prompt` deep-equal to `["login", "consent"]`.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement**

In `mobile/lib/auth/config.ts`, add `prompt: ["login", "consent"],` to the returned `logtoConfig` (keep string literals to avoid a runtime `@logto/rn` import under Vitest, matching the existing `scopes` comment).

- [ ] **Step 4: Run — expect pass.** `pnpm --filter mobile test -- auth/config` then `typecheck lint`.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/auth/config.ts mobile/lib/auth/config.test.ts
git commit -m "fix(mobile): force re-auth on sign-in with prompt=login (#6)"
```

## Task F2: Real RP-initiated logout

**Files:**
- Create: `mobile/lib/auth/logout.ts` + `mobile/lib/auth/logout.test.ts`
- Modify: `mobile/providers/auth-provider.tsx`

**Interfaces:**
- Produces: `endSessionUrl({ endSessionEndpoint, clientId, postLogoutRedirectUri }): string` — `${endSessionEndpoint}?client_id=...&post_logout_redirect_uri=...`, URI-encoded, **no `id_token_hint`** (not in Logto's contract — `@logto/js/lib/core/sign-out.js`).
- Produces: `auth-provider` `signOut` calls `logto.signOut()` then opens the end-session URL via `WebBrowser.openAuthSessionAsync`, logging `end_session_completed` / `end_session_failed` (WARNING) without swallowing the partial-failure state.

- [ ] **Step 1: Write the failing test**

`logout.test.ts`: `endSessionUrl({endSessionEndpoint:"https://auth.example.com/oidc/session/end", clientId:"abc", postLogoutRedirectUri:"com.x://cb"})` equals `https://auth.example.com/oidc/session/end?client_id=abc&post_logout_redirect_uri=com.x%3A%2F%2Fcb`; assert the string contains **no** `id_token_hint`.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `endSessionUrl`**

```ts
// mobile/lib/auth/logout.ts
export function endSessionUrl({
  endSessionEndpoint,
  clientId,
  postLogoutRedirectUri,
}: {
  endSessionEndpoint: string;
  clientId: string;
  postLogoutRedirectUri?: string;
}): string {
  const params = new URLSearchParams({ client_id: clientId });
  if (postLogoutRedirectUri) params.append("post_logout_redirect_uri", postLogoutRedirectUri);
  return `${endSessionEndpoint}?${params.toString()}`;
}
```

- [ ] **Step 4: Wire the provider**

In `auth-provider.tsx` `signOut`: discover `end_session_endpoint` from `{endpoint}/oidc/.well-known/openid-configuration` (fallback `{endpoint}/oidc/session/end`), build the URL via `endSessionUrl`, call `logto.signOut()` (clears local tokens), then `await WebBrowser.openAuthSessionAsync(url, postLogoutRedirectUri)` inside try/catch. On success log `end_session_completed`; on failure log `end_session_failed` at WARNING (no tokens, no claims) and still report sign-out success to the UI (`prompt=login` is the safety net). The `post_logout_redirect_uri` MUST be the registered native callback (release gate F4).

- [ ] **Step 5: Run tests + typecheck/lint — expect pass.**

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/auth/logout.ts mobile/lib/auth/logout.test.ts mobile/providers/auth-provider.tsx
git commit -m "fix(mobile): RP-initiated logout ends the Logto session on sign-out (#6)"
```

## Task F3: Document the Logto console release gate

**Files:**
- Modify: `docs/setup/06-logto.md`
- Modify: `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` (retire the `is_proximate` client-asserted accepted-risk entry)

- [ ] **Step 1: Document both console changes**

In `docs/setup/06-logto.md`, add: (a) register the post-logout redirect URI `com.redducklabs.fountainrank://callback` (or the app's chosen post-logout URI) on the Logto **native** app — without it the end-session call fails; (b) set the Google connector **Prompts** to `select_account`. State clearly that issue #6 is not closed until both are applied and a device sign-out → sign-in shows the Logto login screen **and** a Google account chooser.

- [ ] **Step 2: Retire the accepted-risk note**

In the gamification design's accepted-risks list, update the `is_proximate` "client-asserted, not a security control" entry to note it is now server-computed from optional coordinates (still untrustworthy against fabricated coordinates, but no longer self-assertable).

- [ ] **Step 3: Commit**

```bash
git add docs/setup/06-logto.md docs/specs/2026-06-22-contribution-data-and-gamification-design.md
git commit -m "docs: record the #6 Logto console release gate; retire is_proximate risk note (#6)"
```

---

# Phase G — Integration, PR, review, merge, deploy

## Task G1: Full local CI mirror

- [ ] Run the whole mirror and fix anything red before pushing:
  - `./run.ps1 check -Backend`
  - `pnpm --filter @fountainrank/contributions typecheck lint test`
  - `pnpm --filter @fountainrank/api-client typecheck test`
  - `pnpm --filter web typecheck lint test`
  - `pnpm --filter mobile typecheck lint test`
  - (Mobile component-render + expo-doctor + React-Compiler lint are CI-only — verify via CI.)

## Task G2: Push, open PR, get CI green

- [ ] Push the branch; `gh pr create` with a body that includes: the six issues, the per-issue QA checklist (with the §4.4 keyboard screenshots), and **explicit close criteria** — merging closes #1, #2, #4, #5 and the code half of #3; **#6 stays open** pending the Logto console gate (F3). Link the spec + plan.
- [ ] Monitor CI to green (`gh pr checks`); fix any failure and re-push.

## Task G3: Codex PR review loop

- [ ] Run Loop B from `claude_help/codex-review-process.md`: invoke Codex in bypass mode to review the PR, post findings, write `temp/codex-reviews/pr-<N>-review-1.md`. Address every finding + every other PR comment; re-run the local mirror; push; re-review on the same conversation. Loop until `VERDICT: APPROVED`.

## Task G4: Merge

- [ ] Once CI is green **and** Codex `VERDICT: APPROVED` **and** every PR comment addressed: `gh pr merge <N> --squash`.

## Task G5: Deploy (manual dispatch)

- [ ] Deploy is a manual CI action (merging to main does NOT deploy). After merge: `gh workflow run deploy.yml --ref main`. Monitor the run to success.
- [ ] Apply the Logto console changes (F3) in the production Logto, then verify on a device that sign-out → sign-in shows the login screen + Google account chooser. Only then close #6.

---

## Verification matrix (what proves each issue)

| Issue | Automated | Manual (emulator/device) |
|---|---|---|
| #1 | web RTL: photo flushes dirty draft, 403 doesn't block upload | mobile: tap stars on Info → Photos → Add photo saves both |
| #2/#5 | web: celebration renders pin + points | mobile: pop-and-settle pin appears on rate |
| #3 | backend: 403 out-of-radius, monotonic proximate, condition derive/reject; validation-log privacy | in-app rate near vs. far |
| #4 | (none — no RN render harness) | the four §4.4 acceptance criteria + screenshots |
| #6 | mobile: `prompt=["login","consent"]`, `endSessionUrl` shape | device: sign-out → sign-in shows login + Google chooser (after F3) |
