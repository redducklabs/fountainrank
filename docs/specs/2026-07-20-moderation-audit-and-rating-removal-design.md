# Moderation audit trail + rating removal (#216) — design

This closes the deferred moderation-accountability slice now tracked by GitHub issue #216.
The unified queue shipped in #12, but its mutations are only present in application logs and
individual ratings cannot be removed by an administrator. This design adds a durable audit trail,
audited rating removal with aggregate recomputation, and an admin rating-management surface.

## 1. Scope and decisions

In scope:

- A `moderation_actions` table recording every moderation state transition performed by the
  existing admin endpoints: fountain/note/photo hide and unhide, report dismissal, fountain/photo
  hard delete, and the new rating delete.
- An optional, bounded moderator reason on existing actions. It is optional at the API boundary for
  backward compatibility with released mobile clients; new web/mobile controls request it. Rating
  deletion requires a non-empty reason.
- Admin-only rating rows in `AdminFountainDetail`, with a delete endpoint that removes one rating,
  reverses its contribution awards, recomputes fountain aggregates, and writes an audit row in the
  same transaction.
- Web and mobile admin controls for rating removal and reason capture.
- Migration/model/schema/API-client/docs/tests.

Explicit decisions for work that #12 left ambiguous:

- Existing `is_hidden` is the product's soft-removal/tombstone mechanism for fountains, notes, and
  photos. A second `removed_at` state would duplicate it and create conflicting visibility rules.
  The new audit row supplies the durable actor/action/reason record missing from the flag.
- Note hard-delete is deliberately not added. Hiding a note removes it from public reads while
  retaining the evidence and report relationship. Account deletion remains the separate privacy
  lifecycle and may cascade the user's note.
- Queue-to-account sanction escalation is deferred specifically to #13, which follows this work
  and will reuse `moderation_actions`. #216 does not add a partial ban mechanism.
- Ratings remain non-reportable: individual ratings are not public content. Admins reach rating
  removal from the existing admin fountain detail.

## 2. `moderation_actions` data model

Migration `0029_moderation_actions.py` adds:

| Column | Type / constraints | Purpose |
| --- | --- | --- |
| `id` | UUID PK | action identity |
| `admin_user_id` | UUID nullable FK `users.id ON DELETE SET NULL` | current actor relationship |
| `admin_actor_id` | UUID non-null | immutable internal actor UUID snapshot; remains attributable if the user row is later deleted |
| `action` | string CHECK | `hide`, `unhide`, `dismiss`, `delete`, `rating_delete` initially; #13 extends this set |
| `content_type` | string CHECK | `fountain`, `note`, `photo`, `rating` |
| `content_id` | UUID | immutable polymorphic target identity; intentionally not an FK because targets may be deleted |
| `fountain_id` | UUID nullable FK `fountains.id ON DELETE SET NULL` | grouping/context when known; audit survives fountain deletion |
| `reason` | varchar(500) nullable | trimmed moderator reason; null identifies legacy/no-reason actions |
| `details` | JSONB nullable | bounded structured facts such as resolved-report or reversed-event counts; never report/note bodies, tokens, email, or other PII |
| `created_at` | timestamptz | database timestamp |

Exact names follow the repo naming convention: `pk_moderation_actions`, short CHECK names `action`
and `content_type` (rendering as `ck_moderation_actions_action` and
`ck_moderation_actions_content_type`), `fk_moderation_actions_admin`,
`fk_moderation_actions_fountain`, `ix_moderation_actions_target` on
`(content_type, content_id, created_at)`, `ix_moderation_actions_admin_created` on
`(admin_user_id, created_at)`, and `ix_moderation_actions_fountain_created` on
`(fountain_id, created_at)`. The current actor and fountain relationships are real FKs;
`content_id` cannot be a single FK because it is polymorphic and must remain valid after hard
deletion. `admin_actor_id` deliberately duplicates the internal UUID so later account deletion
does not anonymize old moderation decisions; it is admin-only audit data and is not exposed through
public APIs.

