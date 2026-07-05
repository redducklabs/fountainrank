# Repeat-contribution point limit (condition reports) — design

Design spec for GitHub issue **#124** (limit point awards for repeat fountain updates
within 24 hours). Ships as its own branch/PR.

## 1. Problem & scope

The point system can be gamed if a user keeps earning points for repeatedly updating the
**same** fountain. The issue asks for a per-user, per-fountain 24-hour eligibility window
so that repeat point-generating rating/update actions on one fountain stop minting points,
while still accepting the data change.

**Key finding — most of this is already enforced.** The contribution chokepoint
(`app/contributions.py`) awards points idempotently via a unique `dedup_key`, and the
existing keys already make the rating/attribute/note flows one-and-done:

| Action | Points | `dedup_key` shape | Repeat-earning today |
|---|---|---|---|
| `rate` (per dimension) | 2 | `rate:{user}:{fountain}:{rating_type_id}` (no time) | **Once ever** per (user, fountain, dimension) |
| `first_rating_bonus` | 5 | `first_rating:{fountain}` | Once ever per fountain |
| `observe_attribute` | 2 | `attr:{user}:{fountain}:{attr_type}` (no time) | **Once ever** per (user, fountain, attribute) |
| `add_note` | 2 | `note:{user}:{fountain}` (no time) | **Once ever** per (user, fountain) |
| `verify_working` | 3 | `verify:{user}:{fountain}:{YYYYMMDD}` (**calendar day**) | **Repeatable every calendar day** |
| `report_condition` | 2 | `cond:{user}:{fountain}:{YYYYMMDD}` (**calendar day**) | **Repeatable every calendar day** |

So `rate`, `observe_attribute`, and `add_note` are **not farmable** — a re-submit earns 0
points forever, and the rating UI already surfaces "already rated" via `DimensionSummary.your_rating`.
The **only** unbounded repeat vector is **condition reporting**: a user can pocket
`verify_working` (3) **and** `report_condition` (2) = **5 points/day on the same fountain,
every calendar day, forever**, and multiply that across many fountains. The calendar-day
key also has a boundary loophole — earn at 23:59 UTC, earn again at 00:01 UTC.

This spec therefore takes the **targeted** interpretation of #124: close the actual hole
(condition reporting) with a rolling-24h, coalesced point gate, and expose a pre-submit
signal so clients can warn. The already-safe flows are left untouched.

**In scope:**

- A **rolling 24-hour, coalesced** point gate on condition reports: `verify_working` and
  `report_condition` share **one** per-(user, fountain) window. At most one of them awards
  points in any rolling 24h; the window is anchored on the user's most recent *awarded*
  condition event for that fountain.
- The condition report row (`condition_reports`) and the derived status recompute run
  **unconditionally** — data always persists; only the points event is gated.
- A per-viewer **pre-submit eligibility signal** on the fountain-detail response so web +
  mobile can warn the user *before* they submit that the update will not earn points.
- One **additive index migration** to keep the per-detail eligibility lookback fast for
  high-volume contributors (see §2.3).
- Regeneration of the **OpenAPI schema + shared TypeScript api-client**
  (`packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`) for the new
  `FountainDetail` field.
- Web + mobile **non-blocking warning** in the condition-report UI, **and** correcting the
  existing client point-feedback surfaces so an ineligible (0-point) submit never implies
  points were awarded (see §2.4).
- Backend + client tests.

**Out of scope (explicitly):**

