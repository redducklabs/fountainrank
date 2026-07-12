# Server-Authoritative Contribution Points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The points celebration fires if and only if the server actually awarded points, and a 0-point contribution says plainly that it earned nothing.

**Architecture:** The `record_contributions` chokepoint starts reporting what it actually inserted (per user). Each write response carries an additive nullable `points_awarded`. Pre-submit "what can I still earn here" is derived from the `contribution_events.dedup_key` ledger — the award rule itself — not from content rows, which drift from it. On the clients, a branded `AwardedPoints` type minted only in the response-parsing layer makes it impossible to celebrate a client-invented number.

**Spec:** `docs/specs/2026-07-12-server-authoritative-contribution-points-design.md` (Codex-approved, review 3).

**Tech Stack:** FastAPI + SQLAlchemy 2 async + PostGIS; Next.js 16 (server actions); Expo/React Native + TanStack Query; pnpm workspace with `packages/contributions` (shared point math) and `packages/api-client` (generated OpenAPI types).

## Global Constraints

- **No database migration.** Every new field is a Pydantic response model built from existing tables/indexes. If you find yourself writing an Alembic revision, stop — you have misread the spec.
- **`packages/api-client/openapi.json` + `src/schema.d.ts` are git-tracked.** Regenerate (Task 4) after backend schema changes; a regen must leave a clean tree.
- **Additive + nullable only.** Never remove or move an existing response field. `condition_points_awarded` and **top-level** `condition_points_eligible_at` STAY (released mobile clients read them).
- **`points_awarded` is canonical**; `condition_points_awarded` is deprecated-compat only and must not be the primary path in new code or new tests.
- **Award rules do not change.** `POINTS`, every `dk_*` key, and the #124 24h window are untouched. Existing `backend/tests/test_contribution_emission.py` assertions must keep passing **unchanged**.
- **Conventional Commits.** No AI attribution. No time estimates.
- **Logging:** every write path logs `points_awarded=<n>` with fountain/user context. Never log raw note bodies, tokens, or PII.

### Two traps this codebase will spring on you

1. **There are TWO celebration listeners on web, not one.** `ContributionStatusOverlay.tsx` *and*
   `web/components/map/MapBrowser.tsx:459-465` both listen on `CONTRIBUTION_EVENT` and bump a
   `celebrationKey` unconditionally. Gating only the overlay leaves 0-point celebrations firing on
   the map. Both must be gated (Task 6).
2. **The detail GET resolves its viewer via `get_optional_user`, NOT the `get_current_user` that
   the `client` fixture overrides** — and the fixture sends no auth header. So `client.get(...)` is
   an **anonymous** viewer by default. For an authenticated GET you must additionally override
   `get_optional_user`. This is documented at `backend/tests/test_conditions_api.py:154-158`; read
   it before writing any detail-GET test.

### Real test fixtures (do not invent others)

`backend/tests/conftest.py` provides exactly: `engine`, `session`, `clean_db` (autouse),
`test_user`, `client` (an `AsyncClient` with `get_current_user` overridden to `test_user`).
There is **no** `authed_client`, `fountain`, `make_user`, `make_fountain`, `hide_note`, or
`upload_photo` fixture. Build rows inline the way `backend/tests/test_contribution_emission.py`
and `test_contributions.py` do, or create fountains through `POST /api/v1/fountains`.

### Local checks (Windows host)

`./run.ps1 check` is the CI mirror. **PowerShell** blocks below are fenced `powershell`; the Bash
tool is Git Bash and will not understand `$env:` syntax.

```powershell
$env:UV_PROJECT_ENVIRONMENT = "$env:TEMP\fr-venv"   # isolated: never touch Codex's WSL .venv
./run.ps1 up                                        # postgis on :5436
./run.ps1 check -Backend
```

**CI-only on this host — do NOT claim a local green you did not get** (`claude_help/local-dev.md`):
component-**render** vitest suites and the full JS unit suites (the local hoisted linker duplicates
React), mobile's stricter **React-Compiler ESLint** rules, and `expo-doctor` truth. Backend is
fully verifiable locally. State exactly which suites you ran and which you are deferring to CI.

---

## File Structure

**Backend**
- `backend/app/contributions.py` — `ContributionResult`; `record_contributions` returns it; new `viewer_award_state()` ledger query.
- `backend/app/schemas.py` — `ViewerAwardState`; `points_awarded` on `FountainDetail`/`PhotoOut`/`NoteOut`; `viewer_award_state` on `FountainDetail`.
- `backend/app/routers/fountains.py` — `serialize_fountain_detail`, `submit_ratings`, `submit_attributes`, `submit_condition`, note handler, `add_fountain`, `fountain_detail` (cache header).
- `backend/app/routers/photos.py` — `upload_photo`.
- `backend/tests/test_points_awarded.py`, `backend/tests/test_viewer_award_state.py` — create.

**Shared**
- `packages/contributions/src/index.ts` (+ `index.test.ts`) — `photo_first`, `AwardedPoints`, `ViewerAwardStateT`, earnable helpers.
- `packages/api-client/` — regenerate.

**Web**
- `web/app/actions/awarded.ts` — create: the single minting site.
- `web/app/actions/contribute.ts`, `web/app/actions/add-fountain.ts` — return `pointsAwarded`.
- `web/lib/contribution-event.ts`, `web/components/contributions/ContributionStatusOverlay.tsx`, `web/components/map/MapBrowser.tsx` — the two listeners.
- `web/components/fountain/{FountainDetail,ContributeSection,RatingForm,AttributeForm,NoteForm,ConditionForm,PhotoUpload}.tsx`, `web/components/map/useAddFountainMode.tsx`.

**Mobile**
- `mobile/lib/awarded-points.ts` — create: the single minting site (its own module so the lint rule has one unambiguous specifier to restrict).
- `mobile/eslint.config.js`, `mobile/app/fountains/[id].tsx`, `mobile/app/(tabs)/index.tsx` (add-fountain!), `mobile/components/fountain/*ContributionForm.tsx`.

**Docs**
- `docs/style-guide.md`.

---

## Task 1: Backend — `ContributionResult` at the chokepoint

**Files:**
- Modify: `backend/app/contributions.py` (`record_contributions`, ~lines 179-246)
- Modify: every caller + test listed in Step 4
- Test: `backend/tests/test_contributions.py` (extend)

