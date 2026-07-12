# Server-Authoritative Contribution Points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The points celebration fires if and only if the server actually awarded points, and a 0-point contribution says plainly that it earned nothing.

**Architecture:** The `record_contributions` chokepoint starts reporting what it actually inserted (per user). Each write response carries an additive nullable `points_awarded`. Pre-submit "what can I still earn here" is derived from the `contribution_events.dedup_key` ledger — the award rule itself — not from content rows, which drift from it. On the clients, a branded `AwardedPoints` type minted only in the response-parsing layer makes it impossible to celebrate a client-invented number.

**Spec:** `docs/specs/2026-07-12-server-authoritative-contribution-points-design.md` (Codex-approved, review 3).

**Tech Stack:** FastAPI + SQLAlchemy 2 async + PostGIS; Next.js 16 (server actions); Expo/React Native + TanStack Query; pnpm workspace with `packages/contributions` (shared point math) and `packages/api-client` (generated OpenAPI types).

## Global Constraints

- **No database migration.** Every new field is a Pydantic response model built from existing tables/indexes. If you find yourself writing an Alembic revision, stop — you have misread the spec.
- **`packages/api-client/openapi.json` + `src/schema.d.ts` are git-tracked.** Regenerate them (Task 4) after backend schema changes; a regen must leave a clean tree.
- **Additive + nullable only.** Never remove or move an existing response field. `condition_points_awarded` and top-level `condition_points_eligible_at` STAY (released mobile clients read them).
- **`points_awarded` is canonical**; `condition_points_awarded` is deprecated-compat only and must not be the primary path in new code or new tests.
- **Award rules do not change.** `POINTS`, every `dk_*` key, and the #124 24h window are untouched. Existing `backend/tests/test_contribution_emission.py` assertions must keep passing **unchanged**.
- **Conventional Commits.** No AI attribution. No time estimates.
- **Logging:** every write path logs `points_awarded=<n>` with fountain/user context. Never log raw note bodies, tokens, or PII.
- **Mobile ESLint is stricter than web and only fails in CI** (React Compiler rules: no `useRef().current` read during render; no unconditional `setState` in `useEffect`). See `claude_help/testing-ci.md`.
- **Local checks:** `./run.ps1 check` is the CI mirror. On this Windows host, backend is fully verifiable via an isolated `UV_PROJECT_ENVIRONMENT`; component-render vitest suites and mobile ESLint are **CI-only** — do not claim a local green you did not get (`claude_help/local-dev.md`).

---

## File Structure

**Backend**
- `backend/app/contributions.py` — Modify: `record_contributions` returns `ContributionResult`; new `ContributionResult` dataclass; new `viewer_award_state` ledger query helper.
- `backend/app/schemas.py` — Modify: `ViewerAwardState` model; `points_awarded` on `FountainDetail`, `PhotoOut`, `NoteOut`; `viewer_award_state` on `FountainDetail`.
- `backend/app/routers/fountains.py` — Modify: `serialize_fountain_detail` (new params); `submit_ratings`, `submit_attributes`, `submit_condition`, the note handler, `add_fountain`, `fountain_detail` (cache header).
- `backend/app/routers/photos.py` — Modify: `upload_photo` returns `points_awarded`.
- `backend/tests/test_contribution_result.py` — Create: chokepoint unit tests (per-user, mixed batch, truthiness).
- `backend/tests/test_points_awarded.py` — Create: per-route award tests (the 0-point regressions).
- `backend/tests/test_viewer_award_state.py` — Create: ledger-vs-content tests (hidden note/observation, deleted first photo, no-consensus attribute, anonymous, cache header).

**Shared**
- `packages/contributions/src/index.ts` — Modify: `photo_first` constant; `AwardedPoints` brand type; `ViewerAwardState` type; earnable helpers.
- `packages/contributions/src/index.test.ts` — Modify: unit tests for the helpers.
- `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts` — Regenerate.

**Web**
- `web/app/actions/contribute.ts` — Modify: non-exported `awardedPoints()`; every action returns `pointsAwarded: AwardedPoints`.
- `web/lib/contribution-event.ts` — Modify: `dispatchContribution(points: AwardedPoints)`.
- `web/components/contributions/ContributionStatusOverlay.tsx` — Modify: gate `celebrationKey` on `points > 0`.
- `web/components/fountain/{RatingForm,AttributeForm,NoteForm,ConditionForm,PhotoUpload}.tsx`, `web/components/map/useAddFountainMode.tsx` — Modify: pass the server's award; 0-point copy; pre-submit previews.

**Mobile**
- `mobile/lib/api.ts` — Modify: exported `awardedPoints()` (the parsing boundary).
- `mobile/eslint.config.js` — Modify: `no-restricted-imports` locking `awardedPoints` to the parsing/mutation layer.
- `mobile/app/fountains/[id].tsx` — Modify: mutations read `points_awarded`; celebration gate; 0-point copy.
- `mobile/components/fountain/*ContributionForm.tsx` — Modify: pre-submit previews.

**Docs**
- `docs/style-guide.md` — Modify: document the 0-point neutral confirmation state.

---

## Task 1: Backend — `ContributionResult` at the chokepoint

**Files:**
- Modify: `backend/app/contributions.py:179-246` (`record_contributions`)
- Test: `backend/tests/test_contribution_result.py` (create)

