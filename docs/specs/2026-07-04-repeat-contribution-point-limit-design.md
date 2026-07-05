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
- Web + mobile **non-blocking warning** in the condition-report UI.
- Backend + client tests.

**Out of scope (explicitly):**

- Changing `rate`, `observe_attribute`, `add_note`, or any `first_*`/`add_fountain` award
  behavior — they are already one-and-done and are **not** made ineligible by this limit
  (satisfies the issue's "new fountain / new information not affected" criterion).
- A coarse "one point per fountain per 24h across *all* action types" cap. Rejected in
  brainstorming: it would reduce points for legitimate first-time thorough contributions
  (e.g. a new visitor rating all four dimensions in one submission).
- Any schema/migration change (the new field is derived; no new column).
- Reworking the leaderboard, ranking, or the reversal paths.

## 2. Design

### 2.1 The gate mechanism (chosen: query-based rolling gate)

Inside `submit_condition` — which already holds the fountain row `FOR UPDATE`, serializing
all condition writes for a fountain (so a single user cannot race two submits past the
gate) — award eligibility is decided by a single indexed lookback **before** recording the
point event:

```
SELECT max(created_at)
FROM contribution_events
WHERE user_id = :user
  AND fountain_id = :fountain
  AND event_type IN ('verify_working', 'report_condition')
  AND status = 'awarded'
```

- If the result is `NULL` **or** `<= report_time - interval '24 hours'` → **eligible**:
  emit the point event (`verify_working` **or** `report_condition` per the report status)
  with a per-report dedup key `cond_award:{report_id}` (guaranteed unique — the rolling
  query is the real limiter; the key only guards exact double-processing).
- Otherwise → **ineligible**: skip the point event entirely (award 0). The
  `ConditionReport` row is still inserted and `recompute_fountain_status` still runs.

The lookback is served by the existing `ix_contribution_events_user_id` index on
`(user_id, created_at)` (with `fountain_id`/`event_type`/`status` as residual predicates;
a single user's condition-event volume is small).

**Rejected alternative — encode the window as a `dedup_key` bucket.** A *rolling* 24h
cannot be a static key without snapping to fixed buckets, which reintroduces exactly the
calendar-boundary loophole this change removes.

This replaces the current calendar-day dedup keys: the `dk_verify` and
`dk_report_condition` builders (and their `day` parameter) are **removed**, and a single
new builder `dk_condition_award(report_id)` replaces them. `report_time` remains the one
captured timestamp driving the row `created_at`, the status recompute, and the eligibility
comparison, so nothing straddles a boundary.

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

Computed only when `user_id is not None`, from the same lookback query as §2.1 (`max
created_at` of awarded condition events; `+ 24h` if within window, else `null`).

No new endpoints. Both `GET /fountains/{id}` and the condition **POST** already return
`FountainDetail`, so the client receives a fresh signal on load and immediately after
submitting (so the warning appears the moment the user becomes ineligible).

### 2.4 Client warning UX (web + mobile)

`web/components/fountain/ConditionForm.tsx` and
`mobile/components/fountain/ConditionContributionForm.tsx`:

- When `condition_points_eligible_at` is a **future** timestamp, render a non-blocking
  inline note near the submit control, e.g.:
  > "You've already earned points for updating this fountain recently. You can still update
  > its status — it just won't earn points until \<relative time\>."
- The submit control stays **enabled** (warn, don't block — the issue requires the update
  to be accepted). No warning when the field is `null`.
- Relative-time formatting reuses the existing web/mobile time helpers; the warning is a
  new UI element → documented in `docs/style-guide.md` as "Points-ineligible inline warning".

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
- **Clock source.** Single `report_time = datetime.now(tz=UTC)` per request, as today.

## 5. Testing

**Backend (`backend/tests`):**

- First condition report on a fountain awards points (verify → 3, report → 2).
- Repeat condition report within 24h: `ConditionReport` persists, status recomputes, **0
  points**, and `total_points` unchanged.
- Condition report after the 24h window awards again.
- **Coalescing:** `verify_working` then `report_condition` within 24h → only the first
  awards; the second is 0.
- `condition_points_eligible_at` is `null` before any award, a future timestamp within the
  window, and `null` again after it lapses.
- Regression: `rate`, `observe_attribute`, `add_note`, `add_fountain`, and the `first_*`
  bonuses are unaffected (a fresh rating of all dimensions still awards fully).

**Web / mobile:**

- The warning renders **iff** `condition_points_eligible_at` is in the future; submit stays
  enabled in both states.

## 6. Rollout

- No migration. New response field is additive and nullable; older clients ignore it.
- Behavior change is a **tightening** of point awards for repeat condition reports only;
  no user loses previously banked points.