- Changing `rate`, `observe_attribute`, `add_note`, or any `first_*`/`add_fountain` award
  behavior — they are already one-and-done and are **not** made ineligible by this limit
  (satisfies the issue's "new fountain / new information not affected" criterion).
- A coarse "one point per fountain per 24h across *all* action types" cap. Rejected in
  brainstorming: it would reduce points for legitimate first-time thorough contributions
  (e.g. a new visitor rating all four dimensions in one submission).
- Any **new column or data backfill**. The eligibility value is derived, not stored, and no
  existing rows are rewritten — the only schema change is the additive index above.
- Reworking the leaderboard, ranking, or the reversal paths.

## 2. Design

### 2.1 The gate mechanism (chosen: query-based rolling gate)

Inside `submit_condition` — which already holds the fountain row `FOR UPDATE`, serializing
all condition writes for a fountain (so a single user cannot race two submits past the
gate) — award eligibility is decided by a single bounded, indexed lookback **before**
recording the point event:

```
SELECT created_at
FROM contribution_events
WHERE user_id = :user
  AND fountain_id = :fountain
  AND event_type IN ('verify_working', 'report_condition')
  AND status = 'awarded'
ORDER BY created_at DESC
LIMIT 1
```

- If no row, or the row's `created_at` **≤ `report_time − 24h`** → **eligible**: emit the
  point event (`verify_working` **or** `report_condition` per the report status) with a
  per-report dedup key `cond_award:{report_id}` (guaranteed unique — the rolling query is
  the real limiter; the key only guards exact double-processing).
- Otherwise → **ineligible**: skip the point event entirely (award 0). The `ConditionReport`
  row is still inserted and `recompute_fountain_status` still runs.

**Authoritative clock (single anchor).** The gate compares stored
`contribution_events.created_at` values, so those values MUST be anchored on the same clock
the response reports. Today `record_contributions` lets `ContributionEvent.created_at` fall
to the DB `server_default` (`func.now()`), which is a *different* instant from the
`report_time` the spec and the `condition_points_eligible_at` response are expressed in.
To make one authoritative clock: extend `ContributionSpec` with an optional
`created_at: datetime | None` and have `record_contributions` set it on insert when present
(otherwise keep the server default — no behavior change for other callers). `submit_condition`
passes `report_time`, so the awarded condition event's `created_at`, the lookback boundary
(`report_time − 24h`), and the returned `report_time + 24h` are all the same instant. The
report row, the status recompute, and the award event therefore never straddle a boundary.

**Legacy rows need no backfill.** The lookback matches on `event_type IN
('verify_working','report_condition')` and `status='awarded'` — **not** on `dedup_key`. So
pre-existing calendar-day-keyed condition events (`verify:…`/`cond:…`) are read correctly by
the new query even after the old builders are removed; the migration-free rollout is sound
(covered by a regression test in §5).

**Rejected alternative — encode the window as a `dedup_key` bucket.** A *rolling* 24h
cannot be a static key without snapping to fixed buckets, which reintroduces exactly the
calendar-boundary loophole this change removes.

This replaces the current calendar-day dedup keys: the `dk_verify` and `dk_report_condition`
builders (and their `day` parameter) are **removed**, and a single new builder
`dk_condition_award(report_id)` replaces them.

### 2.2 Coalescing verify + report

Today `verify_working` and `report_condition` have **separate** dedup keys, so a user can
earn both (5 pts) in one calendar day. Under this design they share one window: whichever
condition report a user files first in a rolling-24h window earns points (3 or 2 by type);
any further condition report of **either** type within 24h earns 0. This matches the
issue's "at most one point-generating … update … within any 24-hour period."

### 2.3 Pre-submit eligibility signal (API)

Extend the existing per-viewer detail path (`serialize_fountain_detail`, where
`your_rating` is already computed for the authenticated caller). Add one nullable field to
`FountainDetail`:

- `condition_points_eligible_at: datetime | None`
  - **`null`** → the caller is eligible to earn condition points now (also `null` for
    anonymous callers, who never see the warning).
  - **a timestamp `T`** → the caller earned a condition point on this fountain within the
    last 24h and becomes eligible again at `T` (= most-recent awarded condition
    `created_at` + 24h).

Computed only when `user_id is not None`, from the same bounded lookback as §2.1 (latest
awarded condition `created_at`; `+ 24h` if it is within the window, else `null`).

**Index (the one migration).** This lookback now runs on **every authenticated fountain-detail
view**, and gamification deliberately cultivates high-volume contributors, so the existing
`(user_id, created_at)` index (no `fountain_id`) is not good enough — it would scan a prolific
user's events across all fountains. Add a partial composite index sized exactly to the query:

```
CREATE INDEX ix_contribution_events_condition_window
  ON contribution_events (user_id, fountain_id, created_at DESC)
  WHERE status = 'awarded' AND event_type IN ('verify_working', 'report_condition');
```

With `ORDER BY created_at DESC LIMIT 1`, the lookup is an index-only descend to the newest
matching row. This is an **additive** Alembic migration (drift-free, reversible) — no column,
no backfill.

No new endpoints. Both `GET /fountains/{id}` and the condition **POST** already return
`FountainDetail`, so the client receives a fresh signal on load and immediately after
submitting (so the warning appears the moment the user becomes ineligible).

### 2.4 Client warning UX (web + mobile)

The new field must be **plumbed through** to the condition form on each client — today both
forms receive only enough to submit, not the eligibility state:

- **Web:** `serialize`d detail → `ContributeSection` (currently passes only `fountainId` to
  `ConditionForm`) → `ConditionForm` (currently only takes `fountainId`). Thread
  `conditionPointsEligibleAt` down both hops.
- **Mobile:** `FountainDetail` in `mobile/app/fountains/[id].tsx` → `ConditionContributionForm`
  (currently only `fountainId` / `pending` / `onSubmit`). Add the eligibility prop.
- The regenerated api-client (in scope, §1) is what surfaces the field to both clients.

Behavior in each form:

- When `conditionPointsEligibleAt` is a **future** timestamp, render a non-blocking inline
  note near the submit control, e.g.:
  > "You've already earned points for updating this fountain recently. You can still update
  > its status — it just won't earn points until \<relative time\>."
- The submit control stays **enabled** (warn, don't block — the issue requires the update to
  be accepted). No warning when the field is `null`.
- Relative-time formatting reuses the existing web/mobile time helpers; the warning is a new
  UI element → documented in `docs/style-guide.md` as "Points-ineligible inline warning".

**Fix the existing point-feedback surfaces (do not leave them lying).** Both clients today
imply points were earned regardless of the server's decision, which this change would make
wrong:

- **Web** `ConditionForm` shows a *possible-points* preview
  (`web/components/fountain/ConditionForm.tsx` ~line 90). When ineligible, it must show that
  the update won't earn points (0 / suppressed), not the nominal 3/2.
- **Mobile** `mobile/app/fountains/[id].tsx` (~line 192) hard-codes the success-celebration
  points from the submitted *status*. When ineligible, it must **not** celebrate awarded
  points.

Both surfaces derive their "will this earn points?" answer from the **pre-submit**
eligibility (`null` → yes; future timestamp → no), which is exactly the gate the backend
applies — so the client message and the server award agree. Tests assert both the warning
and the suppressed/zero point-feedback on an ineligible submit (§5).

## 3. Data flow

1. Signed-in user opens a fountain detail → `serialize_fountain_detail` returns
   `condition_points_eligible_at` (null = eligible; future T = warn).
2. If a future T, the condition form shows the non-blocking warning.
3. User submits a condition report → `submit_condition` locks the fountain, inserts the
   `ConditionReport`, recomputes status, then runs the eligibility lookback and awards a
   point event only if eligible.
4. The POST returns the updated `FountainDetail`, now carrying an updated
   `condition_points_eligible_at` (set to `report_time + 24h` if this submit was awarded).

## 4. Edge cases & invariants

- **Data always persists.** The report row + status recompute never depend on point
  eligibility.
- **Concurrency.** The pre-existing `Fountain … FOR UPDATE` lock serializes condition
  writes per fountain, so a single user cannot double-award via a race; no new lock.
- **Reversal interplay.** If an awarded condition event is later reversed (e.g. fountain
  hard-delete → `reverse_contributions`), it drops out of the `status='awarded'` lookback,
  so the user correctly becomes eligible again. Consistent by construction.
- **Anonymous / unauthenticated.** `condition_points_eligible_at` is always `null`; no
  warning.
- **Clock source.** A single `report_time = datetime.now(tz=UTC)` per request anchors the
  report row, the awarded condition event's `created_at` (via the new `ContributionSpec.created_at`,
  §2.1), the lookback boundary, and the returned `+24h` — one instant, no cross-clock skew.