**Interfaces:**
- Produces: `ContributionResult(event_ids: list[UUID], points_by_user: dict[UUID, int])` with `.points_for(user_id) -> int` and `__bool__`. `record_contributions(session, specs) -> ContributionResult` (was `list[UUID]`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_contributions.py` (it already has the imports, the `session`/`clean_db`
fixtures and the inline user/fountain setup — **reuse its existing helpers rather than inventing
fixtures**; read the top of the file first).

```python
async def test_points_for_returns_only_that_users_points(clean_db, session):
    """A batch spanning two users must never report one user's points to the other."""
    # Build the two users + fountain exactly as the other tests in this file do.
    ...
    result = await record_contributions(session, [spec_for_user_a, spec_for_user_b])
    assert result.points_for(user_a.id) == 2
    assert result.points_for(user_b.id) == 2
    assert result.points_for(uuid.uuid4()) == 0  # unknown user -> 0, never the batch total


async def test_mixed_batch_sums_only_inserted_rows(clean_db, session):
    """rate@2 + first_rating_bonus@5 -> 9. Summing by len(event_ids) would be wrong here."""
    ...
    first = await record_contributions(session, specs)
    assert first.points_for(user.id) == 7  # 2 + 5

    second = await record_contributions(session, specs)  # same dedup keys
    assert second.points_for(user.id) == 0
    assert second.event_ids == []


async def test_truthiness_mirrors_the_old_list_return(clean_db, session):
    """`if inserted:` sites must keep their meaning after the return-type change."""
    ...
    assert bool(await record_contributions(session, [spec])) is True   # inserted
    assert bool(await record_contributions(session, [spec])) is False  # deduped
    assert bool(await record_contributions(session, [])) is False      # empty
```

- [ ] **Step 2: Run to verify they fail**

```powershell
./run.ps1 check -Backend
```
Expected: `ImportError: cannot import name 'ContributionResult'`.

- [ ] **Step 3: Implement `ContributionResult`**

In `backend/app/contributions.py`, above `record_contributions`:

```python
@dataclass(frozen=True)
class ContributionResult:
    """What `record_contributions` actually inserted.

    `points_by_user` is summed from the same RETURNING rows that drive the
    `user_contribution_stats` increment, so the number reported to a user and the number
    added to their total cannot diverge.
    """

    event_ids: list[uuid.UUID]
    points_by_user: dict[uuid.UUID, int]

    def points_for(self, user_id: uuid.UUID) -> int:
        """Points credited to THIS user. Never the batch total — a batch may span users."""
        return self.points_by_user.get(user_id, 0)

    def __bool__(self) -> bool:
        # Mirrors the old list-return truthiness so any missed `if inserted:` call site keeps
        # its original meaning instead of silently becoming always-true.
        return bool(self.event_ids)
```

Change the signature and tail of `record_contributions`. The `per_user` aggregation already exists
(~lines 224-239) — **reuse it, do not add a second pass**:

```python
async def record_contributions(
    session: AsyncSession, specs: list[ContributionSpec]
) -> ContributionResult:
    if not specs:
        return ContributionResult(event_ids=[], points_by_user={})
    ...
    # (unchanged insert loop populating `inserted`; unchanged per_user aggregation + upsert)

    logger.info(
        "contribution_events recorded inserted=%d deduped=%d points=%d",
        len(inserted),
        len(specs) - len(inserted),
        sum(row.points for row in inserted),
    )
    return ContributionResult(
        event_ids=[row.id for row in inserted],
        points_by_user={user_id: agg["total_points"] for user_id, agg in per_user.items()},
    )
```

- [ ] **Step 4: Convert EVERY caller and test**

`__bool__` is a safety net, not a licence to skip this. The complete list (verify with
`grep -rn "record_contributions" backend/app backend/tests`):

| File:line | Current use | Convert to |
|---|---|---|
| `app/routers/fountains.py:877` (add_fountain) | bare `await` | assign `result`; used in Task 2 |
| `app/routers/fountains.py:950` (submit_ratings) | bare `await` | assign `result`; used in Task 2 |
| `app/routers/fountains.py:1015` (submit_attributes) | bare `await` | assign `result`; used in Task 2 |
| `app/routers/fountains.py:1106` (submit_condition) | `inserted = ...` then `points_for(event_type) if inserted else 0` | `result = ...`; `points_awarded = result.points_for(user.id)` — **deletes a redundant re-derivation** |
| `app/routers/fountains.py:1168` (note) | `inserted = ...`, log `"inserted" if inserted else "deduped"` | `result = ...`; log on `result.event_ids` |
| `app/routers/photos.py:401` (upload_photo) | bare `await` | assign `result`; used in Task 2 |
| `tests/test_contributions.py:72, 112, 183` | `ids = await ...` then list ops | `.event_ids` |
| `tests/test_contributions.py:145, 147` | `first`/`second` compared as lists | `.event_ids` |
| `tests/test_contributions.py:86, 165, 173, 199, 239, 243, 252, 262, 313, 350, 388, 416, 454, 482` | bare `await` (no list use) | no change needed — **but re-read each to confirm** |
| `tests/test_contributions_photo.py:74, 93` | `ids = await ...` / `again = ...` | `.event_ids` |
| `tests/test_contributions_photo.py:116, 143, 173, 209` | bare `await` | no change needed — confirm |
| `tests/test_conditions_api.py:250` | bare `await` | no change needed — confirm |

- [ ] **Step 5: Run the backend suite**

```powershell
./run.ps1 check -Backend
```
Expected: PASS, with `test_contribution_emission.py` **unchanged**.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests
git commit -m "refactor(backend): record_contributions reports points per user (#204)

The chokepoint returned ids only, so 'what did this write award?' was unanswerable — a
batch mixes event types (rate@2 + first_rating_bonus@5), so points cannot be derived from
an id count. Return ContributionResult with points_by_user + points_for(user_id); per-user,
because a batch may span users and a scalar total would let a future bulk path report
another user's points."
```

---

## Task 2: Backend — `points_awarded` on every write response

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/routers/fountains.py`, `backend/app/routers/photos.py`
- Test: `backend/tests/test_points_awarded.py` (create)

**Interfaces:**
- Consumes: `ContributionResult.points_for()` (Task 1).
- Produces: `points_awarded: int | None` on `FountainDetail`, `PhotoOut`, `NoteOut`; `serialize_fountain_detail(..., points_awarded: int | None = None)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_points_awarded.py`. **Uses the real `client` + `test_user` + `session`
fixtures.** `client` is authenticated for writes (its `get_current_user` override), which is all
these tests need — they only POST. Create the fountain through the API, as
`test_contribution_emission.py` does.

```python
"""#204: every write reports what it ACTUALLY awarded — 0 when it deduped."""

import pytest

pytestmark = pytest.mark.asyncio

LOC = {"latitude": 37.7749, "longitude": -122.4194}


async def _new_fountain(client) -> str:
    res = await client.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
    assert res.status_code == 201
    return res.json()["id"]


async def test_rating_awards_then_zero_on_rerate(client):
    """The #204 bug: re-rating must report 0, not a fresh full award."""
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
    assert (await client.post(f"/api/v1/fountains/{fid}/attributes", json=body)) \
        .json()["points_awarded"] == 2
    assert (await client.post(f"/api/v1/fountains/{fid}/attributes", json=body)) \
        .json()["points_awarded"] == 0


async def test_second_note_awards_zero(client):
    fid = await _new_fountain(client)
    assert (await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "first"})) \
        .json()["points_awarded"] == 2
    assert (await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "second"})) \
        .json()["points_awarded"] == 0


