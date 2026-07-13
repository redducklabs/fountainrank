# Durable Contribution-Write Rate Limits — Design

**Status:** Draft  
**Security source:** `temp/security-review-2026-06-20.md`, finding 5  
**Program plan:** `docs/plans/2026-07-13-security-review-remediation.md`, Workstream 2

## 1. Goal

Bound authenticated abuse of FountainRank's inexpensive JSON write endpoints across backend pods,
including failed business-level attempts, without Redis and without coupling profile synchronization
to contribution budgets.

This design covers:

- `POST /api/v1/fountains`
- `POST /api/v1/fountains/{id}/ratings`
- `POST /api/v1/fountains/{id}/attributes`
- `POST /api/v1/fountains/{id}/conditions`
- `POST /api/v1/fountains/{id}/notes`
- `POST /api/v1/me/sync`

Photo-upload and content-report limits remain independent and unchanged. Per-client-IP ingress
defense is a separate infrastructure PR because the current DO Load Balancer/NodePort forwarded-IP
trust boundary must be corrected before an IP can safely key a limit.

## 2. Security properties

1. Limits hold across all pods and process restarts.
2. Concurrent requests by one user cannot over-admit past a boundary.
3. Every authenticated, syntactically valid request admitted by the limiter consumes attempt budget,
   even when later target lookup, authorization, proximity, catalog, conflict, or upstream userinfo
   checks fail.
4. Rejected over-budget requests perform no domain query, row lock, mutation, or external userinfo
   call after authentication/request parsing.
5. A rate-limit failure is a stable `429` contract with `Retry-After`; it never becomes a silent
   500 and never reveals another user's activity.
6. `/me/sync` throttling cannot prevent authentication or lock a user out of the application. It
   limits only the optional profile refresh.
7. Logs contain the local user UUID and non-sensitive budget metadata, never request bodies,
   userinfo tokens, JWTs, email addresses, names, or raw identity-provider subjects.

## 3. Budgets

Two independent per-user budgets are enforced:

| Budget               | Endpoints                                     | Rolling minute | Rolling 24 hours |
| -------------------- | --------------------------------------------- | -------------: | ---------------: |
| `contribution_write` | fountain, rating, attributes, condition, note |             20 |              200 |
| `profile_sync`       | `/me/sync`                                    |             10 |              100 |

One HTTP request consumes one attempt regardless of how many ratings or observations it batches.
The contribution budget is intentionally shared: switching endpoint types must not multiply an
attacker's allowance. Twenty writes per minute supports fast legitimate correction/contribution
flows; 200 per day is well above ordinary use while bounding sustained single-account spam.

Profile sync is separate because it calls Logto userinfo and is part of sign-in/profile refresh,
not public content creation. Ten per minute accommodates multi-device sign-in and transient retries.
Clients must treat a sync `429` as “profile refresh deferred”: keep the authenticated session, use
the last locally/backend-known profile, honor `Retry-After`, and do not loop or sign the user out.

The constants are code-reviewed product/security policy, not environment variables. Changing them
requires tests and review; a production-only environment override could create untested behavior.

## 4. Durable attempt ledger

Add `write_attempts`:

| Column       | Type        | Rules                                                                     |
| ------------ | ----------- | ------------------------------------------------------------------------- |
| `id`         | UUID        | primary key, application-generated                                        |
| `user_id`    | UUID        | non-null FK `users.id`, `ON DELETE CASCADE`                               |
| `budget`     | varchar(32) | non-null; `rate_budget` CHECK in `('contribution_write', 'profile_sync')` |
| `endpoint`   | varchar(32) | non-null; `rate_endpoint` CHECK for the codes listed below                |
| `created_at` | timestamptz | non-null, server default `now()`                                          |

Allowed endpoint codes are `fountain_create`, `rating_submit`, `attribute_submit`,
`condition_submit`, `note_submit`, and `profile_sync`. They contain no path IDs or user content.

