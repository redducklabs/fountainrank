# Mobile add-flow resilience — design (2026-07-17)

Issues: #241 (write requests have no timeout/abort), #244 (newly added fountain vanishes from the
map). Sibling designs: `2026-07-17-mobile-live-location-design.md` (#243),
`2026-07-17-scoped-add-fountain-lock-design.md` (#242).

## Problem

Owner field report: adding a fountain "takes forever, does not work a lot of the time when I'm out
in the world (moving)", and fountains that were added "sort of showed up as new fountains, but then
does not stay". The adds were made independently with long gaps, so the write-rate limits (#220/#221)
are ruled out.

Root causes (verified in code):

1. **No request in the mobile app is timeout-bounded or abortable.** The shared client is a thin
   `createClient` (`packages/api-client/src/index.ts:7-9`); the mobile wrapper only sanitizes
   headers and injects auth (`mobile/lib/api.ts:187-219`). React Native's `fetch` has no default
   timeout, and `useMutation` defaults to `retry: 0`. A socket that stalls mid-flight (cell handoff
   while moving) leaves `POST /api/v1/fountains` pending forever; the submit spinner
   (`mobile/app/(tabs)/index.tsx:602`) spins indefinitely. The only bounded call in the app is auth
   sync (`mobile/lib/auth/sync.ts`, 3s).
2. **The map never receives the created fountain locally, and both refetch-failure shapes drop
   it.** `addMutation.onSuccess` (`index.tsx:231-237`) only invalidates. Two distinct failure
   shapes then lose the pin (TanStack Query v5 semantics):
   - an **already-cached** bbox entry whose invalidation-triggered refetch fails keeps its own
     *pre-add* data (`isError` + stale `data`) — the map silently renders the old pin set;
   - a **new-key** query (pan/zoom past the 250 ms debounce creates a new
     `["fountains","bbox", params, filters]` entry) that fails shows `keepPreviousData` placeholder
     pins only while `pending`; once it enters `error` the observer stops substituting the
     placeholder and the map falls to the no-data error state.
   Server-side visibility is immediate (`fountains/bbox` reads the live table filtered only on
   `is_hidden`), so this is purely a client-cache defect.
3. **A wasted second round-trip after add.** The POST returns the full `FountainDetail`, but the
   client reads only `id` + points (`index.tsx:212-217`) and `router.push`es to the detail screen,
   which refetches the same detail (`mobile/app/fountains/[id].tsx:112-135`) on the same bad
   network.

## Decision

### 1. Transport-level timeout on every JSON request

Extend `createApiClient` (`mobile/lib/api.ts`) so `sanitizingFetch` bounds every request:

- Reads (`GET`): `READ_TIMEOUT_MS = 15_000`. Writes (everything else): `WRITE_TIMEOUT_MS = 30_000`.
  Constants live in `lib/api.ts` and are exported for tests.
- **Mechanism**: per request, create an `AbortController` and a deadline timer (do not rely on
  `AbortSignal.timeout`; not guaranteed on Hermes). Because a signal cannot be retrofitted onto an
  existing `Request`, construct the request actually sent as `new Request(input, { signal:
  controller.signal })` — auth injection and the x-dev sanitizer run against **that** request, so
  the security controls apply to the bytes on the wire.
- **The deadline covers the whole pipeline, including token acquisition.** `sanitizingFetch`
  awaits `getAccessToken()` before dispatch; a hung token provider must not escape the ceiling.
  The token await is raced against the same deadline: if the deadline fires while the token is
  pending, reject with `ApiTimeoutError` and dispatch **nothing** — never fall through to a
  tokenless authenticated request (the existing security invariant). If `getAccessToken` rejects
  first, the existing `AuthSessionError` path is preserved unchanged. A token that resolves after
  the deadline is discarded (no late dispatch).
- **Composition and precedence (exact contract)**: if the inbound `Request` carries a signal
  (openapi-fetch pass-through / TanStack cancellation / screen teardown), listen to it and forward
  aborts to the controller.
  - Deadline fires → reject with `ApiTimeoutError` (new class in `lib/api.ts`, no HTTP status).
  - Inbound signal fires (before the deadline) → preserve the caller's abort: re-throw the
    original abort reason/`AbortError`, **never** `ApiTimeoutError` — converting a cancellation
    into a timeout would surface false errors and break TanStack cancellation semantics.
  - Inbound signal already aborted on entry → reject immediately with the caller's abort reason
    without dispatching the request.
  - Underlying network failure (`TypeError`) → propagate unchanged.
  In all paths, `finally` clears the deadline timer and removes the inbound-signal listener.
- **Scope: the JSON verbs only** (`GET/POST/PUT/PATCH/DELETE` through `sanitizingFetch`).
  `uploadMultipart` delegates to the native `expo-file-system` uploader, which streams large photo
  files and has no clean abort seam in the current API — explicitly out of scope.
- **No automatic retry of writes.** Reads keep the existing `retry: 1`.
- **Diagnostics (required by the logging standard — every new failure branch must be diagnosable
  from logs)**: a small structured logging seam is introduced at `mobile/lib/log.ts` — a single
  function that serializes **one JSON line** per event (`console.warn(JSON.stringify({ level,
  area, event, ...fields }))`) and centralizes redaction; the transport and any UI branch log
  through it, never via ad-hoc multi-argument `console.*` calls. Reconciliation with the project
  logging standard, stated explicitly: `LOG_LEVEL`/`LOG_FORMAT` are server-runtime controls with
  no equivalent in a shipped native binary; the mobile client's contract is that these rare
  failure events are always emitted as structured JSON lines to the JS console (Metro in dev, the
  OS log via React Native in production) at warn level — a deliberate, documented deviation, not
  a silent omission. On deadline expiry the transport emits `event: "api_timeout"` with the HTTP
  method, the URL **path only** (origin and query string stripped — resource UUIDs are public
  identifiers; never the query, body, headers, tokens, or coordinates), the timeout value, and
  `source: "deadline"`. Caller aborts are not logged (routine). A test inspects the **final
  serialized string** and asserts it contains no Authorization/x-dev material, no body, no query
  string, and no raw error message text.

### 2. The timed-out create is outcome-unknown — recover by reconciliation, not "try again"

Aborting the client fetch does not undo a server transaction that already received the body: a
timed-out `POST /fountains` may still commit. The recovery leans on a deterministic property of
the backend: the duplicate probe rejects any create within 10 m of an existing non-hidden fountain
(`backend/app/routers/fountains.py:833-849`), and a retry of the **unchanged draft** posts the
**identical coordinates** — distance 0. So if the first attempt committed, an unchanged retry
always returns the typed 409, which the flow already handles by routing the user to that fountain
(`index.tsx:682-685`). The retry *is* the reconciliation.

Design:

- `mapAddFountainError` (`mobile/lib/add-fountain/state.ts:91` — note: this is the add flow's own
  mapper; the contribution writes use a separate mapper, covered below) gains a distinct
  `"timeout"` classification for `ApiTimeoutError` **and** for mid-flight network rejections
  (`TypeError`) of the create — both are outcome-unknown, and the reconciliation property makes
  the same recovery correct for both.
- `addFountainErrorText("timeout")` copy states the ambiguity and the reconciliation:
  "We couldn't confirm your fountain was saved. Leave the pin where it is and try again — if it
  was already saved, we'll take you to it." The draft is preserved by the existing `submitError`
  path (`index.tsx:695-701`); the panel stays on the details step, so the pin is unchanged unless
  the user deliberately navigates back and moves it. The residual risk (user moves the pin > 10 m
  between attempts → possible second fountain) is accepted and noted here; a client idempotency
  key requires backend work and is out of scope (recorded on #241).
- A companion structured event `add_fountain_outcome_unknown` (through the `lib/log.ts` seam)
  marks the ambiguous branch distinctly from an ordinary failure. Fields:
  `reason: "deadline" | "network_failure"`, with `timeout_ms` present only for the deadline case
  (a `TypeError` has no timeout duration). The raw `TypeError` message is never logged (React
  Native network errors can embed URLs). No coordinates, no body.
- **Cross-spec dependency (explicit gate, not release ordering)**: the reconciliation argument
  rests on the backend holding the add advisory lock across the duplicate probe + insert, so an
  unchanged retry is serialized behind an in-flight first attempt and deterministically sees
  either the committed fountain (→ 409) or its absence (→ create). That mutual-exclusion property
  must be pinned by a backend concurrency test — specified in the sibling
  `2026-07-17-scoped-add-fountain-lock-design.md`, whose design preserves it — so a future lock
  refactor cannot silently invalidate this client's safety argument.
- **Contribution writes** (rating/condition/note — mapped in `mobile/lib/contributions/state.ts`,
  upsert semantics server-side, so a retry is safe and non-duplicating): that mapper gains its own
  explicit `ApiTimeoutError` → network-bucket mapping with the existing retry copy. Each mapper
  gets its own tests; nothing is assumed shared.

### 3. Seed caches from the create response

`AddFountainResult`'s success branch carries the full `FountainDetail` the POST already returned.
`onSuccess` then:

1. **Detail cache**: `queryClient.setQueryData(["fountain", id, true, "public"], detail)`. The
   adder is authenticated by construction and the detail screen's key is
   `["fountain", fountainId, <authed>, "admin"|"public"]` (`[id].tsx:112-118`). For non-admin
   users (the overwhelming case) the post-add detail screen renders instantly with no *blocking*
   round-trip — one background revalidation request may still occur via the kept invalidation,
   deliberately; **admins** resolve `isAdmin` via `["me"]` and read the `"admin"` key, so they still
   fetch — an accepted limitation, stated here. The existing `["fountain", id]`-prefixed
   invalidation (`index.tsx:235`) is **kept**, providing background revalidation of the seeded
   entry.
2. **Map pin cache**: build a `FountainPin` from the detail and insert it into cached bbox
   entries via a pure helper (new exported function in `mobile/lib/map/`), wired through
   `queryClient.getQueriesData({ queryKey: ["fountains","bbox"] })`. Exact helper semantics:
   - operates only on entries whose key matches the exact four-part shape
     `["fountains","bbox", params, filters]` with a structurally valid `params`
     (four finite numbers) and a structurally valid `filters` object; anything else (including the
     `["fountains","bbox","idle"]` placeholder key) is left untouched;
   - inserts when the pin's coordinates fall inside `params` bounds **inclusively** (matching the
     backend's `ST_MakeEnvelope`/`ST_Intersects` boundary behavior) and
     `hasActiveFilters(filters)` is false — entries with active filters are only invalidated (the
     pin lacks the consensus-attribute data to evaluate `bottle_filler` / `wheelchair_reachable` /
     `min_rating` client-side, and a wrong pin on a filtered map is wrong feedback);
   - non-finite pin coordinates → no-op;
   - a pin with the same id already present is **replaced** by the new one (the POST response is
     the authoritative freshest record);
   - updates are immutable (new array/object identities for changed entries only; untouched
     entries keep their references);
   - `truncated` is preserved as-is.
3. **Then invalidate** `["fountains","bbox"]` + `["me","contributions"]` + `["fountain", id]`
   exactly as today. Eventual consistency with the server remains the end state; the local insert
   guarantees the pin cannot vanish when a refetch fails, because a cached entry that fails its
   refetch retains its (now seeded) data.

### 4. `staleTime` for bbox reads — honest scope

`pinsQuery` gains `staleTime: 30_000` (scoped to this query; global defaults unchanged). What it
does and does not do:

- It suppresses refetch on pan-back to a **non-invalidated, previously successful** bbox key
  within 30 s — fewer redundant requests on a flaky network during ordinary panning.
- It does **not** prevent the post-add invalidation from refetching (invalidation overrides
  `staleTime`, deliberately — the seeded caches want server confirmation), and it does not stop a
  query already in `error` from refetching on observe. The vanish fix is the cache seed of §3,
  not `staleTime`.

### 5. Make "showing stale pins" visible

`MapOverlay` (`index.tsx:710-718` and its component) gains a distinct state for
`pinsQuery.isError && pinsQuery.data != null`: a persistent banner ("Couldn't refresh fountains —
showing saved data. Retry") reusing the existing quiet-refetch banner styling, with
`accessibilityRole="alert"` / live-region announcement. The **new-key** error shape
(`isError && data == null`) keeps the existing full error/offline overlay (accurate there). The
new banner state is documented in `docs/style-guide.md` per the style-guide rule.

## Scope and correctness

- No backend changes. No generated api-client changes (web untouched); the timeout wrapper lives
  in the mobile wrapper's fetch.
- The x-dev sanitizer and auth injection MUST demonstrably apply to the composed request actually
  dispatched (tested — see Verification 1).
- The seeded detail must be the server response object unmodified, so background revalidation
  produces no flicker.
- Explicitly out of scope: offline queueing, cache persistence across restarts, automatic write
  retries, upload timeouts, backend idempotency keys, and the rating proximity-guard latency
  (live-location design).

## Verification

TDD throughout. Suites are classified honestly per `local-dev.md`:

**Node-safe unit tests (runnable locally and in CI `workspace-js`):**

1. Timeout wrapper, with fake timers and a stub fetch: (a) hanging POST rejects with
   `ApiTimeoutError` after `WRITE_TIMEOUT_MS`, hanging GET after `READ_TIMEOUT_MS`; (b) a fetch
   that settles first clears the timer and removes the inbound listener (spy assertions);
   (c) inbound abort mid-flight rejects with the caller's abort reason, not `ApiTimeoutError`;
   (d) pre-aborted inbound signal rejects immediately without calling fetch; (e) network
   `TypeError` propagates unchanged; (f) the dispatched request (captured by the stub) carries the
   composed signal, the injected `Authorization` header, and no `x-dev*` header; (g) the
   `api_timeout` event's final serialized line contains method + path only — no query string,
   headers, body, raw error text, or token material; (h) token-provider bounding: a never-settling
   `getAccessToken` rejects with `ApiTimeoutError` at the deadline and `baseFetch` is never
   called; a token rejection before the deadline surfaces `AuthSessionError`; a token resolving
   after the deadline dispatches nothing; (i) race ordering: with fake timers, inbound-abort-first
   and deadline-first orderings each produce exactly one terminal rejection of the correct
   identity, exactly one `api_timeout` log in the deadline case only, listener/timer cleanup in
   both, and no unhandled rejection when the underlying fetch settles late.
2. `resolveViewState` classifies `ApiTimeoutError` as the offline/network shape.
3. `mapAddFountainError`: `ApiTimeoutError` → `"timeout"`; mid-flight `TypeError` → `"timeout"`;
   existing mappings unchanged. `addFountainErrorText("timeout")` carries the
   reconciliation copy. Contributions mapper: `ApiTimeoutError` → its network bucket.
4. Bbox insert helper: in-bounds default-filter insert; **inclusive** boundary coordinates
   insert; out-of-bounds skip; active-filter skip; malformed key/params/filters/pins skip
   untouched; `"idle"` key untouched; NaN/Infinity pin no-op; duplicate id replaced; `truncated`
   preserved; immutability (untouched entries keep reference identity).
5. Pin-from-detail mapper: field-for-field.

**CI-gated integration/render tests (jsdom directive; CI `workspace-js` is the truth on this
host):**

6. QueryClient-level: seed → invalidate → failed refetch → the seeded pin is still in the cache
   and `isError` is true; new-key failure ends with no substituted placeholder data. Detail-seed
   key selection for authenticated non-admin (instant data) vs admin (fetch occurs).
   Reconciliation regression: an add-mutation flow test modeling attempt 1 timing out after a
   (mocked) server commit — the unchanged retry returns the typed duplicate 409 and the state
   machine routes through the existing duplicate state with the returned fountain id.
7. Component test for the stale banner: cached-refetch-failure renders the banner with the retry
   action and `accessibilityRole="alert"`; new-key failure renders the existing error state, not
   the banner.
8. Full mobile mirror (`./run.ps1 check -Mobile` locally for tsc/lint scope; CI for the
   React-Compiler lint and render suites), reported honestly per `testing-ci.md`.

On-device verification (owner, post-merge, tracked on #241/#244): airplane-mode mid-submit fails
fast into the outcome-unknown copy with the draft kept; retrying unchanged after a
timed-out-but-committed create lands on the created fountain via the duplicate route; an add with
data off→on shows the new pin surviving a failed refetch (banner visible); post-add detail screen
renders without a loading spinner (non-admin).

## Rollout

Normal PR gates (CI + Codex loop). Mobile-only change; no release *ordering* dependency on the
backend slices, but the backend advisory-lock/duplicate-probe invariant that the reconciliation
relies on must be pinned by the backend test specified in the sibling #242 design (cross-spec
gate above). Ships in the next mobile store release; until then verifiable in the local emulator
loop per `local-dev.md`.