async def test_condition_sets_both_canonical_and_legacy_fields(client):
    fid = await _new_fountain(client)
    data = (await client.post(f"/api/v1/fountains/{fid}/conditions",
                              json={"status": "working"})).json()
    assert data["points_awarded"] == 3
    # Deprecated-compat: released mobile clients still read this. Must stay in lockstep.
    assert data["condition_points_awarded"] == 3


async def test_add_fountain_reports_its_award(client):
    """First time the add-fountain award is visible to a client at all."""
    res = await client.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
    # add_fountain@10 + first_fountain_bonus@5 + first_in_area_bonus@15 on a virgin DB.
    assert res.json()["points_awarded"] == 30


async def test_get_detail_reports_no_award(client):
    """points_awarded is a WRITE-response field; a GET must not claim an award."""
    fid = await _new_fountain(client)
    assert (await client.get(f"/api/v1/fountains/{fid}")).json()["points_awarded"] is None
```

Add a 2nd-photo-awards-zero test modelled on the `_upload_photo` **module-private helper** in
`backend/tests/test_photos_delete_report.py` (copy the helper; it is not a fixture).

If `test_add_fountain_reports_its_award`'s total is wrong, read `add_fountain`'s spec list and the
bonus preconditions rather than "fixing" the assertion to whatever the code returns.

- [ ] **Step 2: Run to verify they fail**

```powershell
./run.ps1 check -Backend
```
Expected: `KeyError: 'points_awarded'`.

- [ ] **Step 3: Add the schema fields**

`backend/app/schemas.py`, on `FountainDetail` next to the existing #124 fields:

```python
    # #204 server-authoritative awards. Additive + nullable (no response-shape break): the points
    # this WRITE actually awarded the caller (0 when everything deduped); null on GET and every
    # other response. CANONICAL — `condition_points_awarded` above is deprecated compatibility for
    # already-released mobile clients and must not be the primary path in new code.
    points_awarded: int | None = None
```

Same field on `PhotoOut` and `NoteOut`.

- [ ] **Step 4: Thread it through the routes**

`serialize_fountain_detail` gains `points_awarded: int | None = None` alongside the existing
`condition_points_awarded` param.

- `submit_ratings`: `result = await record_contributions(...)`;
  `points_awarded = result.points_for(user.id)`; log
  `"ratings submitted fountain=%s user=%s dimensions=%d points_awarded=%d"`; return
  `await serialize_fountain_detail(session, fountain, user_id=user.id, points_awarded=points_awarded)`.
- `submit_attributes`: identical shape, logging `observations=%d`.
- `submit_condition`: pass **both** `points_awarded=points_awarded` and the existing
  `condition_points_awarded=points_awarded` — one value, two fields, never computed separately.
- `add_fountain`: `points_awarded=result.points_for(user.id)`.
- Note handler: `NoteOut(..., points_awarded=result.points_for(user.id))`. **Keep the existing
  "no raw note body in logs" discipline** — log counts/points, never `body`.
- `upload_photo`: `PhotoOut(..., points_awarded=result.points_for(user.id))`.

- [ ] **Step 5: Run the backend suite**

```powershell
./run.ps1 check -Backend
```

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat(backend): return points_awarded on every contribution write (#204)

Additive + nullable on FountainDetail/PhotoOut/NoteOut, set from
ContributionResult.points_for(user.id). condition_points_awarded stays populated in lockstep
as deprecated compatibility for released mobile clients. Add-fountain awards are now visible
to the client for the first time."
```

---

## Task 3: Backend — `ViewerAwardState` from the dedup ledger + stop shared-caching the detail

**Files:**
- Modify: `backend/app/contributions.py`, `backend/app/schemas.py`, `backend/app/routers/fountains.py`
- Test: `backend/tests/test_viewer_award_state.py` (create)

**Interfaces:**
- Produces: `ViewerAwardState` model; `FountainDetail.viewer_award_state: ViewerAwardState | None`; `viewer_award_state(session, user_id, fountain_id) -> ViewerAwardState`.

**Why the ledger and not the content rows** — do not "simplify" this back: the dedup key is
permanent, content rows are not. A hidden note, a hidden attribute observation, or a deleted first
photo all leave the key spent while the content disappears, so a content-derived preview promises
points the insert will not award.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_viewer_award_state.py`. **Read `backend/tests/test_conditions_api.py:154-178`
first** — it documents the viewer-override pattern these tests need:

```python
"""#204: earnability comes from the dedup LEDGER, not from content rows."""

import pytest

from app.auth import get_optional_user
from app.main import app

pytestmark = pytest.mark.asyncio

LOC = {"latitude": 37.7749, "longitude": -122.4194}


async def _new_fountain(client) -> str:
    res = await client.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
    return res.json()["id"]


async def _detail_as_viewer(client, test_user, fid) -> dict:
    """An AUTHENTICATED detail GET.

    The detail route resolves its viewer via get_optional_user, NOT the get_current_user the
    `client` fixture overrides — and the fixture sends no auth header. Without this override the
    GET is anonymous. (Pattern: test_conditions_api.py:154-158.)
    """
    app.dependency_overrides[get_optional_user] = lambda: test_user
    try:
        return (await client.get(f"/api/v1/fountains/{fid}")).json()
    finally:
        app.dependency_overrides.pop(get_optional_user, None)


