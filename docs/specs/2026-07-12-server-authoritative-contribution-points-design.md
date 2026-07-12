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
   upload celebrates today (`PhotoUpload.tsx:42`). Any call site can fire the animation with a
   number it invented, and five of them do. Nothing in the type system distinguishes "the
   server awarded this" from "the client multiplied a constant."

Fixing ratings alone leaves the escape hatch open and the other four bugs live.

## 2. Goals

- The celebration fires **if and only if** the server actually awarded points, everywhere.
- When a contribution saves but earns nothing, the user gets a clear, neutral confirmation
  that says **why** — no animation, no number.
- The user knows **before** submitting that a contribution won't earn points. The pre-submit
  hint is computed from **the same source** as the award (§4.3) — but it is a hint, and the
  post-submit number is authoritative and always wins (§4.3.1).
- A future contribution path cannot celebrate a client-invented number: the brand blocks a raw
  `number`; on web `server-only` keeps the minting function out of the client bundle, and on mobile
  the minter accepts only a generated API response type, so a forged award will not typecheck (§4.4).
- The fountain-detail endpoint stops being shared-cacheable, closing a pre-existing
  viewer-data leak (§4.3.2).

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
type that carries the number **per user**:

```python
@dataclass(frozen=True)
class ContributionResult:
    event_ids: list[uuid.UUID]
    points_by_user: dict[uuid.UUID, int]  # summed from rows ACTUALLY inserted

    def points_for(self, user_id: uuid.UUID) -> int:
        return self.points_by_user.get(user_id, 0)

    def __bool__(self) -> bool:
        # Mirrors the old list-return truthiness so any missed `if inserted:` call site
        # keeps its original meaning instead of silently becoming always-true.
        return bool(self.event_ids)
```

**Per-user, not a scalar total.** `record_contributions` explicitly supports batches spanning
multiple users (`contributions.py:224-239` aggregates increments per user). A scalar total
would be the sum across *all* users in the batch — correct for the ledger, but wrong the
moment a bulk/import/moderation path reuses the chokepoint and a route hands that number to
one viewer. Routes always call `result.points_for(user.id)`, so a request can only ever
report the points credited to *that* request's actor.

`points_by_user` is summed from the `RETURNING` rows of the `ON CONFLICT DO NOTHING` insert —
**the same rows that already drive the `user_contribution_stats` increment**. So the number
reported to the user and the number added to their total are computed from one set of rows in
one transaction and cannot diverge. That property is the whole point of the change.

**Truthiness trap.** A dataclass is truthy by default, so a missed `if inserted:` conversion
would silently become always-true — e.g. the condition path's
`points_awarded = points_for(event_type) if inserted else 0` (`fountains.py:1106-1107`) and
the note handler's `"inserted" if inserted else "deduped"` log (`fountains.py:1185`). Defining
`__bool__` as `bool(event_ids)` makes any missed site behave exactly as before. Every caller
**and every test** that treats the return value as a list must still be converted explicitly
to `.event_ids` / `.points_for(...)`; `__bool__` is a safety net, not a licence to skip them.

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

**`points_awarded` is canonical; `condition_points_awarded` stays populated and is marked
deprecated.** Mobile clients already released to the App Store / Play read the legacy field;
removing it would break them. Same reasoning as the legacy photo-report routes kept in #197.
Both fields are set on the condition POST. New client code and new tests must treat
`points_awarded` as the primary path and use `condition_points_awarded` only as an absent-field
fallback (§4.5) — otherwise condition stays a special case forever. It is removed in a later
change, after a store release cycle has landed.

### 4.3 API: pre-submit truth — derived from the dedup ledger, never from content

The forms currently show "+4 possible points" right up until you tap, even when the award will
be 0. The fix is to tell the client what is earnable — but **earnability must be derived from
`contribution_events.dedup_key`, not from the content rows**, because the dedup ledger *is* the
award rule and content rows drift away from it:

