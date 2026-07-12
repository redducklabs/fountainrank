# Handoff — server-authoritative contribution points (#204) shipped

**Date:** 2026-07-12
**PR:** #217 (squash-merged as `8e1998c`)
**Spec:** `docs/specs/2026-07-12-server-authoritative-contribution-points-design.md`
**Plan:** `docs/plans/2026-07-12-server-authoritative-contribution-points.md`

## What was actually wrong (read this before touching contribution points)

#204 was filed as *"I can re-rate a fountain repeatedly to game points."* **The ledger was never
gameable.** `dk_rate(user, fountain, rating_type)` is a permanent unique dedup key, and
`user_contribution_stats` increments **only from rows the insert actually returned**;
`test_contribution_emission.py` already asserted a re-rate awards nothing.

The bug was that **the clients were lying about it.** The API returned no "points awarded", so
`RatingForm.tsx` did `dispatchContribution(chosen.length * CONTRIBUTION_POINTS.rate)` — it *assumed*
full credit. Every re-rate popped a fake "+4 points" for an award of **0**.

It was a bug *class*, not a bug: **five paths** could award 0 and still celebrate (rating,
attributes, note, photo, condition), because the animation fired on *any* success and the number
only decided whether a "+N" was drawn on top.

## The invariants now in place — do not break these

1. **`record_contributions` is the only source of award truth.** It returns
   `ContributionResult(event_ids, points_by_user)` with `points_for(user_id)`. It is **per-user**
   deliberately: a batch may span users, and a scalar total would let a future bulk/import path
   report one user another user's points. `points_by_user` is summed from the same `RETURNING` rows
   that drive the stats increment, so the number shown and the number banked cannot diverge.
   - It defines `__bool__` (= `bool(event_ids)`) purely so a missed `if inserted:` site keeps its
     old meaning. **Do not rely on truthiness for award semantics** — use `points_for()`.

2. **Pre-submit earnability comes from the dedup LEDGER, never from content rows.**
   `viewer_award_state` is built from `contribution_events.dedup_key`. This is load-bearing: the
   dedup key is permanent but content is not. A **hidden note**, a **hidden attribute observation**,
   or a **deleted first photo** all leave the key spent while the content disappears — so a
   content-derived preview would promise points the insert will not award. Three regression tests
   cover exactly those (`backend/tests/test_viewer_award_state.py`).
   - Candidates are built from the **type registries** (all fountain-scoped `RatingType`, all active
     fountain-scoped `AttributeType`), **not** from the response's `dimensions`/`attributes` lists —
     a user can observe an attribute with no consensus row yet, and that is precisely the one most
     likely to be earnable. (`RatingType` has **no** `is_active` — don't filter on one.)

3. **It is an as-of-read HINT. The POST always wins.** The key can be spent between the GET and the
   submit (another tab/device; another user taking the fountain's first photo). Tested:
   `test_stale_hint_loses_to_the_insert`.

4. **The celebration fires iff the SERVER awarded > 0.** Enforced at the type level:
   `dispatchContribution()` takes a branded `AwardedPoints` that only the response-parsing layer can
   mint — `web/app/actions/awarded.ts` (behind `import "server-only"`; **every** `as AwardedPoints`
   cast in web production code lives in that one file) and `mobile/lib/awarded-points.ts` (whose
   parameter is the **generated response union**, so an ad-hoc `{ points_awarded: myGuess }` literal
   won't typecheck — pinned by a `@ts-expect-error` test).
   - This is a *high-friction* barrier, not a security boundary: TS is structural, so
     `awardedPoints({ ...detail, points_awarded: guess })` still compiles. The goal is to stop the
     **accidental** re-introduction of client-guessed points, which happened on five paths.

5. **Presence, not nullishness.** `awardedPoints` reads the canonical `points_awarded` whenever the
   **key exists** (including `null` → 0) and consults the deprecated `condition_points_awarded`
   **only when the key is absent** (older server). Writing `a ?? b` would celebrate a stale
   condition award on a null canonical field. Both platforms have a test for exactly that case — it
   is the one a `??` implementation passes every *other* test while failing.

## Traps that bit us (they will bite you too)

- **There are TWO web celebration listeners**: `ContributionStatusOverlay` **and**
  `MapBrowser.tsx`. Gating only the first leaves 0-point celebrations firing on the map.
- **There are TWO mobile celebration paths**: `app/fountains/[id].tsx` **and**
  `app/(tabs)/index.tsx` (add-fountain), which was celebrating `totalPreviewPoints(...)` — its own
  client-side preview total.
- **Gating the celebration is not enough.** The first Codex PR review caught that the four mobile
  form `onSubmit` callbacks returned a bare `{ ok: true }` and dropped the award, so a 0-point
  re-rate still read "Thanks. Your rating was saved." The callback contract now carries
  `AwardedPoints`.
- **The detail GET resolves its viewer via `get_optional_user`**, NOT the `get_current_user` the
  `client` test fixture overrides — and the fixture sends no auth header. So `client.get(...)` is
  **anonymous** by default. Override `get_optional_user` for an authenticated GET (see
  `_detail_as_viewer` in `test_viewer_award_state.py`).

## Security fix that came out of this (pre-existing)

`GET /fountains/{id}` set **no cache headers at all** while already returning viewer-scoped
`your_rating` (#65) and `condition_points_eligible_at` (#124) — a shared CDN/proxy could serve one
viewer's data to another. The Codex PR review then found the same leak on
`GET /leaderboard/contributors` (`rows[].is_you` / `you`).

**All three viewer-scoped public endpoints now send `Cache-Control: private, no-store`** —
fountain detail, photos list, leaderboard. If you add another `get_optional_user` route that returns
anything viewer-dependent, **it needs this header**, and a test asserting it on both the
authenticated and anonymous paths.

## Deferred

- **`condition_points_awarded` is deprecated compat**, kept populated in lockstep with the canonical
  `points_awarded` because already-released mobile clients read it. Remove it in a later change,
  once the store release from this PR has propagated. New code/tests must treat `points_awarded` as
  primary.

## Verification at merge

Backend 818 pass (`alembic check` no drift — **no migration was needed**; every new field is a
Pydantic model over existing tables + the existing `uq_contribution_events_dedup_key` index).
Mobile 391 pass. CI fully green, including `workspace-js` (which caught a stale `{ ok: true }` mock
in the #212 spinner test that resolved its promise manually and so escaped a grep).

Codex: spec approved (3 rounds), plan approved (4 rounds), PR approved (2 rounds).