async def test_anonymous_gets_no_viewer_award_state(client):
    fid = await _new_fountain(client)
    # No get_optional_user override + no auth header => anonymous viewer.
    assert (await client.get(f"/api/v1/fountains/{fid}")).json()["viewer_award_state"] is None


async def test_rated_dimension_drops_out_of_unrated(client, test_user):
    fid = await _new_fountain(client)
    await client.post(f"/api/v1/fountains/{fid}/ratings",
                      json={"ratings": [{"rating_type_id": 1, "stars": 5}]})
    state = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    assert 1 not in state["unrated_rating_type_ids"]
    assert 2 in state["unrated_rating_type_ids"]


async def test_hidden_own_note_is_still_not_earnable(client, test_user, session):
    """The dedup key survives moderation — a hidden note must NOT read as earnable."""
    fid = await _new_fountain(client)
    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "n"})

    # Hide it directly (mirrors what admin moderation does; the dedup row is untouched).
    from sqlalchemy import update
    from app.models import FountainNote
    await session.execute(update(FountainNote).where(FountainNote.fountain_id == fid)
                          .values(is_hidden=True))
    await session.commit()

    state = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    assert state["note_earnable"] is False

    # ...and the insert agrees: still 0.
    again = await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "n2"})
    assert again.json()["points_awarded"] == 0


async def test_deleted_first_photo_leaves_photo_first_spent(client, test_user):
    """photo_first is per-fountain and permanent; self-delete reverses points, not the key."""
    fid = await _new_fountain(client)
    photo_id = await _upload_photo(client, fid)  # copy the helper from test_photos_delete_report.py
    await client.delete(f"/api/v1/fountains/{fid}/photos/{photo_id}")

    state = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    assert state["photo_first_earnable"] is False  # zero VISIBLE photos, but the key is spent


async def test_attribute_with_no_consensus_row_is_still_earnable(client, test_user):
    """Candidates come from the attribute-type REGISTRY, not the response's `attributes` list."""
    fid = await _new_fountain(client)
    detail = await _detail_as_viewer(client, test_user, fid)
    assert detail["attributes"] == []  # nobody has observed anything yet
    assert detail["viewer_award_state"]["unobserved_attribute_type_ids"]  # ...but all are earnable


async def test_stale_hint_loses_to_the_insert(client, test_user):
    """ViewerAwardState is an as-of-read HINT (spec §4.3.1); the POST is authoritative.

    Simulates the TOCTOU race (another tab/device spending the key between GET and submit).
    """
    fid = await _new_fountain(client)
    stale = (await _detail_as_viewer(client, test_user, fid))["viewer_award_state"]
    assert stale["note_earnable"] is True  # the hint the client is holding

    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "a"})  # key gets spent
    late = await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "b"})
    assert late.json()["points_awarded"] == 0  # the insert wins, not the stale hint


async def test_detail_is_never_shared_cached(client, test_user):
    """Viewer-scoped data on a PUBLIC endpoint — a shared cache would leak it between users."""
    fid = await _new_fountain(client)
    anon = await client.get(f"/api/v1/fountains/{fid}")
    assert anon.headers["cache-control"] == "private, no-store"

    app.dependency_overrides[get_optional_user] = lambda: test_user
    try:
        authed = await client.get(f"/api/v1/fountains/{fid}")
        assert authed.headers["cache-control"] == "private, no-store"
    finally:
        app.dependency_overrides.pop(get_optional_user, None)
```

- [ ] **Step 2: Run to verify they fail**

```powershell
./run.ps1 check -Backend
```

- [ ] **Step 3: Add the schema**

`backend/app/schemas.py`:

```python
class ViewerAwardState(BaseModel):
    """What this viewer can still EARN on this fountain, per the contribution dedup ledger (#204).

    The AWARD state, not the content state: hidden notes/observations and deleted photos keep
    their dedup key, so content rows would over-promise. An as-of-read HINT — the insert stays
    authoritative (the POST's `points_awarded` always wins).

    Null for anonymous callers. `condition_points_eligible_at` is deliberately NOT here — it stays
    top-level on FountainDetail, where already-released clients read it.
    """

    unrated_rating_type_ids: list[int]
    unobserved_attribute_type_ids: list[int]
    note_earnable: bool
    photo_first_earnable: bool
```

On `FountainDetail`: `viewer_award_state: ViewerAwardState | None = None`.

- [ ] **Step 4: Implement the ledger query — WITH its imports**

`backend/app/contributions.py` currently imports only `ContributionEvent, UserContributionStats`
from `app.models`. **Add the imports or this will `NameError`:**

```python
from app.models import AttributeType, ContributionEvent, RatingType, UserContributionStats
from app.schemas import ViewerAwardState
```

If `app.schemas` importing from `app.contributions` would create a cycle, define the query to
return a plain dataclass/dict here and construct `ViewerAwardState` in the router instead —
**check the import direction before writing the code.**

```python
async def viewer_award_state(
    session: AsyncSession, user_id: uuid.UUID, fountain_id: uuid.UUID
) -> ViewerAwardState:
    """What `user_id` can still earn on `fountain_id`, per the dedup ledger.

    Candidates come from the TYPE REGISTRIES, not from the fountain's existing content: a user can
    observe an attribute that has no consensus row yet, so building candidates from the detail
    response's `attributes` list would silently drop the attributes most likely to be earnable.
    NOTE: RatingType has NO `is_active` flag (only place_type/sort_order) — do not filter on one.
    """
    rating_type_ids = list(
        (await session.execute(
            select(RatingType.id).where(RatingType.place_type == "fountain")
        )).scalars()
    )
    attribute_type_ids = list(
        (await session.execute(
            select(AttributeType.id).where(
                AttributeType.is_active.is_(True), AttributeType.place_type == "fountain"
            )
        )).scalars()
    )

    rate_keys = {dk_rate(user_id, fountain_id, rid): rid for rid in rating_type_ids}
    attr_keys = {dk_observe_attr(user_id, fountain_id, aid): aid for aid in attribute_type_ids}
    note_key = dk_note(user_id, fountain_id)
    photo_key = dk_photo_first(fountain_id)

    # ONE index scan on uq_contribution_events_dedup_key (the registry SELECTs above are separate,
    # cheap, and cacheable — do not try to fold them into this query). Anything returned is spent.
    spent = set(
        (await session.execute(
            select(ContributionEvent.dedup_key).where(
                ContributionEvent.dedup_key.in_([*rate_keys, *attr_keys, note_key, photo_key])
            )
        )).scalars()
    )

    return ViewerAwardState(
        unrated_rating_type_ids=[rid for key, rid in rate_keys.items() if key not in spent],
        unobserved_attribute_type_ids=[aid for key, aid in attr_keys.items() if key not in spent],
        note_earnable=note_key not in spent,
        photo_first_earnable=photo_key not in spent,
    )