- **Hidden content still holds its award.** `dk_note(user, fountain)` and
  `dk_observe_attr(user, fountain, attr)` are permanent. Moderation sets `is_hidden` on the
  note/observation row but never removes the dedup event (the note upsert deliberately leaves
  moderation fields untouched, `fountains.py:1149-1151`). A viewer whose note was hidden would
  be told "earn +2" and then awarded 0.
- **Deleted photos still hold the fountain's `photo_first`.** `dk_photo_first(fountain_id)` is
  per-fountain and permanent; self-delete reverses the contribution but leaves the dedup row.
  Once the first photo is hidden or deleted, the visible photo list reads `0` and would promise
  `photo_first` — but the insert dedups and awards 0.
- **`your_rating` is a proxy, not the rule.** (`Rating` itself has no `is_hidden` — only
  `Fountain`, `AttributeObservation`, `ConditionReport`, `FountainNote` and `FountainPhoto` do.
  But it remains a *derived* signal: it answers "did you rate?", not "were you awarded?", and
  any future moderation/reversal semantics would separate the two.) Reading the ledger keeps
  all five paths on one rule instead of four rules and an exception.

Deriving from the ledger removes the entire class: the client is asked the same question the
insert asks. It also removes the *split* strategy (some paths client-derived, some
server-derived) that could let client and server disagree.

`FountainDetail` gains one viewer-scoped object, `null` for anonymous callers:

```python
class ViewerAwardState(BaseModel):
    """What this viewer can still EARN on this fountain, per the contribution dedup ledger.
    Null for anonymous callers. The AWARD state, not the content state.

    An as-of-read HINT (§4.3.1) — the insert stays authoritative."""
    unrated_rating_type_ids: list[int]        # dims with no `rate:{u}:{f}:{rid}` event
    unobserved_attribute_type_ids: list[int]  # attrs with no `attr:{u}:{f}:{aid}` event
    note_earnable: bool                       # no `note:{u}:{f}` event
    photo_first_earnable: bool                # no `photo_first:{f}` event (fountain-wide)
```

**`condition_points_eligible_at` stays exactly where it is** — top-level on `FountainDetail`,
unchanged. Released web and mobile clients read the top-level field, so moving it into
`ViewerAwardState` would be a breaking change, and duplicating it into both would create two
sources of the same truth. Condition keeps its existing #124 mechanism untouched; this object
covers the four paths that have none.

**The candidate keys come from the type registries, not from the response's content lists.**
Build them from:

- **all fountain-scoped rating types** — `RatingType` where `place_type == 'fountain'`. (Note
  `RatingType` has **no** `is_active` flag — only `place_type` and `sort_order`, `models.py:83-94`
  — so do not try to filter on one.)
- **all active fountain-scoped attribute types** — `AttributeType` where `is_active` and
  `place_type == 'fountain'`.

*Not* from the `dimensions` / `attributes` arrays in the detail response. A user can observe an
attribute that has no consensus row yet, so an attribute type absent from `attributes` is still
earnable and must appear in `unobserved_attribute_type_ids`. Computing the candidates from the
response's own lists would silently drop exactly the attributes the user has never touched — the
ones most likely to be earnable.

**One indexed query** for the existence check — candidates are
`rate:{u}:{f}:{rid}` per rating type, `attr:{u}:{f}:{aid}` per attribute type, plus
`note:{u}:{f}` and `photo_first:{f}`:

```sql
SELECT dedup_key FROM contribution_events WHERE dedup_key = ANY(:candidate_keys)
```

`uq_contribution_events_dedup_key` (`models.py:478`) makes this a single index scan. Anything
returned is already awarded; anything absent is earnable.

**The conditional bonuses are deliberately excluded** from `ViewerAwardState`
(`first_rating_bonus`, `first_fountain_bonus`, `first_in_area_bonus`). They are omitted from the
previews today, and keeping them out means the preview can only ever *under*-promise, never
over-promise. Under-promising resolves as a pleasant surprise in the (authoritative) post-submit
number; over-promising is the bug being fixed.