Audit rows are append-only in normal application code. `_record_moderation_action` only calls
`session.add`; it never commits. Each caller writes the audit row in the same transaction as the
mutation, so neither can persist alone. Structured runtime logs continue to be emitted after a
successful commit, but the database is the durable audit authority.

## 3. Existing action coverage

Audit only effective state transitions, except dismiss (which records the moderator decision even
when another request already resolved the reports):

| Handler | Audited action |
| --- | --- |
| `PATCH /admin/fountains/{id}` when `is_hidden` changes | `hide` / `unhide` |
| `DELETE /admin/fountains/{id}` | `delete` before the target row is deleted |
| `PATCH /admin/notes/{id}` when `is_hidden` changes | `hide` / `unhide` |
| `PATCH /admin/photos/{id}` when `is_hidden` changes | `hide` / `unhide` |
| old `POST /admin/photos/{id}/dismiss-reports` | `dismiss` |
| unified `POST /admin/reports/dismiss` | `dismiss` |
| admin photo delete | `delete` on the success path immediately before deleting the database row |

Ordinary fountain edits (coordinates, placement text, working state) are administrative edits but
not moderation actions and remain covered by structured logs rather than this table.

Payload compatibility:

- `AdminFountainPatch`, `AdminNotePatch`, and `AdminPhotoPatch` gain `moderation_reason?: string`.
- `ReportDismissRequest` gains `reason?: string`.
- Existing photo dismiss and DELETE endpoints accept optional `reason` query parameters.
- Reasons are trimmed; empty becomes null; values over 500 characters return 422.
- A `moderation_reason` supplied on an ordinary fountain edit, unchanged hide state, or other no-op
  transition is ignored because no moderation action occurred.

The photo-delete insertion point is intentionally after object deletion succeeds and after the
storage-failure branch. That branch commits durable `storage_cleanup` rows before returning 500; it
must never accidentally commit a `delete` audit row for a photo that remains in the database.
Repeated dismiss requests intentionally create decision records even when `resolved_count` is zero.

No reason text is written to runtime logs.

## 4. Rating management and removal

`AdminFountainDetail` gains `ratings: AdminRatingOut[]`. Each row includes rating id, rating type
id/name, stars, contributor display name, and `updated_at`. Serialization uses a `LEFT JOIN` from
ratings to users: account deletion intentionally detaches ratings (`user_id = NULL`, stable
`deleted_actor_id`) while retaining them in aggregates, so those rows remain visible as
"Deleted account" and removable. It is returned only by the existing admin-gated detail endpoint;
public fountain responses remain aggregate-only.

`DELETE /api/v1/admin/ratings/{rating_id}` accepts `ModerationReasonRequest { reason }` and returns
204. The handler:

1. Reads the rating's `fountain_id`; 404 if absent.
2. Acquires the Fountain row `FOR UPDATE`, matching rating submission's aggregate serialization.
3. Locks and rechecks the Rating row.
4. Reverses every awarded `rate` contribution event targeting `("rating", rating.id)` using the
   existing contribution reversal chokepoint. If this was the last remaining rating by the same
   live actor on the fountain, a new contribution helper also reverses that actor's still-awarded
   `first_rating_bonus` event matching `event_type = 'first_rating_bonus'`,
   `dedup_key = first_rating:{fountain_id}`, `user_id = deleted_rating.user_id`, and
   `status = 'awarded'`. "Last" means no *other* rating row (`id != rating_id`) remains for the same
   actor and fountain. If another dimension by that actor remains, or the deleted rating belongs to
   a later rater rather than the bonus owner, the original bonus remains valid. The helper mirrors
   `_adjust_target`: it atomically flips awarded to reversed and decrements/clamps the actor's
   denormalized points. A detached rating has no live `user_id` and no surviving contribution event
   because account deletion explicitly hard-deletes that user's event/stats rows, so both reversals
   are safe no-ops without issuing a `user_id = NULL` bonus query.