```

Call it from `serialize_fountain_detail` **only when `user_id is not None`** (anonymous → `None`),
alongside the existing `your_stars` query.

- [ ] **Step 5: Fix the shared-cache leak**

`fountains.py:661` — `fountain_detail` takes no `Response` and sets **no** cache headers, while
already returning viewer-scoped `your_rating` and `condition_points_eligible_at`. Adopt the
`list_photos` precedent (`photos.py:75-80`). Adding a `Response` param is FastAPI-safe and changes
no existing caller:

```python
@router.get("/fountains/{fountain_id}", response_model=FountainDetail)
async def fountain_detail(
    fountain_id: uuid.UUID,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_optional_user),
) -> FountainDetail:
    # Viewer-dependent (`your_rating`, `viewer_award_state`, `condition_points_eligible_at`) even
    # though the endpoint stays PUBLIC — so it must never be shared-cached. A CDN/proxy caching one
    # viewer's response and serving it to another is a real data leak, not a cosmetic bug.
    response.headers["Cache-Control"] = "private, no-store"
    ...
```

- [ ] **Step 6: Run the backend suite**

```powershell
./run.ps1 check -Backend
```

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat(backend): viewer_award_state from the dedup ledger; stop shared-caching the detail (#204)

Pre-submit earnability is derived from contribution_events.dedup_key — the award rule itself
— not from content rows, which drift from it: a hidden note, a hidden observation or a
deleted first photo all keep their dedup key spent while the content disappears, so a
content-derived preview promises points the insert will not award.

Also fixes a PRE-EXISTING leak: GET /fountains/{id} set no cache headers at all while already
returning viewer-scoped your_rating (#65) and condition_points_eligible_at (#124), so a shared
cache could serve one viewer's data to another."
```

---

## Task 4: Regenerate the API client

- [ ] **Step 1: Regenerate**

```powershell
$env:UV_PROJECT_ENVIRONMENT = "$env:TEMP\fr-venv"
pnpm exec turbo run generate --filter=@fountainrank/api-client --env-mode=loose
```
`--env-mode=loose` is required: turbo strips env vars in strict mode, so the generator's backend
`uv` call would not see `UV_PROJECT_ENVIRONMENT` (`claude_help/local-dev.md`).

- [ ] **Step 2: Verify the new fields landed**

```bash
grep -n "points_awarded\|viewer_award_state\|ViewerAwardState" packages/api-client/src/schema.d.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/api-client
git commit -m "build: regenerate api-client for points_awarded + viewer_award_state (#204)"
```

---

## Task 5: Shared — `photo_first`, the `AwardedPoints` brand, the earnable helpers

**Files:** `packages/contributions/src/index.ts`, `packages/contributions/src/index.test.ts`

**Interfaces:**
- Produces: `AwardedPoints` (branded type, **no constructor exported**); `ViewerAwardStateT`; `ratingEarnablePoints`, `attributeEarnablePoints`, `notePointsPreview(state)`, `photoEarnablePoints(state)`; `CONTRIBUTION_POINTS.photo_first`.

⚠️ **`notePointsPreview` changes signature** (`hasComment: boolean` → `ViewerAwardStateT | null`).
Find and fix every call site before you finish this task:
```bash
grep -rn "notePointsPreview" web mobile packages --include=*.ts --include=*.tsx | grep -v node_modules
```
(Known: `packages/contributions/src/index.test.ts` asserts `notePointsPreview(false)`, and the
add-fountain forms on both platforms use it. `addFountainPointsPreview` is **unchanged** — a brand
new fountain has no prior awards by definition.)

- [ ] **Step 1: Write the failing tests**

```ts
const state: ViewerAwardStateT = {
  unrated_rating_type_ids: [2, 3],
  unobserved_attribute_type_ids: [5],
  note_earnable: false,
  photo_first_earnable: false,
};

describe("earnable points (ledger-derived)", () => {
  it("counts only dimensions the viewer has not already been awarded for", () => {
    expect(ratingEarnablePoints(state, [1, 2])).toEqual([{ label: "Ratings", points: 2 }]);
    expect(ratingEarnablePoints(state, [1])).toEqual([]); // all already earned -> no preview
  });

  it("counts only attributes the viewer has not already observed", () => {
    expect(attributeEarnablePoints(state, [5])).toEqual([{ label: "Details", points: 2 }]);
    expect(attributeEarnablePoints(state, [4])).toEqual([]);
  });

  it("is 0 for a note/photo whose award is already spent", () => {
    expect(notePointsPreview(state)).toEqual([]);
    expect(photoEarnablePoints(state)).toEqual([]);
  });

  it("shows the full award to an anonymous viewer (null) — they have earned nothing yet", () => {
    expect(ratingEarnablePoints(null, [1, 2])).toEqual([{ label: "Ratings", points: 4 }]);
    expect(notePointsPreview(null)).toEqual([{ label: "Comment", points: 2 }]);
    expect(photoEarnablePoints(null)).toEqual([{ label: "First photo bonus", points: 5 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @fountainrank/contributions test
```

- [ ] **Step 3: Implement**