**Interfaces:**
- Produces: `ContributionResult(event_ids: list[UUID], points_by_user: dict[UUID, int])` with `.points_for(user_id) -> int` and `__bool__`. `record_contributions(session, specs) -> ContributionResult` (was `list[UUID]`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_contribution_result.py`. Follow the fixture style of `backend/tests/test_contribution_emission.py` (`clean_db`, `session`) — read that file first and mirror how it seeds users/fountains.

```python
import uuid

import pytest

from app.contributions import ContributionResult, ContributionSpec, record_contributions


@pytest.mark.asyncio
async def test_points_for_returns_only_that_users_points(clean_db, session, make_user, make_fountain):
    """A batch spanning two users must never report one user's points to the other."""
    a, b = await make_user(), await make_user()
    f = await make_fountain()
    result = await record_contributions(
        session,
        [
            ContributionSpec(user_id=a.id, event_type="add_note", dedup_key=f"note:{a.id}:{f.id}",
                             fountain_id=f.id, target_type="note", target_id=uuid.uuid4()),
            ContributionSpec(user_id=b.id, event_type="add_note", dedup_key=f"note:{b.id}:{f.id}",
                             fountain_id=f.id, target_type="note", target_id=uuid.uuid4()),
        ],
    )
    assert result.points_for(a.id) == 2
    assert result.points_for(b.id) == 2
    assert result.points_for(uuid.uuid4()) == 0  # unknown user -> 0, never the batch total


@pytest.mark.asyncio
async def test_mixed_batch_sums_only_inserted_rows(clean_db, session, make_user, make_fountain):
    """rate@2 + first_rating_bonus@5: a re-submit inserts nothing and awards 0.

    Summing by len(event_ids) would be wrong here — the batch mixes point values.
    """
    u, f = await make_user(), await make_fountain()
    specs = [
        ContributionSpec(user_id=u.id, event_type="rate", dedup_key=f"rate:{u.id}:{f.id}:1",
                         fountain_id=f.id, target_type="rating", target_id=uuid.uuid4()),
        ContributionSpec(user_id=u.id, event_type="first_rating_bonus",
                         dedup_key=f"first_rating:{f.id}", fountain_id=f.id),
    ]
    first = await record_contributions(session, specs)
    assert first.points_for(u.id) == 7  # 2 + 5

    second = await record_contributions(session, specs)
    assert second.points_for(u.id) == 0
    assert second.event_ids == []


@pytest.mark.asyncio
async def test_truthiness_mirrors_the_old_list_return(clean_db, session, make_user, make_fountain):
    """`if inserted:` sites must keep their meaning after the return type change."""
    u, f = await make_user(), await make_fountain()
    spec = ContributionSpec(user_id=u.id, event_type="add_note", dedup_key=f"note:{u.id}:{f.id}",
                            fountain_id=f.id, target_type="note", target_id=uuid.uuid4())
    assert bool(await record_contributions(session, [spec])) is True   # inserted
    assert bool(await record_contributions(session, [spec])) is False  # deduped
    assert bool(await record_contributions(session, [])) is False      # empty
    assert isinstance(await record_contributions(session, []), ContributionResult)
```

If `make_user` / `make_fountain` fixtures do not exist in `backend/tests/conftest.py`, build the rows inline exactly as `test_contribution_emission.py` does — do not invent fixtures.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
$env:UV_PROJECT_ENVIRONMENT="<scratchpad>/fr-venv"
./run.ps1 up                     # postgis on :5436
./run.ps1 check -Backend
```
Expected: `ImportError: cannot import name 'ContributionResult'`.

- [ ] **Step 3: Implement `ContributionResult`**

In `backend/app/contributions.py`, add above `record_contributions`:

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

Change the signature and tail of `record_contributions`. The `per_user` aggregation already exists (lines ~224-239) — reuse it, do not add a second pass:

```python
async def record_contributions(
    session: AsyncSession, specs: list[ContributionSpec]
) -> ContributionResult:
    """Idempotently record contribution events and increment per-user stats.

    Returns the ids of events actually inserted (deduped specs are dropped) and the points
    credited per user. Caller owns the transaction.
    """
    if not specs:
        return ContributionResult(event_ids=[], points_by_user={})
    ...
    # (unchanged insert loop populating `inserted`)
    ...
    # (unchanged per_user aggregation + UserContributionStats upsert)

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

- [ ] **Step 4: Convert every caller and test**

`__bool__` is a safety net, not a licence to skip this. Find them all and convert explicitly:

```bash
grep -rn "record_contributions" backend/app backend/tests
```

Convert each site:
- `fountains.py:950` (`submit_ratings`) — assign the result; used in Task 2.
- `fountains.py:877` (add-fountain) and `fountains.py:1015` (`submit_attributes`) — assign; used in Task 2.
- `fountains.py:1106-1107` (condition): `inserted = await record_contributions(...)` then
  `points_awarded = points_for(event_type) if inserted else 0` → replace with
  `result = await record_contributions(session, [spec])` and
  `points_awarded = result.points_for(user.id)`. **This deletes a redundant re-derivation of the
  point value — the result now carries it.**
- `fountains.py:1168-1185` (note): the `"inserted" if inserted else "deduped"` log reads
  `result.event_ids`.
- `photos.py:401` — assign; used in Task 2.
- Any test that indexes/len()s the return value → `.event_ids`.

- [ ] **Step 5: Run the backend suite**

```bash
./run.ps1 check -Backend
```
Expected: PASS, including `test_contribution_emission.py` **unchanged**.

- [ ] **Step 6: Commit**

```bash
git add backend/app/contributions.py backend/app/routers backend/tests
git commit -m "refactor(backend): record_contributions reports points per user (#204)

The chokepoint returned ids only, so 'what did this write award?' was unanswerable —
a batch mixes event types (rate@2 + first_rating_bonus@5), so points cannot be derived
from an id count. Return ContributionResult with points_by_user + points_for(user_id);
per-user, because a batch may span users and a scalar total would let a future bulk path
report another user's points."
```

---

## Task 2: Backend — `points_awarded` on every write response

**Files:**
- Modify: `backend/app/schemas.py` (`FountainDetail`, `PhotoOut`, `NoteOut`)
- Modify: `backend/app/routers/fountains.py` (`serialize_fountain_detail`, `submit_ratings`, `submit_attributes`, `submit_condition`, note handler, `add_fountain`)
- Modify: `backend/app/routers/photos.py` (`upload_photo`)
- Test: `backend/tests/test_points_awarded.py` (create)

**Interfaces:**
- Consumes: `ContributionResult.points_for()` (Task 1).
- Produces: `points_awarded: int | None` on `FountainDetail`, `PhotoOut`, `NoteOut`. `serialize_fountain_detail(..., points_awarded: int | None = None)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_points_awarded.py`. These are the #204 regressions — each asserts the **award**, not the celebration.

```python
import pytest

pytestmark = pytest.mark.asyncio


async def test_rating_awards_then_zero_on_rerate(authed_client, fountain):
    """The #204 bug: re-rating must report 0, not a fresh full award."""
    body = {"ratings": [{"rating_type_id": 1, "stars": 5}, {"rating_type_id": 2, "stars": 4}]}
    first = await authed_client.post(f"/api/v1/fountains/{fountain.id}/ratings", json=body)
    assert first.status_code == 200
    # 2 dims x 2 pts + first_rating_bonus 5 = 9
    assert first.json()["points_awarded"] == 9

    again = await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 1}, {"rating_type_id": 2, "stars": 1}]},
    )
    assert again.status_code == 200
    assert again.json()["points_awarded"] == 0