The ORM uses its normal `default=uuid.uuid4` application-generated ID. Short constraint names
`rate_budget` and `rate_endpoint` render through the naming convention as
`ck_write_attempts_rate_budget` and `ck_write_attempts_rate_endpoint`; the FK is
`fk_write_attempts_user`. Index `(user_id, budget, created_at)` supports rolling-window counts; a
second `(created_at)` index supports age cleanup. Admission counts always key on `budget`, never
`endpoint`, so all five contribution endpoint codes consume the same allowance. No status or
finalization column exists: this is an admission-attempt ledger, not a success quota. Once a request
passes the gate, its committed row remains counted whether the handler returns 2xx, 4xx, or 5xx.
That prevents cheap repeated failures and avoids rollback erasing the security event.

## 5. Atomic admission and transaction boundary

`reserve_write_attempt(session, user_id, budget, endpoint)` uses the request's existing
`AsyncSession`. Authentication may already have opened that session's transaction; the reservation
is still the first endpoint-body database operation.

1. Start the short transaction.
2. Take `pg_advisory_xact_lock(WRITE_RATE_LIMIT_LOCK_NS, stable_user_hash)` using the existing
   deterministic signed-int32 user hash helper.
3. Count this user's rows for the budget in the rolling 60-second and 24-hour windows. For a
   violated window, obtain the oldest in-window `created_at` in the same locked transaction and
   compute `Retry-After = max(1, ceil(oldest + window - database_now))`.
4. If either count is at its limit, explicitly roll back to release the transaction-scoped lock,
   log the rejection, and raise `RateLimited` without inserting.
5. Otherwise insert one `write_attempts` row and commit, releasing the lock and returning the same
   connection to the pool before domain work begins.
6. Only then enter domain lookup/locking/mutation or call Logto userinfo.

The lock namespace is `WRITE_RATE_LIMIT_LOCK_NS = 0x57524154` (`"WRAT"`), distinct from
add-fountain, photo-upload, and content-report locks.
Lock order is therefore write-rate advisory lock in the short transaction, release, then any domain
session advisory/row lock. No handler holds both simultaneously, avoiding a cross-feature deadlock.

The gate runs after FastAPI has authenticated the user and validated the Pydantic body, so malformed
or anonymous traffic is handled by the existing 401/422 and ingress body cap. For the five named-user
contribution routes, replace the `require_named_user` endpoint dependency with `get_current_user`,
reserve as the first endpoint-body action, then call a shared pure `ensure_named_user(user)` guard
that preserves the existing typed `409 display_name_required` response. This ordering makes an
authenticated unnamed account consume budget rather than bypassing the gate in dependency
resolution. The gate precedes `_validate_*`, target lookup, `FOR UPDATE`, proximity work, or
userinfo fetch. This deliberately charges valid-shape requests for unnamed users, nonexistent
targets, and other business failures.

Dependency overrides remain possible in tests: inject a `WriteAttemptReserver` callable into each
route. The production dependency delegates to the shared limiter service using the request session.
Using one session avoids doubling connection demand during an abusive burst. The early reservation
commit is safe because it occurs before domain mutation; a later rollback starts after that commit
and cannot erase the attempt. Tests also cover authentication-side reconciliation followed by the
early commit so pending user/admin reconciliation is not lost.

## 6. Response and logging contract

On either boundary:

- status `429 Too Many Requests`
- body `{"detail":"<reason_code>"}` using the exact reason below
- `Retry-After` equal to the seconds until the oldest row in the violated rolling window expires

Returning the reason code intentionally matches the existing photo/report `RateLimited` contract;
clients act on status and `Retry-After` and need not branch on the reason. The reason codes are
`contribution_writes_per_minute`, `contribution_writes_per_day`,
`profile_syncs_per_minute`, and `profile_syncs_per_day`.

New rate-limit admission/rejection logs include:

- `user_id`
- `budget`
- `endpoint`
- `window`
- observed `count`
- `retry_after` on rejection

Successful admissions log at `INFO` without request content. Rejections log at `INFO` because they
are expected security-control outcomes, not server errors. `user_id` always means the local
`users.id` UUID. This restriction applies to the new limiter logs; `/me/sync`'s pre-existing success
log currently includes the opaque Logto subject and is outside this batch's scope.

## 7. `/me/sync` availability behavior