- **Legacy events.** Old calendar-day-keyed condition events are honored by the lookback
  (matched on `event_type`+`status`, not `dedup_key`); no backfill (§2.1).

## 5. Testing

Tests drive the clock by passing an explicit `created_at`/`report_time` (the new
`ContributionSpec.created_at` seam makes this deterministic — no wall-clock sleeps).

**Backend (`backend/tests`):**

- First condition report on a fountain awards points (verify → 3, report → 2).
- Repeat condition report within 24h: `ConditionReport` persists, status recomputes, **0
  points**, and `total_points` unchanged.
- **Boundary:** a prior award at **exactly** `report_time − 24h` is **eligible** (awards);
  at `report_time − 24h + 1s` (just under 24h) is **ineligible** (0). Pins the `≤` boundary.
- **Coalescing:** `verify_working` then `report_condition` within 24h → only the first
  awards; the second is 0.
- **Legacy rows:** a pre-existing calendar-day-keyed event (`verify:…`/`cond:…`, no
  `cond_award:` key) within 24h correctly blocks a new award — proves the lookback reads old
  rows and the migration-free rollout holds.
- `condition_points_eligible_at` is `null` before any award, the awarding event's
  `created_at + 24h` within the window, and `null` again after it lapses.
- Regression: `rate`, `observe_attribute`, `add_note`, `add_fountain`, and the `first_*`
  bonuses are unaffected (a fresh rating of all dimensions still awards fully).
- (If feasible without brittle timing) two concurrent condition submits by one user on one
  fountain award **once**, confirming the `FOR UPDATE` serialization.

**Web / mobile:**

- The warning renders **iff** `conditionPointsEligibleAt` is in the future; submit stays
  enabled in both states.
- On an ineligible submit the point-feedback surface shows **no** awarded-points
  celebration/preview (web possible-points preview suppressed; mobile success celebration
  shows no points) — guards the §2.4 fix.

## 6. Rollout

- **One additive index migration** (`ix_contribution_events_condition_window`, §2.3) —
  drift-free (`alembic check`) and reversible. No new column, no data backfill; older clients
  ignore the new nullable response field.
- **Regenerate the OpenAPI + api-client artifacts** (`packages/api-client/openapi.json`,
  `packages/api-client/src/schema.d.ts`) so the typed clients see `condition_points_eligible_at`.
- Behavior change is a **tightening** of point awards for repeat condition reports only; no
  user loses previously banked points, and pre-existing condition events are honored by the
  new gate without backfill.