```ts
export const CONTRIBUTION_POINTS = {
  // ...existing...
  photo_first: 5, // was missing here entirely, though the backend has awarded it all along
} as const;

declare const AWARDED: unique symbol;
/**
 * Points the SERVER said it awarded (#204). Minted ONLY by the response-parsing layer:
 * `web/app/actions/awarded.ts` and `mobile/lib/awarded-points.ts`. A brand gates ASSIGNMENT, not
 * provenance — the LOCALITY of the constructor is what stops a client-invented number reaching the
 * celebration. Do NOT add a constructor here: exporting one from the shared package would let any
 * component mint a fake award and defeat the whole mechanism.
 */
export type AwardedPoints = number & { readonly [AWARDED]: true };

/** Mirrors the backend `ViewerAwardState`. Null/undefined for anonymous viewers. */
export type ViewerAwardStateT = {
  unrated_rating_type_ids: number[];
  unobserved_attribute_type_ids: number[];
  note_earnable: boolean;
  photo_first_earnable: boolean;
};

export function ratingEarnablePoints(
  state: ViewerAwardStateT | null | undefined,
  chosenRatingTypeIds: number[],
): PointsLine[] {
  const earnable = state
    ? chosenRatingTypeIds.filter((id) => state.unrated_rating_type_ids.includes(id))
    : chosenRatingTypeIds;
  return countedLine("Ratings", earnable.length, CONTRIBUTION_POINTS.rate);
}

export function attributeEarnablePoints(
  state: ViewerAwardStateT | null | undefined,
  chosenAttributeTypeIds: number[],
): PointsLine[] {
  const earnable = state
    ? chosenAttributeTypeIds.filter((id) => state.unobserved_attribute_type_ids.includes(id))
    : chosenAttributeTypeIds;
  return countedLine("Details", earnable.length, CONTRIBUTION_POINTS.observe_attribute);
}

export function notePointsPreview(state: ViewerAwardStateT | null | undefined): PointsLine[] {
  return !state || state.note_earnable
    ? [{ label: "Comment", points: CONTRIBUTION_POINTS.add_note }]
    : [];
}

export function photoEarnablePoints(state: ViewerAwardStateT | null | undefined): PointsLine[] {
  return !state || state.photo_first_earnable
    ? [{ label: "First photo bonus", points: CONTRIBUTION_POINTS.photo_first }]
    : [];
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @fountainrank/contributions test
```

- [ ] **Step 5: Commit**

```bash
git add packages/contributions
git commit -m "feat(contributions): AwardedPoints brand + ledger-derived earnable helpers (#204)"
```

---

## Task 6: Web — mint the award, gate BOTH celebration listeners

**Files:**
- Create: `web/app/actions/awarded.ts`
- Modify: `web/app/actions/contribute.ts`, `web/app/actions/add-fountain.ts`, `web/lib/contribution-event.ts`, `web/components/contributions/ContributionStatusOverlay.tsx`, **`web/components/map/MapBrowser.tsx`**, the five forms, `web/components/map/useAddFountainMode.tsx`
- Test: `web/components/contributions/ContributionStatusOverlay.test.tsx`, `web/app/actions/add-fountain.test.ts`

**Interfaces:**
- Consumes: `AwardedPoints` (Task 5), `points_awarded` (Task 4 types).
- Produces: `ActionResult = { ok: true; pointsAwarded: AwardedPoints } | { ok: false; error }`; `add-fountain` returns `{ ok: true; fountainId; pointsAwarded: AwardedPoints }`.

🚨 **There are TWO listeners.** `ContributionStatusOverlay.tsx` **and** `MapBrowser.tsx:459-465`.
Gating only the first leaves 0-point celebrations firing on the home map.

- [ ] **Step 1: Write the failing test**

`ContributionStatusOverlay.test.tsx` mocks `WaterCelebration` as `<div data-testid="celebration">`
— so asserting on `.water-drop` or `/points/i` text would **pass even while broken**. Assert the
mock's testid:

```tsx
it("does NOT celebrate when the server awarded 0 points", () => {
  render(<ContributionStatusOverlay />);
  act(() => {
    dispatchContribution(0 as AwardedPoints);
  });
  expect(screen.queryByTestId("celebration")).not.toBeInTheDocument();
});
```

**Also fix the two existing tests in this file** — `dispatchContribution(6)` and the bare
`dispatchContribution()` both become type errors under the new signature. The first becomes
`dispatchContribution(6 as AwardedPoints)`; the second (which asserted "celebrate with no number")
no longer has a meaning — replace it with the 0-point case above.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter web test -- ContributionStatusOverlay
```
If this render suite cannot run on the Windows host, say so and defer to CI's `workspace-js`
(`claude_help/local-dev.md`) — do **not** claim a local green you did not get.

- [ ] **Step 3: The single minting site**

Create `web/app/actions/awarded.ts` (server-only; both action modules import it, UI never does):

```ts
import "server-only";
import type { AwardedPoints } from "@fountainrank/contributions";

/**
 * Web's ONLY place that mints AwardedPoints (#204). `server-only` + living under app/actions keeps
 * it out of client components: UI receives an already-minted value through an ActionResult and has
 * no constructor to forge one with.
 */
export function awardedPoints(data: unknown): AwardedPoints {
  if (!data || typeof data !== "object") return 0 as AwardedPoints;
  const d = data as { points_awarded?: unknown; condition_points_awarded?: unknown };
  // Canonical field first; fall back to the deprecated condition-only field only when the canonical
  // one is ABSENT (an older server mid-deploy). Null/absent -> 0: never celebrate an unverified award.
  const value =
    typeof d.points_awarded === "number" ? d.points_awarded : d.condition_points_awarded;
  return (typeof value === "number" && value > 0 ? value : 0) as AwardedPoints;
}
```

In `contribute.ts`: delete `readPointsAwarded`, import `awardedPoints`, make
`ActionResult` carry `pointsAwarded: AwardedPoints` (non-optional on the ok branch), and return
`{ ok: true, pointsAwarded: awardedPoints(data) }` from `run(...)`.

`uploadPhoto` never parses the success body — parse it:

```ts
if (status >= 200 && status < 300) {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined; // absent body -> 0 -> no celebration
  }
  result = { ok: true, pointsAwarded: awardedPoints(data) };
}
```

`add-fountain.ts` returns `{ ok: true, fountainId }` today → add
`pointsAwarded: awardedPoints(data)` from the `FountainDetail` body. **`add-fountain.test.ts`
asserts the exact result object at lines ~49/63 — update those assertions.**

- [ ] **Step 4: Require the brand; gate BOTH listeners**

`web/lib/contribution-event.ts`:

```ts
import type { AwardedPoints } from "@fountainrank/contributions";

export type ContributionEventDetail = { points: AwardedPoints };

/** `points` MUST come from the server (see AwardedPoints). Listeners celebrate only when > 0. */
export function dispatchContribution(points: AwardedPoints): void {
  window.dispatchEvent(
    new CustomEvent<ContributionEventDetail>(CONTRIBUTION_EVENT, { detail: { points } }),
  );
}