The backend `429` is distinct from a `401` resource-token failure and from a `502` Logto userinfo
failure. Web/mobile callers must:

- preserve the authenticated Logto session;
- avoid clearing locally cached profile data;
- skip immediate retry and honor `Retry-After`;
- allow normal read/navigation behavior;
- surface no fatal sign-in error solely because profile refresh was throttled.

Tests cover the backend contract and each first-party sync helper's graceful behavior. The budget is
accepted only if tests demonstrate ten parallel/rapid legitimate-shaped attempts can be admitted
and the eleventh is deferred without logout. Future threshold changes should use observed aggregate
endpoint cadence without logging per-user identity data beyond existing structured operational logs.

A Logto outage can make repeated `502` retries consume this budget. That is intentional: the budget
also prevents one authenticated client from amplifying a failing upstream. First-party clients must
avoid immediate retry loops on both 429 and 502.

## 8. Retention and cleanup

Only 24 hours of rows are authoritative. Retain 30 days for short operational investigation, then
delete them with a dedicated `python -m app.write_attempt_cleanup` command and hardened
`write-attempt-cleanup` Kubernetes CronJob manifest. Do not couple this job to account-deletion
cleanup or its exit semantics. The hourly job deletes batches of up to 10,000 rows older than 30
days, committing between batches, for at most ten batches per invocation. It stops early when a
batch is short; if the safety cap is reached it logs the remaining backlog and exits successfully so
the next hourly run continues. A 100,000-row/hour drain exceeds the ledger's per-account admitted
rate while bounding lock/transaction duration; operations can adjust the batch/run cap through a
reviewed code change if aggregate adoption outgrows it.

Cleanup is safe concurrently with admission because active counts never read rows older than 24
hours. Log only deleted row count, cutoff timestamp, and whether the safety cap was reached. Account
deletion cascades that user's rows. The CronJob uses the same database secret/CA wiring and hardened
pod pattern as existing backend jobs, with `automountServiceAccountToken: false`; its non-zero exit
means this cleanup command itself failed. Migration downgrade drops the table; upgrade creates the
named FK/CHECKs/indexes explicitly and upgrade/downgrade/upgrade must be tested.

## 9. Tests and acceptance

### Limiter primitive (real Postgres/PostGIS only)

- admits exactly the minute/day boundary and rejects the next attempt;
- budgets are independent for one user and isolated between users;
- endpoint codes share the `contribution_write` budget;
- a rejected reservation inserts no row;
- true parallel calls using separate sessions/connections and genuinely overlapping transactions
  cannot admit more than the limit (never simulate concurrency with one shared session);
- committed attempt remains after a simulated domain transaction rollback;
- exact convention-rendered FK/CHECK/index names and definitions exist in `pg_constraint` and
  `pg_indexes`, and migration upgrade/downgrade/upgrade is clean;
- cleanup removes only rows older than 30 days and obeys its batch and per-run safety caps.

### Route contract

For every covered endpoint:

- over budget returns 429 + exact reason detail + a rolling-window-derived `Retry-After`;
- the gate is called with the correct budget/endpoint code, including before an unnamed user's 409;
- rejection occurs before target/catalog/domain queries or external calls;
- a post-admission 4xx/5xx still leaves the independently committed attempt;
- normal success behavior and response schemas remain unchanged.

### Client behavior

- web and mobile profile-sync helpers preserve auth state and stop retrying on 429;
- contribution clients continue to use the existing generic error handling for 429 and do not
  immediately resubmit automatically.

### Verification

- backend Ruff/format, Alembic upgrade/check, full pytest against PostGIS;
- generated OpenAPI and API-client typecheck;
- web/mobile lint, typecheck, tests, web build, and hosted mobile-doctor;
- full `./run.ps1 check`, hosted CI/security gates, and required review loop.

## 10. Non-goals

- Per-IP/subnet limiting, trusted-proxy configuration, or ingress annotations (separate PR F).
- New-account age/reputation tiers, CAPTCHA, device fingerprinting, or proof-of-work.
- Changes to photo-upload/content-report limits.
- Success quotas or contribution-point rule changes.
- Rate limiting public read endpoints.
- Redis or another new service dependency.