async def test_rating_partial_award_counts_only_the_new_dimension(authed_client, fountain):
    await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    res = await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 3}, {"rating_type_id": 2, "stars": 4}]},
    )
    assert res.json()["points_awarded"] == 2  # only rating_type_id 2 is new


async def test_attributes_award_then_zero_on_reobserve(authed_client, fountain):
    body = {"observations": [{"attribute_type_id": 1, "value": "yes"}]}
    assert (await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/attributes", json=body)).json()["points_awarded"] == 2
    assert (await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/attributes", json=body)).json()["points_awarded"] == 0


async def test_second_note_awards_zero(authed_client, fountain):
    body = {"body": "first note"}
    assert (await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/notes", json=body)).json()["points_awarded"] == 2
    assert (await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/notes",
        json={"body": "second note"})).json()["points_awarded"] == 0


async def test_get_detail_reports_no_award(authed_client, fountain):
    """points_awarded is a WRITE-response field; a GET must not claim an award."""
    res = await authed_client.get(f"/api/v1/fountains/{fountain.id}")
    assert res.json()["points_awarded"] is None


async def test_condition_sets_both_canonical_and_legacy_fields(authed_client, fountain):
    res = await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/conditions", json={"status": "working"}
    )
    data = res.json()
    assert data["points_awarded"] == 3
    # Deprecated-compat: released mobile clients still read this. Must stay in lockstep.
    assert data["condition_points_awarded"] == 3
```

Reuse the existing `authed_client` / `fountain` fixture names from `backend/tests/` — read `conftest.py` first and use whatever is actually there. Add a 2nd-photo-awards-zero test following `test_photos_delete_report.py`'s upload helper.

- [ ] **Step 2: Run to verify they fail**

```bash
./run.ps1 check -Backend
```
Expected: `KeyError: 'points_awarded'`.

- [ ] **Step 3: Add the schema fields**

In `backend/app/schemas.py`, on `FountainDetail` (next to the existing #124 fields):

```python
    # #204 server-authoritative awards. Additive + nullable (no response-shape break): the points
    # this WRITE actually awarded the caller (0 when everything deduped); null on GET and every
    # other response. Canonical — `condition_points_awarded` below is deprecated compatibility for
    # already-released mobile clients and must not be the primary path in new code.
    points_awarded: int | None = None
```

Add the same field to `PhotoOut` and `NoteOut`.

- [ ] **Step 4: Thread it through the routes**

`serialize_fountain_detail` gains `points_awarded: int | None = None` alongside the existing
`condition_points_awarded` param, and sets it on the model.

- `submit_ratings` (`fountains.py:950`):
  ```python
  result = await record_contributions(session, _rating_contribution_specs(...))
  points_awarded = result.points_for(user.id)
  ...
  logger.info(
      "ratings submitted fountain=%s user=%s dimensions=%d points_awarded=%d",
      fountain.id, user.id, len(payload.ratings), points_awarded,
  )
  return await serialize_fountain_detail(
      session, fountain, user_id=user.id, points_awarded=points_awarded
  )
  ```
- `submit_attributes` (`fountains.py:1015`) — identical shape, logging `observations=%d`.
- `submit_condition` (`fountains.py:1106`) — pass **both** `points_awarded=points_awarded` and the
  existing `condition_points_awarded=points_awarded`. They stay in lockstep; the legacy field is
  never computed separately.
- `add_fountain` (`fountains.py:877`) — pass `points_awarded=result.points_for(user.id)`. This is
  the first time the add-fountain award is visible to a client at all.
- Note handler (`fountains.py:1168`) — `NoteOut(..., points_awarded=result.points_for(user.id))`.
  **Keep the existing "no raw note body in logs" discipline** — log the count/points, never `body`.
- `upload_photo` (`photos.py:401`) — `PhotoOut(..., points_awarded=result.points_for(user.id))`.

- [ ] **Step 5: Run the backend suite**

```bash
./run.ps1 check -Backend
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat(backend): return points_awarded on every contribution write (#204)

Additive + nullable on FountainDetail/PhotoOut/NoteOut, set from
ContributionResult.points_for(user.id). condition_points_awarded stays populated in
lockstep as deprecated compatibility for released mobile clients. Add-fountain awards
are now visible to the client for the first time."
```

---

## Task 3: Backend — `ViewerAwardState` from the dedup ledger + stop shared-caching the detail

**Files:**
- Modify: `backend/app/contributions.py` (ledger query helper)
- Modify: `backend/app/schemas.py` (`ViewerAwardState`, `FountainDetail.viewer_award_state`)
- Modify: `backend/app/routers/fountains.py` (`serialize_fountain_detail`, `fountain_detail` cache header)
- Test: `backend/tests/test_viewer_award_state.py` (create)

**Interfaces:**
- Produces: `ViewerAwardState` model; `FountainDetail.viewer_award_state: ViewerAwardState | None`;
  `viewer_award_state(session, user_id, fountain_id) -> ViewerAwardState` in `contributions.py`.

**Why the ledger and not the content rows** (do not "simplify" this back — it is the point of the task): the dedup key is permanent, but content rows are not. A hidden note, a hidden attribute observation, or a deleted first photo all leave the dedup key spent while the content disappears — so a content-derived preview promises points the insert will not award. Reading `contribution_events.dedup_key` asks exactly the question the insert asks.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_viewer_award_state.py`.

```python
import pytest

pytestmark = pytest.mark.asyncio


async def test_anonymous_gets_no_viewer_award_state(client, fountain):
    res = await client.get(f"/api/v1/fountains/{fountain.id}")
    assert res.json()["viewer_award_state"] is None


async def test_rated_dimension_drops_out_of_unrated(authed_client, fountain):
    await authed_client.post(
        f"/api/v1/fountains/{fountain.id}/ratings",
        json={"ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    state = (await authed_client.get(f"/api/v1/fountains/{fountain.id}")).json()["viewer_award_state"]
    assert 1 not in state["unrated_rating_type_ids"]
    assert 2 in state["unrated_rating_type_ids"]


async def test_hidden_own_note_is_still_not_earnable(authed_client, session, fountain, hide_note):
    """The dedup key survives moderation — a hidden note must NOT read as earnable."""
    await authed_client.post(f"/api/v1/fountains/{fountain.id}/notes", json={"body": "n"})
    await hide_note(fountain.id)  # sets is_hidden=True; dedup row untouched

    state = (await authed_client.get(f"/api/v1/fountains/{fountain.id}")).json()["viewer_award_state"]
    assert state["note_earnable"] is False

    # ...and the insert agrees: still 0.
    again = await authed_client.post(f"/api/v1/fountains/{fountain.id}/notes", json={"body": "n2"})
    assert again.json()["points_awarded"] == 0


async def test_deleted_first_photo_leaves_photo_first_spent(authed_client, fountain, upload_photo):
    """photo_first is per-fountain and permanent; self-delete reverses points but not the key."""
    photo_id = await upload_photo(fountain.id)
    await authed_client.delete(f"/api/v1/fountains/{fountain.id}/photos/{photo_id}")

    state = (await authed_client.get(f"/api/v1/fountains/{fountain.id}")).json()["viewer_award_state"]
    assert state["photo_first_earnable"] is False  # zero VISIBLE photos, but the key is spent


async def test_attribute_with_no_consensus_row_is_still_earnable(authed_client, fountain):
    """Candidates come from the attribute-type registry, not the response's `attributes` list."""
    detail = (await authed_client.get(f"/api/v1/fountains/{fountain.id}")).json()
    assert detail["attributes"] == []  # nobody has observed anything yet
    assert detail["viewer_award_state"]["unobserved_attribute_type_ids"]  # ...but all are earnable


async def test_stale_hint_loses_to_the_insert(authed_client, fountain):
    """ViewerAwardState is an as-of-read HINT (spec §4.3.1); the POST is authoritative.

    Simulates the TOCTOU race (another tab/device spending the key between GET and submit):
    the client holds a state that says "earnable", submits, and the insert dedups to 0. The
    response must report 0 so the client suppresses the celebration.
    """
    stale = (await authed_client.get(f"/api/v1/fountains/{fountain.id}")).json()["viewer_award_state"]
    assert stale["note_earnable"] is True  # the hint the client is holding

    await authed_client.post(f"/api/v1/fountains/{fountain.id}/notes", json={"body": "a"})  # key spent
    late = await authed_client.post(f"/api/v1/fountains/{fountain.id}/notes", json={"body": "b"})
    assert late.json()["points_awarded"] == 0  # the insert wins, not the stale hint


async def test_detail_is_never_shared_cached(client, authed_client, fountain):
    """The response carries viewer-scoped data — a shared cache would leak it between users."""
    for c in (client, authed_client):
        res = await c.get(f"/api/v1/fountains/{fountain.id}")
        assert res.headers["cache-control"] == "private, no-store"
```

`hide_note` / `upload_photo` helpers: reuse the ones in `backend/tests/test_admin_moderation.py` and `test_photos_delete_report.py` if they exist; otherwise write the rows directly via `session`.

- [ ] **Step 2: Run to verify they fail**

```bash
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

    Null for anonymous callers. `condition_points_eligible_at` is deliberately NOT here — it
    stays top-level on FountainDetail, where released clients already read it.
    """

    unrated_rating_type_ids: list[int]
    unobserved_attribute_type_ids: list[int]
    note_earnable: bool
    photo_first_earnable: bool
```

On `FountainDetail`: `viewer_award_state: ViewerAwardState | None = None`.

- [ ] **Step 4: Implement the ledger query**

In `backend/app/contributions.py` (it owns the dedup-key vocabulary, so the query belongs here, not in the router):

```python
async def viewer_award_state(
    session: AsyncSession, user_id: uuid.UUID, fountain_id: uuid.UUID
) -> ViewerAwardState:
    """What `user_id` can still earn on `fountain_id`, per the dedup ledger.

    Candidates come from the TYPE REGISTRIES, not from the fountain's existing content: a user
    can observe an attribute that has no consensus row yet, so building candidates from the
    detail response's `attributes` list would silently drop the attributes most likely to be
    earnable. Note RatingType has no `is_active` flag (only place_type/sort_order) — do not
    filter on one.
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

    candidates = [*rate_keys, *attr_keys, note_key, photo_key]
    # One index scan on uq_contribution_events_dedup_key. Anything returned is already awarded.
    spent = set(
        (await session.execute(
            select(ContributionEvent.dedup_key).where(
                ContributionEvent.dedup_key.in_(candidates)
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

Call it from `serialize_fountain_detail` **only when `user_id is not None`** (anonymous → `None`), alongside the existing `your_stars` query.

- [ ] **Step 5: Fix the shared-cache leak**

`fountains.py:661` — `fountain_detail` currently takes no `Response` and sets **no** cache headers, while already returning viewer-scoped `your_rating` and `condition_points_eligible_at`. Adopt the `list_photos` precedent (`photos.py:75-80`):

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

```bash
./run.ps1 check -Backend
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat(backend): viewer_award_state from the dedup ledger; stop shared-caching the detail (#204)

Pre-submit earnability is derived from contribution_events.dedup_key — the award rule
itself — not from content rows, which drift from it: a hidden note, a hidden observation
or a deleted first photo all keep their dedup key spent while the content disappears, so
a content-derived preview promises points the insert will not award.

Also fixes a PRE-EXISTING leak: GET /fountains/{id} set no cache headers at all while
already returning viewer-scoped your_rating (#65) and condition_points_eligible_at (#124),
so a shared cache could serve one viewer's data to another."
```

---

## Task 4: Regenerate the API client

**Files:**
- Modify (generated): `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`

- [ ] **Step 1: Regenerate**

```bash
$env:UV_PROJECT_ENVIRONMENT="<scratchpad>/fr-venv"
pnpm exec turbo run generate --filter=@fountainrank/api-client --env-mode=loose
```
(`--env-mode=loose` is required — turbo strips env vars in strict mode, so the generator's backend `uv` call would not see `UV_PROJECT_ENVIRONMENT`. See `claude_help/local-dev.md`.)

- [ ] **Step 2: Verify the new fields landed**

```bash
grep -n "points_awarded\|viewer_award_state\|ViewerAwardState" packages/api-client/src/schema.d.ts
```
Expected: `points_awarded` on FountainDetail/PhotoOut/NoteOut, `viewer_award_state`, and a `ViewerAwardState` schema.

- [ ] **Step 3: Commit**

```bash
git add packages/api-client
git commit -m "build: regenerate api-client for points_awarded + viewer_award_state (#204)"
```

---

## Task 5: Shared — `photo_first`, the `AwardedPoints` brand, and the earnable helpers

**Files:**
- Modify: `packages/contributions/src/index.ts`
- Test: `packages/contributions/src/index.test.ts`

**Interfaces:**
- Produces: `AwardedPoints` (branded type only — **no constructor is exported**); `ViewerAwardStateT`; `ratingEarnablePoints`, `attributeEarnablePoints`, `notePointsPreview(state)`, `photoEarnablePoints(state)`; `CONTRIBUTION_POINTS.photo_first`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/contributions/src/index.test.ts`:

```ts
import {
  attributeEarnablePoints,
  notePointsPreview,
  photoEarnablePoints,
  ratingEarnablePoints,
  type ViewerAwardStateT,
} from "./index";

const state: ViewerAwardStateT = {
  unrated_rating_type_ids: [2, 3],
  unobserved_attribute_type_ids: [5],
  note_earnable: false,
  photo_first_earnable: false,
};

describe("earnable points (ledger-derived)", () => {
  it("counts only dimensions the viewer has not already been awarded for", () => {
    // 1 is already awarded, 2 is not -> only 2 earns.
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

  it("shows the full award to an anonymous viewer (null state) — they have earned nothing yet", () => {
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

In `packages/contributions/src/index.ts`:

```ts
export const CONTRIBUTION_POINTS = {
  add_fountain: 10,
  first_fountain_bonus: 5,
  first_in_area_bonus: 15,
  rate: 2,
  observe_attribute: 2,
  verify_working: 3,
  report_condition: 2,
  add_note: 2,
  photo_first: 5, // was missing here entirely, though the backend has awarded it all along
} as const;

declare const AWARDED: unique symbol;
/**
 * Points the SERVER said it awarded (#204). Minted ONLY by the response-parsing layer:
 * `awardedPoints()` in `web/app/actions/contribute.ts` (not exported) and in `mobile/lib/api.ts`
 * (lint-restricted). A brand gates ASSIGNMENT, not provenance — the locality of the constructor
 * is what stops a client-invented number reaching the celebration. Do not add a constructor here.
 */
export type AwardedPoints = number & { readonly [AWARDED]: true };

/** Mirrors the backend `ViewerAwardState`. Null for anonymous viewers. */
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

export function photoEarnablePoints(state: ViewerAwardStateT | null | undefined): PointsLine[] {
  return !state || state.photo_first_earnable
    ? [{ label: "First photo bonus", points: CONTRIBUTION_POINTS.photo_first }]
    : [];
}
```

Change `notePointsPreview` to take the state (it currently takes `hasComment: boolean`). Keep a
`hasComment` guard at the call site instead:

```ts
export function notePointsPreview(state: ViewerAwardStateT | null | undefined): PointsLine[] {
  return !state || state.note_earnable
    ? [{ label: "Comment", points: CONTRIBUTION_POINTS.add_note }]
    : [];
}
```

`addFountainPointsPreview` is unchanged — a new fountain has no prior awards by definition.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @fountainrank/contributions test
```
Expected: PASS. Fix the now-broken `notePointsPreview(false)` call in the existing test.

- [ ] **Step 5: Commit**

```bash
git add packages/contributions
git commit -m "feat(contributions): AwardedPoints brand + ledger-derived earnable helpers (#204)

Adds the missing photo_first constant (the backend has awarded it all along) and the
branded AwardedPoints type. The brand is exported WITHOUT a constructor on purpose — each
platform mints it in its own parsing layer so a client-computed number cannot reach the
celebration."
```

---

## Task 6: Web — mint the award, gate the celebration

**Files:**
- Modify: `web/app/actions/contribute.ts`, `web/lib/contribution-event.ts`,
  `web/components/contributions/ContributionStatusOverlay.tsx`,
  `web/components/fountain/{RatingForm,ConditionForm,AttributeForm,NoteForm,PhotoUpload}.tsx`,
  `web/components/map/useAddFountainMode.tsx`
- Test: `web/components/contributions/ContributionStatusOverlay.test.tsx`

**Interfaces:**
- Consumes: `AwardedPoints` (Task 5), `points_awarded` (Task 4 types).
- Produces: `ActionResult = { ok: true; pointsAwarded: AwardedPoints } | { ok: false; error }`.

- [ ] **Step 1: Write the failing test**

In `web/components/contributions/ContributionStatusOverlay.test.tsx` (it already covers
`dispatchContribution(6)` and the bare `dispatchContribution()`):

```ts
it("does NOT celebrate when the server awarded 0 points", async () => {
  render(<ContributionStatusOverlay />);
  act(() => {
    dispatchContribution(0 as AwardedPoints);
  });
  // No water drops, no "+N points" — a verified 0 must be silent (#204).
  expect(screen.queryByText(/points/i)).not.toBeInTheDocument();
  expect(document.querySelector(".water-drop")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter web test -- ContributionStatusOverlay
```
(If this render suite cannot run on the Windows host, say so and rely on CI's `workspace-js` —
see `claude_help/local-dev.md`. Do **not** claim a local green you did not get.)

- [ ] **Step 3: Require the brand and gate the overlay**

`web/lib/contribution-event.ts`:

```ts
import type { AwardedPoints } from "@fountainrank/contributions";

export const CONTRIBUTION_EVENT = "fountainrank:contribution";
export type ContributionEventDetail = { points: AwardedPoints };

/** Dispatch the contribution event. `points` MUST come from the server (see AwardedPoints) —
 *  the overlay celebrates only when it is > 0. */
export function dispatchContribution(points: AwardedPoints): void {
  window.dispatchEvent(
    new CustomEvent<ContributionEventDetail>(CONTRIBUTION_EVENT, { detail: { points } }),
  );
}

export function contributionPoints(e: Event): number {
  return (e as CustomEvent<Partial<ContributionEventDetail>>).detail?.points ?? 0;
}
```

`ContributionStatusOverlay.tsx` — only bump the key on a real award:

```tsx
const onContribution = (e: Event) => {
  const awarded = contributionPoints(e);
  if (awarded <= 0) return; // saved, but earned nothing -> no celebration (#204)
  setPoints(awarded);
  setCelebrationKey((key) => key + 1);
};
```

- [ ] **Step 4: Mint `AwardedPoints` in the action layer — and nowhere else**

`web/app/actions/contribute.ts`. **`awardedPoints` is NOT exported** — that is the enforcement:
a non-exported helper is unreachable from UI code, so no lint rule is needed on web.

```ts
import type { AwardedPoints } from "@fountainrank/contributions";

export type ActionResult =
  | { ok: true; pointsAwarded: AwardedPoints }
  | { ok: false; error: ContributeError };

// The ONLY place web mints AwardedPoints. Deliberately not exported: UI code receives an
// already-minted value through ActionResult and has no constructor to forge one with (#204).
function awardedPoints(data: unknown): AwardedPoints {
  const zero = 0 as AwardedPoints;
  if (!data || typeof data !== "object") return zero;
  const d = data as { points_awarded?: unknown; condition_points_awarded?: unknown };
  // Canonical field first; fall back to the deprecated condition-only field only when the
  // canonical one is absent (an older server during the deploy window). Null/absent -> 0:
  // never celebrate what we cannot verify.
  const value = typeof d.points_awarded === "number" ? d.points_awarded : d.condition_points_awarded;
  return (typeof value === "number" && value > 0 ? value : 0) as AwardedPoints;
}
```

Delete `readPointsAwarded`. In `run(...)`, return `{ ok: true, pointsAwarded: awardedPoints(data) }`.

`uploadPhoto` currently never parses the success body — parse it:

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

Add-fountain lives in its **own module**, `web/app/actions/add-fountain.ts` (not `contribute.ts`),
and returns `{ ok: true; fountainId }` today. It must also return the award:
`{ ok: true; fountainId; pointsAwarded: AwardedPoints }`, read from the `FountainDetail` body the
POST already returns. Because `awardedPoints()` is non-exported in `contribute.ts`, either move it
to a shared server-only module imported by both actions (e.g. `web/app/actions/awarded.ts`, not
exported beyond the actions directory) **or** duplicate the four-line reader there. Prefer the
shared module — one minting implementation, still unreachable from UI.
Update `web/app/actions/add-fountain.test.ts` (it asserts the exact result object shape at
lines 49/63 — those assertions will fail until you add the field).

- [ ] **Step 5: Update all seven dispatch sites**

TypeScript will now reject every client-computed number. Each becomes the server's value:

- `RatingForm.tsx:50` — `dispatchContribution(chosen.length * CONTRIBUTION_POINTS.rate)` →
  `dispatchContribution(res.pointsAwarded)`
- `AttributeForm.tsx:57`, `NoteForm.tsx:28` — same shape.
- `PhotoUpload.tsx:42,49` — `dispatchContribution()` → `dispatchContribution(res.pointsAwarded)`.
- `ConditionForm.tsx:62` — already server-authoritative; now uses `res.pointsAwarded`.
- `useAddFountainMode.tsx:183` — `dispatchContribution()` (with its "awarded points aren't returned
  to the client" comment) → `dispatchContribution(res.pointsAwarded)`; **delete the stale comment.**

- [ ] **Step 6: 0-point copy on every form**

The message must state that nothing was earned and why. `ConditionForm.tsx:55-61` already does this
— follow it exactly:

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

```bash
./run.ps1 check -Web
```
Expected: ESLint + Prettier + `tsc` + `next build` PASS.

- [ ] **Step 8: Commit**

```bash
git add web packages
git commit -m "feat(web): celebrate only what the server awarded (#204)

dispatchContribution now takes a branded AwardedPoints, minted only by the non-exported
awardedPoints() in the action layer — a client-computed number is a type error. The overlay
ignores a verified 0, and each form says plainly that nothing was earned and why."
```

---

## Task 7: Web — honest pre-submit previews

**Files:**
- Modify: `web/components/fountain/ContributeSection.tsx` — the single parent that renders all five
  forms (`RatingForm`, `PhotoUpload`, `AttributeForm`, `ConditionForm`, `NoteForm`). It already
  receives the detail (it passes `conditionPointsEligibleAt` to `ConditionForm`), so thread
  `viewerAwardState={detail.viewer_award_state}` down from the same place.
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

Thread `viewerAwardState` from the detail response into each form. In `RatingForm`:

```tsx
const lines = ratingEarnablePoints(viewerAwardState, chosen.map(([id]) => id));
...
<div className="mt-3">
  {chosen.length > 0 && lines.length === 0 ? (
    <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      You&rsquo;ve already earned points for these dimensions — you can still update your
      rating, but it won&rsquo;t earn points again.
    </p>
  ) : (
    <PointsPreview lines={lines} />
  )}
</div>
```

Mirror this in `AttributeForm` (`attributeEarnablePoints`), `NoteForm` (`notePointsPreview`) and
`PhotoUpload` (`photoEarnablePoints`), each with its own copy.

- [ ] **Step 4: Run the web checks**

```bash
./run.ps1 check -Web
```

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): pre-submit previews show only what is actually earnable (#204)"
```

---

## Task 8: Mobile — same contract

**Files:**
- Modify: `mobile/lib/api.ts` (the parsing boundary — exports `awardedPoints`)
- Modify: `mobile/eslint.config.js` (`no-restricted-imports`)
- Modify: `mobile/app/fountains/[id].tsx` (mutations, celebration gate, copy)
- Modify: `mobile/components/fountain/{Rating,Attribute,Note}ContributionForm.tsx` (previews)
- Test: `mobile/lib/api.test.ts`, `mobile/lib/contributions.test.ts`

**Mobile ESLint is stricter and CI-only** — no `useRef().current` read during render, no unconditional
`setState` in `useEffect`. `tsc` and Prettier will not catch these. After this task, push and watch
CI's `workspace-js` job rather than trusting a local green.

- [ ] **Step 1: Write the failing test**

In `mobile/lib/api.test.ts`:

```ts
describe("awardedPoints", () => {
  it("reads the canonical field", () => {
    expect(awardedPoints({ points_awarded: 4 })).toBe(4);
  });
  it("falls back to the deprecated condition field only when canonical is absent", () => {
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
pnpm --filter mobile test -- api
```

- [ ] **Step 3: Mint at the mobile parsing boundary**

`mobile/lib/api.ts` — mobile has no server-action layer, so this module IS the boundary:

```ts
import type { AwardedPoints } from "@fountainrank/contributions";

/**
 * Mint AwardedPoints from a write response (#204). Mobile's ONLY minting site — the
 * `no-restricted-imports` rule in eslint.config.js keeps components from importing it.
 * Canonical `points_awarded` first; the deprecated `condition_points_awarded` only as a
 * fallback for an older server. Null/absent -> 0: never celebrate an unverified award.
 */
export function awardedPoints(
  data: { points_awarded?: number | null; condition_points_awarded?: number | null } | undefined,
): AwardedPoints {
  const value = data?.points_awarded ?? data?.condition_points_awarded;
  return (typeof value === "number" && value > 0 ? value : 0) as AwardedPoints;
}
```

`mobile/eslint.config.js` — restrict it to the parsing/mutation layer:

```js
{
  files: ["**/*.{ts,tsx}"],
  ignores: ["lib/api.ts", "app/fountains/[id].tsx", "**/*.test.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      paths: [{
        name: "@/lib/api",
        importNames: ["awardedPoints"],
        message:
          "awardedPoints() may only be called in the response-parsing layer (#204). UI code must " +
          "receive an already-minted AwardedPoints from a mutation's onSuccess, never mint one.",
      }],
    }],
  },
}
```
(Match the import specifier the repo actually uses — `@/lib/api` vs a relative path. Check first.)

- [ ] **Step 4: Gate the celebration and read the server's number**

`mobile/app/fountains/[id].tsx`:

```tsx
const refreshDetailAfterWrite = (detail: FountainDetailT | undefined, points: AwardedPoints) => {
  ...
  // Saved, but earned nothing -> refresh the data, skip the celebration (#204).
  if (points <= 0) return;
  setCelebrationPoints(points);
  setCelebrationKey((key) => key + 1);
};
```

Every mutation stops guessing:

```tsx
// was: refreshDetailAfterWrite(detail, body.ratings.length * CONTRIBUTION_POINTS.rate)
onSuccess: (detail) => refreshDetailAfterWrite(detail, awardedPoints(detail)),
```
Same for `attributeMutation` (was `body.observations.length * CONTRIBUTION_POINTS.observe_attribute`),
`noteMutation` (was the hardcoded `CONTRIBUTION_POINTS.add_note` — and it bumps `celebrationKey`
inline, so route it through the gate), `conditionMutation` (was `detail.condition_points_awarded ?? 0`
→ now `awardedPoints(detail)`), and `photoUploadMutation`.

Add the same 0-point copy as web (spec §4.7) to each form's success message.

- [ ] **Step 5: Pre-submit previews**

Thread `detail.viewer_award_state` into the contribution forms and swap the preview helpers for the
earnable ones exactly as Task 7 does on web.

- [ ] **Step 6: Run what CAN run locally, then rely on CI**

```bash
./run.ps1 check -Mobile   # tsc + lint + vitest + expo-doctor
```
State honestly which suites ran. Mobile ESLint's React-Compiler rules and the render suites are
**CI-only on this host** — watch `workspace-js` after pushing.

- [ ] **Step 7: Commit**

```bash
git add mobile
git commit -m "feat(mobile): celebrate only what the server awarded (#204)

Mutations read points_awarded instead of multiplying CONTRIBUTION_POINTS; the celebration
is gated on a verified award > 0; awardedPoints() is lint-restricted to the parsing layer."
```

---

## Task 9: Style guide + issue close-out

**Files:**
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Document the 0-point confirmation state**

`CLAUDE.md` requires the style guide to cover any new UI state. Add, next to the existing points/
celebration components: the **neutral 0-point confirmation** (no animation, no number, states the
reason) and the **amber "won't earn points" pre-submit warning** — with the copy from spec §4.7,
the tone/colour classes, and the rule: *the water celebration fires only on a server-verified award
> 0; a saved-but-unearned contribution gets a plain `role="status"` line and nothing else.*

- [ ] **Step 2: Full local mirror**

```bash
./run.ps1 check
```
Expected: green, except the host-limited suites called out in `claude_help/local-dev.md` — name them.

- [ ] **Step 3: Commit**

```bash
git add docs/style-guide.md
git commit -m "docs: style guide — neutral 0-point confirmation + won't-earn-points warning (#204)"
```

---

## Definition of Done

- `./run.ps1 check` green locally (minus the documented host-limited suites).
- PR open, all CI checks green.
- Codex PR review returns `VERDICT: APPROVED`; every PR comment addressed.
- Squash-merged to `main`.
- Web deployed (`gh workflow run deploy.yml --ref main` — merging does **not** deploy).
- Mobile released to both stores (`mobile-store-release.yml`).
- #204 closed with a note that it was a client display bug, not a ledger exploit.