export function contributionPoints(e: Event): number {
  return (e as CustomEvent<Partial<ContributionEventDetail>>).detail?.points ?? 0;
}
```

`ContributionStatusOverlay.tsx`:
```tsx
const onContribution = (e: Event) => {
  const awarded = contributionPoints(e);
  if (awarded <= 0) return; // saved, but earned nothing -> no celebration (#204)
  setPoints(awarded);
  setCelebrationKey((key) => key + 1);
};
```

`MapBrowser.tsx:459-465` — the second listener, same gate:
```tsx
function showCelebration(e: Event) {
  const awarded = contributionPoints(e);
  if (awarded <= 0) return; // (#204) — a verified 0 must not animate on the map either
  setCelebrationPoints(awarded);
  setCelebrationKey((key) => key + 1);
}
```

- [ ] **Step 5: Update all seven dispatch sites**

TypeScript now rejects every client-computed number:
- `RatingForm.tsx:50` (`chosen.length * CONTRIBUTION_POINTS.rate`), `AttributeForm.tsx:57`,
  `NoteForm.tsx:28` → `dispatchContribution(res.pointsAwarded)`
- `PhotoUpload.tsx:42,49` (bare `dispatchContribution()`) → `dispatchContribution(res.pointsAwarded)`
- `ConditionForm.tsx:62` → `dispatchContribution(res.pointsAwarded)`
- `useAddFountainMode.tsx:183` — bare `dispatchContribution()` with the comment *"add-fountain
  awarded points aren't returned to the client (#2)"* → `dispatchContribution(res.pointsAwarded)`
  and **delete the now-false comment.**

- [ ] **Step 6: 0-point copy on every form**

Follow `ConditionForm.tsx:55-61`, which already does exactly this:

```tsx
const earned = res.pointsAwarded;
setMsg({
  tone: "ok",
  text:
    earned > 0
      ? `Thanks — you earned ${earned} points.`
      : "Rating updated. You already earned points for these dimensions, so no points this time.",
});
dispatchContribution(earned);
```

Per-form 0-point copy (spec §4.7):
- Attributes: `"Details saved. You already earned points for these, so no points this time."`
- Note: `"Comment saved. You already earned points for a comment on this fountain."`
- Photo: `"Photo added. Points are only awarded for a fountain's first photo."`

- [ ] **Step 7: Run the web checks**

```powershell
./run.ps1 check -Web
```

- [ ] **Step 8: Commit**

```bash
git add web packages
git commit -m "feat(web): celebrate only what the server awarded (#204)

