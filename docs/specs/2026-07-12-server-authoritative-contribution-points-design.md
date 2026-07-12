# Server-Authoritative Contribution Points — Design

**Date:** 2026-07-12
**Issue:** #204 (and the four sibling bugs it exposed)
**Status:** Design

## 1. Problem

Every contribution write on both clients plays a water-celebration animation and, where it
thinks it knows the number, a "+N points" burst. **Neither the animation nor the number is
tied to what the server actually awarded.**

The reported symptom (#204):

> I can continue to click update rating, and just keep accumulating points. This needs to be
> stopped. People will game the system.

The points are **not** actually being gamed. The backend deduplicates rating awards on a
permanent key — `dk_rate(user_id, fountain_id, rating_type_id)`
(`backend/app/contributions.py:124`) — inserted with `on_conflict_do_nothing` against
`uq_contribution_events_dedup_key` (`models.py:478`), and `user_contribution_stats` is
incremented **only from rows actually inserted** (`contributions.py:224-239`).
`test_contribution_emission.py:92-97` already asserts a re-rate awards nothing. The user's
real total never moved.

What the user actually saw is a **client-side lie**: the API returns no "points awarded"
for a rating, so `RatingForm.tsx:50` does

```ts
dispatchContribution(chosen.length * CONTRIBUTION_POINTS.rate);
```

— it *assumes* full credit. Mobile does the same (`mobile/app/fountains/[id].tsx:331`).
Every re-rate pops a fresh "+4 points" celebration for an award of **0**.

### 1.1 This is a bug class, not one bug

Five paths can award 0 points and still celebrate. The animation fires on **any** success
(`WaterCelebration` renders whenever `triggerKey` changes); the point value only decides
whether a number is drawn on top of it.

| Path | Awards 0 when | Server tells the client? |
|---|---|---|
| Rating | re-rating a dimension you already rated | ❌ client guesses `n × 2` |
| Attributes | re-observing an attribute you already observed | ❌ client guesses `n × 2` |
| Note | your 2nd note on that fountain (`dk_note` is once-ever per user+fountain) | ❌ client hardcodes `+2` |
| Photo | not the first photo on the fountain (`photo_first` is the only photo award) | ❌ celebrates with no number |
| Condition | within 24h of your last award (#124) | ✅ `condition_points_awarded` — **but still animates on 0** |

Even the one path that reports the truth still plays the celebration:
`ConditionForm.tsx:62` calls `dispatchContribution(earned)` with `earned === 0`, and the
overlay bumps `celebrationKey` unconditionally.

### 1.2 Root cause

Two things, and the second is why the bug class exists at all:

1. **The award is not observable.** `record_contributions` returns `list[uuid.UUID]` — ids
   only (`contributions.py:179-246`). You cannot derive points from ids, because a batch
   mixes event types (a rating batch can contain `rate`@2 **and** `first_rating_bonus`@5).
   So "what did this write actually award?" is literally unanswerable today, and the API
   has nothing truthful to return.

2. **The celebration's contract makes lying easy.** `dispatchContribution(points?: number)`
   (`web/lib/contribution-event.ts:9`) takes points as **optional**, and documents
   `undefined` as "celebrate without a number" — which is exactly how a 0-point 2nd photo
   upload celebrates today (`PhotoUpload.tsx:42`). Any call site can fire the animation
   without knowing the truth, and five of them do.

Fixing ratings alone leaves the escape hatch open and the other four bugs live.

## 2. Goals

- The celebration fires **if and only if** the server actually awarded points, everywhere.
- When a contribution saves but earns nothing, the user gets a clear, neutral confirmation
  that says **why** — no animation, no number.
- The user knows **before** submitting that a contribution won't earn points.
- It is not *possible* to add a future contribution path that celebrates nothing.

## 3. Non-goals

- Changing the points economy or any award rule. `POINTS`, every `dk_*` key, and the #124
  24h condition window are untouched. This changes **reporting**, not awarding.
- Blocking 0-point submits. Correcting a rating you got wrong is a thing we *want*; it
  simply must not be dressed up as a reward.
- Retiring the deprecated `condition_points_awarded` field in this change (see §4.2).
- Rating removal / moderation of awards (that is #216).

## 4. Design

### 4.1 Make the award observable at the chokepoint

`record_contributions` is the single writer for every point-worthy event. It gains a return
type that carries the number:

```python
@dataclass(frozen=True)
class ContributionResult:
    event_ids: list[uuid.UUID]
    points_awarded: int  # sum of points over rows ACTUALLY inserted (deduped rows contribute 0)
```

`points_awarded` is summed from the `RETURNING` rows of the `ON CONFLICT DO NOTHING` insert
— the same rows that already drive the `user_contribution_stats` increment — so **the number
reported to the user and the number added to their total come from one source and cannot
diverge.** That property is the whole point of the change.

All six call sites update. Callers that only used truthiness (e.g. the note handler's
`"inserted" if inserted else "deduped"` log at `fountains.py:1185`) read `.event_ids`.

### 4.2 API: one additive, nullable field per write response

Follows the established #124 pattern exactly (additive + nullable → no response-shape break):

| Response model | New field | Set on | `null` on |
|---|---|---|---|
| `FountainDetail` | `points_awarded: int \| None` | rating, attribute, condition, **add-fountain** POSTs | GET and every other response |
| `PhotoOut` | `points_awarded: int \| None` | photo upload | photo list |
| `NoteOut` | `points_awarded: int \| None` | note create | note list |

`serialize_fountain_detail` already takes a `condition_points_awarded` parameter
(`fountains.py:283`); it gains a general `points_awarded` parameter alongside it.

Add-fountain gets this for free and closes an existing gap:
`web/components/map/useAddFountainMode.tsx:183` currently carries the comment
*"add-fountain awarded points aren't returned to the client (#2)"*. It can now show the real
number (which includes the conditional `first_fountain_bonus` / `first_in_area_bonus`).

**`condition_points_awarded` stays populated and is marked deprecated.** Mobile clients
already released to the App Store / Play read it; removing it would break them. Same
reasoning as the legacy photo-report routes kept in #197. Both fields are set on the
condition POST. It is removed in a later change, after a store release cycle has landed.

### 4.3 API: pre-submit truth

The forms currently show "+4 possible points" right up until you tap, even when the award
will be 0. Three of the five paths already have what they need on the client:

| Path | Pre-submit source | New field? |
|---|---|---|
| Rating | `DimensionSummary.your_rating` — already returned (#65) | no |
| Photo | the photos list the detail view already fetches (`photo_first` is per-fountain) | no |
| Condition | `condition_points_eligible_at` — already returned (#124) | no |
| Attribute | **`AttributeConsensusOut.your_observation: str \| None`** | yes |
| Note | **`FountainDetail.viewer_has_note: bool`** | yes |

**No database migration is required.** Both new fields are derived from existing indexed
lookups: `uq_attribute_observations_fountain_id` on
`(fountain_id, user_id, attribute_type_id)` (`models.py:393-398`) and
`uq_fountain_notes_fountain_id` on `(fountain_id, user_id)` (`models.py:612`).
`serialize_fountain_detail` already runs an analogous viewer-scoped query for `your_stars`
(`fountains.py:287-291`); these follow the same shape and are only issued when
authenticated (anonymous → `None` / `false`).

### 4.4 Close the escape hatch at the type level

```ts
// web/lib/contribution-event.ts
export function dispatchContribution(points: number): void   // was: points?: number
```

`points` becomes **required**, and `ContributionStatusOverlay` only bumps `celebrationKey`
when `points > 0`. TypeScript then forces all seven web call sites to supply the server's
number — **there is no longer any way to fire the celebration without a real award.** Mobile
mirrors it: `refreshDetailAfterWrite(detail, points)` stops multiplying
`CONTRIBUTION_POINTS.*` and reads the server's `points_awarded`, with the same `> 0` gate on
`celebrationKey`.

This is what makes the fix durable instead of whack-a-mole: a future contribution type
*cannot* celebrate nothing, because the compiler will not let it omit the number.

### 4.5 Null is treated as zero

If `points_awarded` comes back `null` or absent (a new client against an older server), the
client suppresses the celebration and shows a plain "Saved." The safe default is **never
celebrate what you cannot verify.** This also means the mobile rollout is safe in either
order: an old app against the new server keeps its current (wrong) behavior, and a new app
against the old server is merely conservative.

### 4.6 Shared point math

The earnable-points helpers live in `packages/contributions` — already the home of
`ratingPointsPreview`, `conditionPointsBlocked`, `notePointsPreview` — so web and mobile
cannot drift:

- `ratingEarnablePoints(dimensions, chosenStars)` — counts only dimensions with
  `your_rating == null`
- `attributeEarnablePoints(attributes, chosenObservations)` — counts only attributes with
  `your_observation == null`
- `notePointsPreview(viewerHasNote)` — 0 when the viewer already has a note
- `photoEarnablePoints(existingPhotoCount)` — `photo_first` only when the count is 0

Each form renders `PointsPreview` when earnable > 0, and the amber "won't earn points"
warning — the pattern `ConditionForm.tsx:119-124` already uses — when it is 0.

Note the previews deliberately stay conservative about conditional bonuses
(`first_rating_bonus`, `first_fountain_bonus`, `first_in_area_bonus`): under-promising and
then awarding more is a pleasant surprise, whereas over-promising is the bug we are fixing.

### 4.7 Copy at 0 points

Neutral, no animation, no number, and it states the reason:

| Path | Copy |
|---|---|
| Rating | "Rating updated. You already earned points for these dimensions, so no points this time." |
| Attributes | "Details saved. You already earned points for these, so no points this time." |
| Note | "Comment saved. You already earned points for a comment on this fountain." |
| Photo | "Photo added. Points are only awarded for a fountain's first photo." |
| Condition | existing #124 copy, now with the animation suppressed |

Partial awards are unambiguous: rate three dimensions where one is new, the server awards 2,
and the celebration shows `+2`.

## 5. Logging

Per the Logging & Observability standard, each write path logs the awarded outcome at INFO
with the fountain/user/event context and `points_awarded=<n>`, so a "why did I not get
points" report is diagnosable from logs alone. The condition path already does this
(`fountains.py:1113-1122`); the rating, attribute, note, photo, and add-fountain paths gain
the same line. No PII, no tokens, no raw note bodies.

## 6. Testing

**Backend**
- `record_contributions` returns `points_awarded` correctly on insert, on full dedup (0), and
  on a **mixed batch** (some inserted, some deduped) — the case where summing by id count
  would silently be wrong.
- Per-route: `points_awarded` is 4 on a first rating of two dimensions and **0** on the
  re-rate; 0 on re-observed attributes; 0 on a 2nd note; 0 on a 2nd photo; 0 on a condition
  inside the 24h window; and the partial case (one new dimension among already-rated ones →
  exactly the new dimension's points).
- The new viewer fields (`your_observation`, `viewer_has_note`) are `None`/`false` for
  anonymous callers and correct for the owner.
- Existing `test_contribution_emission.py` assertions must keep passing unchanged — the
  award rules are not moving.

**packages/contributions**
- Unit tests for each earnable helper, including the all-already-earned → 0 case.

**Web**
- Extend `ContributionStatusOverlay.test.tsx` (it already covers `dispatchContribution(6)`
  and the bare `dispatchContribution()`) to assert **no celebration is rendered at 0**.
- `RatingForm` renders the "won't earn points" warning instead of `PointsPreview` when every
  chosen dimension is already rated, and renders the 0-point confirmation copy after a
  0-point submit.

**Mobile**
- The same two assertions against `WaterCelebration` / the detail screen's celebration gate.

## 7. Rollout

1. Backend + web ship together in one PR (the API fields are additive, so the old web build
   keeps working against the new backend during the deploy window).
2. Mobile ships in the same PR and goes out via `mobile-store-release.yml`. Older installed
   apps continue to read `condition_points_awarded` and keep their current behavior until
   users update — no break (§4.2, §4.5).
3. `condition_points_awarded` is removed in a later change, once the store release has
   propagated.

## 8. Related

- #204 — the reported bug (re-scoped: client display, not a ledger exploit)
- #124 — the repeat-contribution point limit that established the
  `condition_points_awarded` / `condition_points_eligible_at` pattern this generalizes
- #212 / #213 / #215 — the loading-and-feedback family; this is the *correctness* half of
  the same "tell the user the truth about what just happened" theme
- `docs/specs/2026-06-16-architecture-and-foundation-design.md` §8 — the contributions model