5. Deletes the rating and flushes.
6. Recomputes `rating_count`, `average_rating`, `ranking_score`, and `last_rated_at` with
   `recompute_fountain_ranking` while the fountain lock is held. This work also corrects that shared
   helper to derive `last_rated_at = max(Rating.updated_at)` (or null), instead of stamping "now" on
   any aggregate recompute; deletion must not masquerade as a fresh rating.
7. Appends `rating_delete` with rating/fountain ids, required reason, and bounded details
   (`rating_type_id`, `stars`, reversed-event count).
8. Commits once and logs identifiers/counts without the reason.

The whole database operation is wrapped in `interactive_lock_timeout` so an admin removal returns
the established 503 busy response rather than waiting indefinitely for a competing fountain lock.
It does not take the boundary-loader advisory lock because no place membership/count changes.

The shared freshness correction ensures aggregate recomputation after a deletion does not stamp a
fresh rating time. Normal rating submits still produce the maximum `updated_at`. Account detachment can advance a
retained rating's `updated_at`, so this field remains the latest rating-row mutation timestamp rather
than an immutable original-submission timestamp; that is still materially more accurate than
stamping every aggregate recomputation with the current time.

This is a hard delete because a removed rating must not participate in aggregates and has no public
body requiring a tombstone. The audit row preserves the moderation decision and target UUID.
Re-submitting that rating dimension creates a new rating UUID; previously reversed `rate` and bonus
dedup keys remain spent, preventing delete/re-submit point farming. A removed first-rating bonus is
not reassigned to a later rater: it records a historical first-ever attempt, consistent with the
project's permanent-dedup policy for removed contributions.

## 5. Web and mobile

The admin fountain detail's existing admin controls add a compact "User ratings" section. Each row
shows dimension, stars, contributor, and updated date, with a destructive Remove flow requiring a
1–500 character reason and explicit confirmation. Web uses a server action; mobile uses the shared
API client and invalidates/refetches fountain detail. Errors follow existing admin action patterns.

The moderation queue's Hide, Unhide, Reject, and Delete controls request an optional reason before
submitting. Empty reason remains allowed for compatibility and low-friction corrections; the UI
labels it optional. No new dependency or visual primitive is introduced; the controls reuse the
documented admin/danger/dialog treatments in `docs/style-guide.md`.

## 6. Security, privacy, and observability

- Every endpoint stays behind `require_admin`; non-admin tests cover the new delete route and
  enriched admin detail.
- Rating rows and contributor identity never enter public responses.
- Reason strings are admin-only data: validated and stored, never included in application logs.
- Audit `details` uses a fixed server-built dictionary and never accepts arbitrary client JSON.
- A failed mutation rolls back its audit row; a failed audit insert rolls back the mutation.
- The photo storage-failure exception is the documented special transaction: it commits only
  cleanup-ledger rows and no audit action because no content mutation occurred.
- Logs contain request/admin/target identifiers and bounded counts so failures remain diagnosable.

## 7. Verification

- Migration upgrade/downgrade, model drift, exact FK/CHECK/index names.
- Backend tests for every action transition, no-op transitions, both dismiss paths, photo and
  fountain deletion, reason normalization, authorization, and transactional rollback.
- Rating removal tests for 404/403/422, aggregate recomputation including last-rating removal,
  true `last_rated_at`, target and actor-scoped conditional first-rating-bonus reversal (including a
  later rater whose removal must not affect the first rater's bonus), durable audit details,
  detached-rating visibility/removal, bounded lock waits, and a concurrent-write-compatible order.
- Photo storage-delete failure returns 500, preserves the photo, commits cleanup rows, and writes no
  moderation action.
- Generated OpenAPI/client remains clean; web/mobile unit tests cover reason and rating-removal
  success/error/confirmation behavior.
- Full local mirror where supported, authoritative CI, and independent adversarial review.
