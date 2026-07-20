# Account sanctions design (#13)

## Goal

Admins can permanently ban or temporarily suspend an account from a moderation-queue item, lift a
sanction, and retain a durable audit trail. Sanctioned users may authenticate and browse, but every
backend write returns 403. Temporary suspensions expire automatically.

## Data model

Migration `0030_account_sanctions` adds to `users`:

- `account_status`: `active | suspended | banned`, non-null, default `active`.
- `suspended_until`: nullable timezone-aware timestamp; present only for `suspended`.
- `sanction_reason`: nullable `varchar(500)`; required for non-active states.
- `sanctioned_at`: nullable timezone-aware timestamp.
- `sanctioned_by_user_id`: nullable self-FK with `ON DELETE SET NULL`.

The migration adds CHECKs for the status and coherent shape: `active` requires all four sanction
fields null; `banned` requires a reason/time and no expiry; `suspended` requires a future-or-past
expiry plus reason/time. The actor is required when an admin creates a sanction, but may later
become null through the declared `ON DELETE SET NULL` account-erasure behavior; immutable actor
attribution remains in the audit row. An index on `(account_status, suspended_until)` supports queue
state enrichment and operational searches for current/expired sanctions.

Current state lives on `users`; history lives in the existing append-only `moderation_actions`
table. Its CHECKs expand to actions `ban`, `suspend`, `unban`, and `expire`, and content type `user`.
To represent automatic expiry honestly, it gains `actor_kind: admin | system`; existing/admin rows
require immutable `admin_actor_id`, while system rows require it null. `admin_user_id` remains the
nullable live FK. Target `content_id` survives later user deletion.

## Write gate and expiry

`get_current_user` continues to resolve identity for reads. After provisioning/admin reconciliation,
it evaluates the effective sanction for every request:

- `GET`, `HEAD`, and `OPTIONS` remain readable.
- Every other method is rejected with 403 and stable detail `account_banned` or
  `account_suspended`.
- If a suspension appears expired, auth re-selects the user `FOR UPDATE`, re-checks under the lock
  that it is still suspended and expired, then resets it to `active`, clears `suspended_until`,
  `sanction_reason`, `sanctioned_at`, and `sanctioned_by_user_id`, and appends a system-authored
  `expire` audit row in the same commit. If an admin ban/re-suspend won the lock first, expiry does
  nothing and the latest sanction is enforced.

Putting the method-aware gate in the shared authenticated dependency covers current and future
write routes, including profile, fountain, rating, note, photo, report, and admin mutations. The
single exception is `DELETE /api/v1/me`, which remains available so sanctions never obstruct account
erasure. Profile sync remains blocked. Public anonymous reads remain unchanged. `/me` exposes status
and suspension expiry so web/mobile can explain the restriction rather than collapsing it to a
generic error. Backend enforcement is authoritative; Logto session revocation is deferred because
local enforcement is immediate and Logto remains the identity authority.

## Admin API

`PATCH /api/v1/admin/users/{user_id}/sanction` accepts:

- `status`: `active | suspended | banned`
- `reason`: trimmed 1–500 characters for every deliberate transition
- `suspended_until`: required and future-dated for `suspended`, forbidden otherwise

The route locks the target user, rejects self-sanction and every `is_admin` target, rejects
incoherent payloads, updates current
state, writes the matching `moderation_actions` row (`ban`, `suspend`, or `unban`) in the same
transaction, and returns the effective sanction. Repeating the identical state/reason/expiry is an
idempotent 200 with no new audit row; changing reason/expiry is a new audited action. Lifting a
sanction clears every current sanction field; the required lift reason exists only on its `unban`
audit row.

## Queue escalation and UI

The unified moderation queue exposes `contributor_user_id` for photo/note/fountain authors only on
the admin-gated response. Web and mobile rows with an attached contributor offer:

- Suspend: reason plus a required future expiry.
- Ban: reason plus explicit destructive confirmation.
- Lift sanction when the contributor is currently sanctioned.

The queue response also includes contributor sanction state/expiry so controls render accurately.
Admins cannot sanction detached/deleted contributors, any admin, or themselves. Successful actions invalidate
the queue and `/me` caches as applicable.

## Verification

- Migration/model parity and upgrade/downgrade tests.
- Admin authz, self-sanction, validation, transition, audit atomicity, and unban tests.
- A table-driven authenticated-write test covers every route class and proves 403 for banned and
  suspended users while representative reads remain available.
- Expired suspension permits a write and clears current state.
- A deterministic race test proves an expiry reset cannot overwrite a concurrent ban.
- Queue serialization never exposes user IDs publicly and correctly handles deleted contributors.
- Web/mobile lint, typecheck, action/control tests, generated client, and production web build.

Downgrade is supported only while no sanction audit rows exist. Once adopted, narrowing the audit
CHECKs would reject preserved `user`/sanction history, so the migration refuses downgrade with a
clear operator error rather than deleting audit data.