dispatchContribution takes a branded AwardedPoints minted only in app/actions/awarded.ts, so
a client-computed number is a type error. BOTH listeners (the status overlay and MapBrowser's)
now ignore a verified 0, and each form says plainly that nothing was earned and why."
```

---

## Task 7: Web — honest pre-submit previews

**Files:**
- Modify: `web/components/fountain/FountainDetail.tsx` — it holds the detail and calls
  `ContributeSection` in **three** places; pass `viewerAwardState={detail.viewer_award_state}` at
  all three.
- Modify: `web/components/fountain/ContributeSection.tsx` — takes `fountainId`, `dimensions`,
  `isAuthenticated`, `conditionPointsEligibleAt`, `variant` today. **Add a `viewerAwardState` prop**
  (it does NOT receive the detail object) and thread it to the four forms.
- Modify: `web/components/fountain/{RatingForm,AttributeForm,NoteForm,PhotoUpload}.tsx`
- Test: `web/components/fountain/RatingForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("warns instead of promising points when every chosen dimension is already earned", () => {
  render(
    <RatingForm
      fountainId={ID}
      dimensions={[{ rating_type_id: 1, name: "Taste", your_rating: 4, average_rating: 4, vote_count: 1 }]}
      viewerAwardState={{
        unrated_rating_type_ids: [],
        unobserved_attribute_type_ids: [],
        note_earnable: false,
        photo_first_earnable: false,
      }}
    />,
  );
  expect(screen.getByText(/won't earn points/i)).toBeInTheDocument();
  expect(screen.queryByText(/possible points/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter web test -- RatingForm
```

- [ ] **Step 3: Implement**

In `RatingForm` (mirror in the other three with their own helper + copy):

```tsx
const lines = ratingEarnablePoints(viewerAwardState, chosen.map(([id]) => id));
...
<div className="mt-3">
  {chosen.length > 0 && lines.length === 0 ? (
    <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      You&rsquo;ve already earned points for these dimensions — you can still update your rating,
      but it won&rsquo;t earn points again.
    </p>
  ) : (
    <PointsPreview lines={lines} />
  )}
</div>
```

- [ ] **Step 4: Run the web checks**

```powershell
./run.ps1 check -Web
```

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): pre-submit previews show only what is actually earnable (#204)"
```

---

## Task 8: Mobile — same contract, and the add-fountain path too

**Files:**
- Create: `mobile/lib/awarded-points.ts` (its own module, so the lint rule has one unambiguous specifier)
- Modify: `mobile/eslint.config.js`, `mobile/app/fountains/[id].tsx`, **`mobile/app/(tabs)/index.tsx`**, `mobile/components/fountain/*ContributionForm.tsx`
- Test: `mobile/lib/awarded-points.test.ts`

🚨 **Mobile has a SECOND celebration path the detail screen doesn't cover.**
`mobile/app/(tabs)/index.tsx:661-677` (add-fountain) computes
`totalPreviewPoints(addFountainPointsPreview({...}))` and calls `setCelebrationPoints(awardedPoints)`
+ `setCelebrationKey(...)`. That is a pure client guess and must read the POST's `points_awarded`.

**Mobile ESLint is stricter and CI-only** (React Compiler: no `useRef().current` read during render;
no unconditional `setState` in `useEffect`). `tsc`/Prettier will not catch these — after this task,
push and watch CI's `workspace-js`.

- [ ] **Step 1: Write the failing test**

`mobile/lib/awarded-points.test.ts`:

```ts
import { awardedPoints } from "./awarded-points";

describe("awardedPoints", () => {
  it("reads the canonical field", () => {
    expect(awardedPoints({ points_awarded: 4 })).toBe(4);
  });
  it("falls back to the deprecated condition field only when canonical is ABSENT", () => {
    expect(awardedPoints({ condition_points_awarded: 3 })).toBe(3);
    expect(awardedPoints({ points_awarded: 0, condition_points_awarded: 3 })).toBe(0);
  });
  it("treats null/absent as zero — never celebrate what we cannot verify", () => {
    expect(awardedPoints({ points_awarded: null })).toBe(0);
    expect(awardedPoints({})).toBe(0);
    expect(awardedPoints(undefined)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter mobile test -- awarded-points
```

- [ ] **Step 3: The single mobile minting site**

`mobile/lib/awarded-points.ts`:

```ts
import type { AwardedPoints } from "@fountainrank/contributions";

type WriteResponse = {
  points_awarded?: number | null;
  condition_points_awarded?: number | null;
};

/**
 * Mobile's ONLY place that mints AwardedPoints (#204). Canonical `points_awarded` first; the
 * deprecated `condition_points_awarded` only as a fallback for an older server. Null/absent -> 0:
 * never celebrate an unverified award. Lint-restricted to the mutation layer (eslint.config.js).
 */
export function awardedPoints(data: WriteResponse | undefined): AwardedPoints {
  const value = data?.points_awarded ?? data?.condition_points_awarded;
  return (typeof value === "number" && value > 0 ? value : 0) as AwardedPoints;
}
```

- [ ] **Step 4: Lock the minting site — and PROVE the rule fires**

Mobile has **no tsconfig `paths` alias**; code imports relatively (`../../lib/api`), so a rule
keyed on `"@/lib/api"` would silently never match. Use `patterns.group` globs against the relative
specifier, and allow only the mutation layer:

```js
{
  files: ["**/*.{ts,tsx}"],
  ignores: ["lib/awarded-points.ts", "app/fountains/[id].tsx", "app/(tabs)/index.tsx", "**/*.test.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["**/awarded-points", "**/lib/awarded-points"],
        importNames: ["awardedPoints"],
        message:
          "awardedPoints() may only be called in the mutation/parsing layer (#204). UI code must " +
          "receive an already-minted AwardedPoints, never mint one.",
      }],
    }],
  },
}
```

**Do not trust the glob — verify it.** Temporarily add `import { awardedPoints } from "../../lib/awarded-points";`
to a component (e.g. `mobile/components/fountain/NoteContributionForm.tsx`), run
`pnpm --filter mobile lint`, and confirm it ERRORS. Then remove the import. If the glob does not
match the relative specifier, widen it (`["../**/awarded-points", "./**/awarded-points", ...]`) until
it does. A lint rule that never fires is worse than no rule — it is a false sense of safety.

- [ ] **Step 5: Gate the detail-screen celebration**

`mobile/app/fountains/[id].tsx`:

```tsx
const refreshDetailAfterWrite = (detail: FountainDetailT | undefined, points: AwardedPoints) => {
  ...  // keep the existing cache-set / invalidate logic
  if (points <= 0) return;   // saved, but earned nothing -> refresh, no celebration (#204)
  setCelebrationPoints(points);
  setCelebrationKey((key) => key + 1);
};
```

Every mutation stops guessing:
- `ratingMutation` — was `body.ratings.length * CONTRIBUTION_POINTS.rate` → `awardedPoints(detail)`
- `attributeMutation` — was `body.observations.length * CONTRIBUTION_POINTS.observe_attribute` → `awardedPoints(detail)`
- `noteMutation` — was the hardcoded `CONTRIBUTION_POINTS.add_note`, and it bumps `celebrationKey`
  **inline**; route it through `refreshDetailAfterWrite` (or apply the same `<= 0` gate) using the
  `NoteOut.points_awarded` the POST now returns.
- `conditionMutation` — was `detail.condition_points_awarded ?? 0` → `awardedPoints(detail)`
  (canonical-first).
- `photoUploadMutation` — read `PhotoOut.points_awarded`.

Add the same 0-point copy as web (spec §4.7) to each form's success message.

- [ ] **Step 6: Gate the ADD-FOUNTAIN celebration**

`mobile/app/(tabs)/index.tsx:661-677`: delete the
`totalPreviewPoints(addFountainPointsPreview({...}))` computation used as the *awarded* value (the
same preview call at line ~903 is a legitimate **pre-submit preview** — leave that one). Read
`points_awarded` off the add-fountain POST response instead, and gate:

```tsx
const awarded = awardedPoints(created);  // `created` = the FountainDetail the POST returned
if (awarded > 0) {
  setCelebrationPoints(awarded);
  setCelebrationKey((key) => key + 1);
}
```

- [ ] **Step 7: Pre-submit previews**

Thread `detail.viewer_award_state` into the contribution forms and swap the preview helpers for the
earnable ones, exactly as Task 7 does on web.

- [ ] **Step 8: Run what CAN run locally, then rely on CI**

```powershell
./run.ps1 check -Mobile
```
State honestly which suites ran. Mobile's React-Compiler ESLint rules and the render suites are
**CI-only on this host** — watch `workspace-js` after pushing.

- [ ] **Step 9: Commit**

```bash
git add mobile
git commit -m "feat(mobile): celebrate only what the server awarded (#204)

Mutations read points_awarded instead of multiplying CONTRIBUTION_POINTS; the add-fountain
flow in (tabs)/index.tsx stops celebrating its own client-side preview total; both celebration
bumps are gated on a verified award > 0; awardedPoints() is lint-restricted to the mutation layer."
```

---

## Task 9: Style guide + full check

- [ ] **Step 1: Document the new UI states**

`CLAUDE.md` requires the style guide to cover any new UI state. In `docs/style-guide.md`, next to
the existing points/celebration components, document: the **neutral 0-point confirmation** (no
animation, no number, states the reason) and the **amber "won't earn points" pre-submit warning** —
with the copy from spec §4.7, the tone/colour classes, and the rule: *the water celebration fires
only on a server-verified award > 0; a saved-but-unearned contribution gets a plain `role="status"`
line and nothing else.*

- [ ] **Step 2: Full local mirror**

```powershell
./run.ps1 check
```
Report exactly what ran. Per `claude_help/local-dev.md`, the component-render suites, the full JS
unit suites, mobile's React-Compiler ESLint and `expo-doctor` truth are **CI-only on this host** —
name them as deferred to CI rather than reporting a green you did not get.

- [ ] **Step 3: Commit**

```bash
git add docs/style-guide.md
git commit -m "docs: style guide — neutral 0-point confirmation + won't-earn-points warning (#204)"
```

---

## Definition of Done

- Locally: backend mirror green (fully verifiable here); web `tsc`/ESLint/Prettier/`next build`
  green. **Render suites, full JS unit suites and mobile React-Compiler lint are deferred to CI** —
  state this explicitly rather than claiming a full local green.
- PR open; **all CI checks green** (this is where the mobile lint + render suites are actually
  verified).
- Codex PR review returns `VERDICT: APPROVED`; every PR comment addressed.
- Squash-merged to `main`.
- Web deployed — merging does **not** deploy: `gh workflow run deploy.yml --ref main`.
- Mobile released to both stores via `mobile-store-release.yml`.
- #204 closed, noting it was a client display bug, not a ledger exploit.