### 4.3.1 `ViewerAwardState` is an as-of-read hint; the insert is authoritative

It is a hint computed from the same source as the award — **not** a guarantee that it will agree
with the later insert. Between the `GET` and the submit, the key can be spent:

- another user uploads the fountain's first photo, spending `photo_first:{f}`;
- the same user submits from another tab/device, spending `rate:` / `attr:` / `note:`;
- (condition eligibility can likewise cross its 24h boundary).

That is fine and by design: **the post-submit `points_awarded` always wins.** A stale hint that
promised points and an insert that awards 0 resolves to *no celebration* and the 0-point copy —
which is strictly the behavior we want, and is exactly the case the current code gets wrong.
Tested explicitly (§6).

**No database migration is required** — `ViewerAwardState` is a Pydantic response model built
from existing tables and the existing unique index. But **the OpenAPI schema and the generated
TypeScript client MUST be regenerated** (`packages/api-client/openapi.json` +
`src/schema.d.ts` are git-tracked, not generated-and-ignored) so web and mobile can type
`points_awarded` and `viewer_award_state`.

### 4.3.2 The detail endpoint must stop being shared-cacheable

`GET /api/v1/fountains/{id}` (`fountains.py:661`) sets **no cache headers at all**, yet it
already returns viewer-scoped data — `your_rating` (#65) and `condition_points_eligible_at`
(#124). A shared CDN/proxy/API cache that stores one authenticated viewer's response can serve
it to a different viewer or to an anonymous caller. **This is a pre-existing data leak, not one
introduced here** — but this change widens it (`ViewerAwardState`), so it is fixed as part of
this work rather than deferred.

The endpoint adopts the precedent already set by `list_photos`
(`photos.py:75-80`, `Cache-Control: private, no-store`, with a comment explaining exactly this
hazard). Tests assert the header on both the authenticated and anonymous paths.

### 4.4 Close the escape hatch: a branded type minted in exactly one place

Making `points` a required param is **not** a guarantee — a call site could still pass
`chosen.length * CONTRIBUTION_POINTS.rate` and satisfy the compiler. So the celebration takes a
branded value:

```ts
// web/lib/contribution-event.ts
declare const AWARDED: unique symbol;
/** Points the SERVER said it awarded. Only the response-parsing layer can mint one. */
export type AwardedPoints = number & { readonly [AWARDED]: true };

export function dispatchContribution(points: AwardedPoints): void   // was: points?: number
```

`dispatchContribution(chosen.length * CONTRIBUTION_POINTS.rate)` is now a **type error** — a
plain `number` is not an `AwardedPoints`.

**Be precise about what the brand does and does not buy.** A TypeScript brand gates
*assignment*, not *provenance*. A structural minting function would still be forgeable with no
cast at all:

```ts
// Would compile. Must not be possible.
dispatchContribution(awardedPoints({ points_awarded: chosen.length * CONTRIBUTION_POINTS.rate }));
```

So the brand is paired with a **locality** rule that closes that hole. The two platforms need
different enforcement, because their parsing boundaries differ:

1. **Web — one server-only module.** `awardedPoints()` lives in **`web/app/actions/awarded.ts`**
   behind `import "server-only"`, and is imported by both `contribute.ts` and `add-fountain.ts`
   (both parse raw write responses, so a single implementation keeps the legacy-fallback logic from
   drifting). `server-only` is a real build-time barrier: importing it from a client component
   fails the build. The actions **return** `AwardedPoints` in their result types (§4.4.1), so
   components receive an already-minted value and have no constructor to forge with.

2. **Mobile — a restricted argument type, NOT a lint rule.** Mobile has no server-action layer: its
   mutation layer *is* `app/fountains/[id].tsx` and `app/(tabs)/index.tsx`, the two large route
   components that contain the current bug. Any `no-restricted-imports` rule would have to exempt
   exactly those files, so a future `awardedPoints({ points_awarded: totalPreviewPoints(...) })`
   inside one of them would lint clean. A rule with those exemptions is **worse than none** — it
   looks like a guard and guards nothing.

   The barrier is the **argument type** instead. `awardedPoints()` (in `mobile/lib/awarded-points.ts`)
   accepts only the *generated API response union* — `FountainDetail | NoteOut | PhotoOut` from
   `@fountainrank/api-client`. An ad-hoc `{ points_awarded: myGuess }` literal does not typecheck
   against it, because those types carry many required fields.

   TypeScript is **structural**, so this is a *high-friction* barrier, not a nominal one: someone
   holding a real `detail` could still write `awardedPoints({ ...detail, points_awarded: guess })`.
   A `@ts-expect-error` unit test pins the barrier in place — if the parameter is ever loosened back
   to a structural shape, that test fails.

The asymmetry is deliberate: use the strongest mechanism each platform actually supports
(`server-only` on web; a restricted, generated-response argument type on mobile) rather than a
uniform-but-weaker one — and do not ship an enforcement mechanism that cannot enforce.

**The honest claim:** the brand makes it impossible to pass a bare `number` to the celebration.
The *minter's* input type then makes it impractical to manufacture a branded one — on web the
minter is unreachable from client code at all (`server-only`), and on mobile it accepts only a
generated API response, so a client-computed number cannot be handed to it without constructing an
entire `FountainDetail`. Neither half is sufficient alone: the brand cannot prove provenance, and a
restricted minter would not stop a raw `number` being passed. Together they close the hatch by
construction rather than by discipline.

What this is **not**: a security boundary. A determined author can always add a cast. The goal is
to make the *accidental* re-introduction of client-guessed points — the thing that actually
happened here, five times — impossible to do without writing something obviously wrong.

`ContributionStatusOverlay` then gates on `points > 0`, so a verified award of 0 renders no
celebration. Mobile mirrors both halves: the same branded type from the shared package, and the
same `> 0` gate on `celebrationKey`.

### 4.4.1 The web server-action layer is part of the contract

The web forms never see the backend response directly; they go through
`web/app/actions/contribute.ts`. Today `readPointsAwarded` there reads **only**
`condition_points_awarded`, `uploadPhoto` does not parse the success body at all, and
add-fountain returns just `{ ok, fountainId }`. So the backend could be perfectly correct and
web would still fabricate or suppress awards.

Every action result type therefore carries the award: `submitRating`, `submitAttributes`,
`submitNote`, `uploadPhoto`, `submitCondition`, and `addFountain` all return
`{ ok: true; pointsAwarded: AwardedPoints }` (minted via `awardedPoints()` at the single point
where the response is parsed), and are tested for it.

### 4.5 Null is treated as zero — and condition falls back during transition

If `points_awarded` is `null` or absent, `awardedPoints()` yields 0, so the client suppresses
the celebration and shows a plain "Saved." **Never celebrate what you cannot verify.**

Rollout orderings, all safe:
- *Old app → new server:* keeps reading `condition_points_awarded` (still populated) and its
  current behavior; no break.
- *New app → old server:* `points_awarded` is absent → 0 → no celebration. Conservative, and
  strictly better than today's false celebration.
- *Condition, during transition:* new clients read the canonical `points_awarded` **first** and
  fall back to the legacy `condition_points_awarded` only when it is absent. `points_awarded` is
  the canonical field from here on; `condition_points_awarded` is deprecated compatibility only
  and must not be the primary path in new code or new tests.

### 4.6 Shared point math

The earnable-points helpers live in `packages/contributions` — already the home of
`ratingPointsPreview`, `conditionPointsBlocked`, `notePointsPreview` — so web and mobile cannot
drift. Each takes `ViewerAwardState` (the ledger truth) rather than content rows:

- `ratingEarnablePoints(viewerAwardState, chosenRatingTypeIds)` — counts only ids in
  `unrated_rating_type_ids`
- `attributeEarnablePoints(viewerAwardState, chosenAttributeTypeIds)` — counts only ids in
  `unobserved_attribute_type_ids`
- `notePointsPreview(viewerAwardState)` — 0 unless `note_earnable`
- `photoEarnablePoints(viewerAwardState)` — `photo_first` only when `photo_first_earnable`
- `conditionPointsBlocked(...)` — unchanged (#124)

When the viewer is anonymous (`viewer_award_state === null`) the previews show the full
possible award, as they do today — an anonymous user has earned nothing yet, and the sign-in
gate is a separate concern.

Each form renders `PointsPreview` when earnable > 0, and the amber "won't earn points" warning
— the pattern `ConditionForm.tsx:119-124` already uses — when it is 0.

The previews deliberately stay conservative about the conditional bonuses
(`first_rating_bonus`, `first_fountain_bonus`, `first_in_area_bonus`): under-promising and then
awarding more is a pleasant surprise, whereas over-promising is the bug being fixed.

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
- `record_contributions` reports the award correctly on insert, on full dedup (0), and on a
  **mixed batch** (some inserted, some deduped) — the case where summing by id count would
  silently be wrong.
- **Multi-user batch:** `points_for(user_id)` returns only that user's points, never the batch
  total. This is the invariant that stops a future bulk path leaking another user's award.
- **Truthiness:** a `ContributionResult` with no inserted events is falsy (guards the
  `if inserted:` sites).
- Per-route `points_awarded`: 4 on a first rating of two dimensions and **0** on the re-rate;
  0 on re-observed attributes; 0 on a 2nd note; 0 on a 2nd photo; 0 on a condition inside the
  24h window; and the partial case (one new dimension among already-rated ones → exactly the
  new dimension's points).
- **`ViewerAwardState` reflects the ledger, not the content** — the regression tests for the
  bugs §4.3 identifies:
  - a **hidden** own note → `note_earnable == false` (the dedup key survives moderation)
  - a **hidden** own attribute observation → its id is NOT in `unobserved_attribute_type_ids`
  - a **deleted/hidden** first photo → `photo_first_earnable == false` (the fountain's
    `photo_first` key is spent, even with zero visible photos)
  - each of the above then actually awards 0 on submit — i.e. the preview and the insert agree
- `viewer_award_state` is `None` for anonymous callers and correct for the owner.
- **`unobserved_attribute_type_ids` includes attribute types with no consensus row yet** — the
  regression test for computing candidates from the response's `attributes` list instead of the
  attribute-type registry (§4.3).
- **Stale hint loses to the insert (§4.3.1):** a submit whose `ViewerAwardState` promised points
  but whose insert dedups awards 0 → response says 0 → no celebration, 0-point copy. This is the
  TOCTOU case (another tab/device, or another user spending `photo_first`).
- **`condition_points_eligible_at` remains top-level** on `FountainDetail` and is NOT moved into
  `viewer_award_state` (released clients read it there).
- **Cache headers:** `GET /fountains/{id}` returns `Cache-Control: private, no-store` on both
  the authenticated and anonymous paths (§4.3.2).
- Existing `test_contribution_emission.py` assertions must keep passing unchanged — the award
  rules are not moving.

**packages/contributions**
- Unit tests for each earnable helper against a `ViewerAwardState`, including the
  all-already-earned → 0 case and the anonymous (`null`) case.

**Web**
- Extend `ContributionStatusOverlay.test.tsx` (it already covers `dispatchContribution(6)` and
  the bare `dispatchContribution()`) to assert **no celebration is rendered at 0**.
- Each server action in `contribute.ts` returns `pointsAwarded` parsed from the response
  (including `uploadPhoto` and `addFountain`, which parse no award today), and treats an absent
  field as 0.
- **The minting site is locked down:** `awardedPoints` lives behind `import "server-only"` and is
  unreachable from a client component (a client-side import is a build error).
- `RatingForm` renders the "won't earn points" warning instead of `PointsPreview` when every
  chosen dimension is already awarded, and renders the 0-point confirmation copy after a
  0-point submit.

**Mobile**
- The same assertions against `WaterCelebration` / the detail screen's celebration gate.

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
