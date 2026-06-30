# GA4 web analytics (consent-gated) — design

**Status:** owner-approved 2026-06-30; **Codex spec review APPROVED** (round 3). Subsequently
amended during *plan* review (owner-confirmed): dropped `@next/third-parties` for a `next/script` +
typed-`gtag` bootstrap with config-first dataLayer ordering (§2/§4/§5.C).
**Driver:** owner directive (handoff `handoffs/2026-06-30-display-name-merged-ga4-next-handoff.md`,
§"NEXT SESSION #2") — add Google Analytics 4 to the **web** app. Mobile GA is a later, separate
effort and is **out of scope** here.
**Scope:** web only (`web/`). **No backend changes** → no `packages/api-client` regen.

---

## 1. Goal

Measure web traffic with **Google Analytics 4**, loaded **only after the visitor accepts** an
analytics consent banner, **only in production**, and **only on the canonical FountainRank host**.
Concretely:

1. GA4 is wired into the web app via `next/script` (the core Next script primitive) + a typed gtag
   helper (see §2 refinement; `@next/third-parties` does not fit the privacy requirement).
2. A bottom **consent banner** (Accept / Decline, with a link to `/privacy`) gates loading: GA is
   **not loaded at all** until the visitor accepts. Decline → nothing loads, no GA cookies.
3. The choice persists in `localStorage` and survives reloads (**fail-closed**: if persistence
   fails, GA does not load).
4. **Only sanitized path-only values reach GA** — `page_path`, `page_location`, **and
   `page_referrer`** all have query strings + fragments stripped, so approximate location and other
   query params never reach Google.
5. Local `next dev` and non-canonical hosts (forks, previews) **never** load GA (no polluting the
   production property; no dev banner).
6. The privacy policy documents what GA collects and that it is consent-gated.

## 2. Owner-approved decisions (captured verbatim from the handoff)

Two product decisions were made by the owner via AskUserQuestion in the prior session and approved
("looks good", 2026-06-30):

- **Separate branch / PR** — GA4 ships on its own branch, not bundled with other work.
- **Consent banner, load-only-after-accept** — *not* load-for-everyone, and *not* Google
  Consent-Mode "denied pings". The simpler, more privacy-respecting model: **GA is not loaded until
  consent is `granted`.**

Open follow-ups flagged for owner confirmation during this review (not blockers; see §8): exact
banner copy; whether "Decline" is re-promptable later; whether to emit GA events for key actions
(default: **page_view only** for v1, YAGNI).

**Refinement to the approved design — owner-confirmed 2026-06-30 (see §4/§5.C):** the approved
design said "Add `@next/third-parties` and render its `GoogleAnalytics` component." Codex verified
against `@next/third-parties@16.2.9` that this library **cannot** meet our privacy requirement:
(1) its `<GoogleAnalytics>` runs `gtag('config', gaId)` with the default `send_page_view: true`,
sending the **full landing URL incl. query strings** at load (the leaderboard `?lat/lng` approximate
location), and exposes **no** flag to disable it; (2) its `sendGAEvent` reads a module-scoped
`currDataLayerName` that is **only set when `<GoogleAnalytics>` renders**, so it no-ops ("GA has not
been initialized") without the leaking component. We therefore **drop `@next/third-parties`** and use
**`next/script`** (the core Next primitive `@next/third-parties` itself wraps) to bootstrap gtag with
`send_page_view: false`, plus our own **typed `window.gtag`/`dataLayer`** page-view helper. No new
runtime dependency; full control; no query-string leak.

## 3. GA4 stream + required GA-Admin configuration

**Stream (provided by owner):**
- Stream Name: **FountainRank Web** · URL: **https://fountainrank.com**
- Stream ID: **15178325095** · **Measurement ID: `G-BG3PYM6T43`**
- The Measurement ID is **public** by design (GA4 IDs are exposed in client HTML) — **not a secret**.
  It is committed as a default constant in source; no `.env` write is needed.

**Owner GA-Admin checklist (one-time, done in the GA4 console — required for correct + private
behavior; this is a PRE-DEPLOY prerequisite — confirmed off BEFORE the production deploy, see §9):**
- In the stream's **Enhanced Measurement**, **turn OFF "Page views"**. We send our **own** sanitized
  (path-only) `page_view` on every route change; leaving Enhanced Measurement page views on would
  (a) re-introduce full URLs incl. query strings into GA and (b) double-count navigations.
- No other Enhanced Measurement signal is required for v1. (Scrolls/outbound clicks/etc. may stay at
  GA defaults; none are relied upon.)

This checklist is reproduced in the implementation plan and the **pre-deploy** owner steps (§9).

## 4. What exists / what changes

**Exists (no rework):**
- `web/app/layout.tsx` — minimal **server** root layout (renders `{children}` + `{modal}`); no
  analytics today.
- `web/lib/api.ts` — `resolveApiBaseUrl()` is the **default-plus-`NEXT_PUBLIC_*`-override** pattern
  we mirror, including its comment on why a **literal static** `process.env.NEXT_PUBLIC_…` access is
  required (Next inlines literal member access; bracket/aliased access is **not** statically
  replaced and silently yields `undefined` in the browser).
- `web/app/privacy/page.tsx` — privacy policy built from a `sections` array (title + `body[]`).
- Pure helpers live in `web/lib/<name>.ts` with a co-located `web/lib/<name>.test.ts`
  (e.g. `return-path.ts` + `return-path.test.ts`); client components live in `web/components/`
  (e.g. `AuthControl.tsx`), with co-located `*.test.tsx` render tests that run under jsdom in
  `vitest` (`web/vitest.config.ts` globs `**/*.test.tsx`; see `web/components/AuthControl.test.tsx`).
- **No CSP / security-headers / middleware** exist in the web app (`next.config.ts` has none, no
  `middleware.ts`), so GA's third-party scripts load with no allowlist change.
- Query params in play (must NOT reach GA): `web/app/leaderboard/page.tsx` reads `lat`/`lng`
  (approximate map location) + `scope`/`sort`; `web/app/page.tsx` reads `?add=1`; `AuthControl`
  builds return paths from pathname+query.

**Next version:** `next` `16.2.9`, `react` `19.2.7`. We use `next/script` (bundled with `next`) and
add **no** new runtime dependency (`@next/third-parties` is deliberately not added — §2 refinement).

**GA wiring (`next/script` loader + typed gtag helper — see §2 refinement; no `@next/third-parties`):**
```tsx
import Script from "next/script";
// helper uses the CANONICAL gtag() wrapper (pushes its `arguments`, exactly like Google's snippet):
//   getGtag():   window.dataLayer = window.dataLayer || [];
//                window.gtag ||= function gtag(){ window.dataLayer.push(arguments); };  // creates the layer
//   ensureGaConfigured(gaId):  gtag('js', new Date()); gtag('config', gaId, { send_page_view:false }); // once
//   sendPageView(gaId, p):     ensureGaConfigured(gaId); gtag('event','page_view', p);  // config FIRST
// loader (next/script) is rendered ONLY AFTER ensureGaConfigured has run (gated by a `ready` state),
// so window.dataLayer + js + config exist before gtag.js loads:
//   <Script src="https://www.googletagmanager.com/gtag/js?id=<gaId>" />   // gaId via encodeURIComponent
```
`next/script` (already shipped with `next`) is the same primitive `@next/third-parties` wraps, so we
keep the official script-loading optimization without the leaking component or its `sendGAEvent`
initialization coupling. **There is no inline `dangerouslySetInnerHTML` script** — the data layer,
the `gtag` queue function, and the `js`/`config`/`event` commands are all established from typed JS
via the canonical `gtag()` wrapper, `config` always queued before the first `page_view`, and the
external loader is rendered only after that setup (matching Google's "establish the data layer before
loading the tag" guidance; gtag.js then drains the queue in order). Our helper creates the default
`window.dataLayer` and disables the
config-time page view; **our** typed `sendPageView` helper (§5.C) pushes a sanitized `page_view`.
GA4 **Enhanced Measurement "Page views"** is disabled GA-Admin-side (§3) so no unsanitized
history-event duplicates are added.

## 5. Design

### A. Pure helpers — `web/lib/analytics.ts` (unit-tested locally)

All env/consent/host/path logic lives in **pure functions** so it is testable without a DOM:

- `GA_MEASUREMENT_ID_DEFAULT = "G-BG3PYM6T43"`.
- `CONSENT_STORAGE_KEY = "fr-analytics-consent"`.
- `CANONICAL_HOSTS = ["fountainrank.com", "www.fountainrank.com"]`.
- `resolveGaMeasurementId(envOverride?): string` — `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ??
  GA_MEASUREMENT_ID_DEFAULT`, via a **literal static** `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID`
  access (mirrors `resolveApiBaseUrl`; `envOverride` only for tests).
- `isValidGaMeasurementId(id: string): boolean` — matches the GA4 pattern `^G-[A-Z0-9]+$`. The
  `NEXT_PUBLIC_GA_MEASUREMENT_ID` override is **validated** against this before any script renders or
  any `config` is queued; an invalid ID → GA does not load (treated like "no ID"). Defense-in-depth:
  the ID flows into the loader **script URL** (built with `encodeURIComponent`) and into the
  `dataLayer` `config` entry as a plain JS value (no string-interpolated inline script — see §5.C).
- `type Consent = "granted" | "denied" | "undecided"`.
- `parseConsent(raw: string | null | undefined): Consent` — `"granted"`→`granted`,
  `"denied"`→`denied`, else (`null`/unknown)→`undecided`.
- `isCanonicalHost(hostname: string | undefined): boolean` — `hostname ∈ CANONICAL_HOSTS`.
- `shouldLoadGa(consent, nodeEnv, hostname): boolean` — `true` **iff** `consent === "granted"` **and**
  `nodeEnv === "production"` **and** `isCanonicalHost(hostname)`.
- `shouldShowBanner(consent, nodeEnv, hostname): boolean` — `true` **iff** `consent === "undecided"`
  **and** `nodeEnv === "production"` **and** `isCanonicalHost(hostname)`.
- `sanitizePagePath(pathname: string): string` — returns the pathname only, **guaranteeing no query
  string or fragment** (drops anything from the first `?` or `#`; defends against a caller passing a
  full URL). This is what we send to GA as `page_path`.
- `sanitizeUrl(raw: string | null | undefined): string` — for `page_location`/`page_referrer`:
  parses `raw` and returns **`origin + pathname` only** (query + fragment dropped); returns `""` for
  empty/unparseable input. Used so neither the current location nor the referrer can carry a query
  string to GA.

`process.env.NODE_ENV` is inlined by Next in the client bundle (`"production"` in a prod build).
Gating the **banner** on production+canonical-host too means dev/forks never show it and there is
nothing to consent to off the canonical site — consistent with "dev/forks never load GA".

### B. Consent coordinator + banner — `web/components/analytics/`

A small **client** subtree, the single source of truth for consent state (no custom-event plumbing):

- `AnalyticsConsent.tsx` (client, `"use client"`):
  - **SSR-safe via `useSyncExternalStore`** (not a mount `useEffect`+`setState`, which the project's
    `react-hooks/set-state-in-effect` lint rule forbids): the persisted consent and the hostname are
    read through `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` where the **server
    snapshots are `"undecided"`/`""`** → the server and first client paint both render nothing (no
    hydration mismatch), and the client snapshot reads `localStorage[CONSENT_STORAGE_KEY]` (via
    `parseConsent`) and `window.location.hostname`. The consent store subscribes to a custom
    `fr-analytics-consent-change` event + `storage`.
  - `accept()` / `decline()` — **fail-closed persistence:** `localStorage.setItem(key, value)` inside
    try/catch; **only on success** dispatch the change event (which makes `useSyncExternalStore`
    re-read the new value). On failure: `console.warn` and do nothing — `localStorage` is unchanged,
    so the snapshot is still `"undecided"`, GA does **not** load, and the banner remains (a privacy
    gate must not start tracking on an unpersisted accept; an unpersisted decline simply re-prompts).
  - All `localStorage` access wrapped in try/catch (private-mode/disabled storage → treated as
    `undecided`, `console.warn`, never throws).
  - Renders `{shouldLoadGa(consent, process.env.NODE_ENV, hostname) && <GaScripts
    gaId={resolveGaMeasurementId()} />}` (which mounts the gtag bootstrap + the page-view sender).
  - Renders `{shouldShowBanner(consent, process.env.NODE_ENV, hostname) && <ConsentBanner
    onAccept={accept} onDecline={decline} />}`.
- `ConsentBanner.tsx` (client, presentational) — a fixed **bottom bar**: short copy + a `/privacy`
  link + **Accept** / **Decline** `<button>`s calling `onAccept`/`onDecline`. a11y: real buttons,
  keyboard-focusable, `role="region"` + `aria-label="Analytics consent"`; does not trap focus or
  block the page.

`web/app/layout.tsx` (stays a **server** component) renders `<AnalyticsConsent />` after
`{children}`/`{modal}`.

### C. GA bootstrap + sanitized, path-only page views — `web/components/analytics/GaScripts.tsx`

**Requirement:** GA receives **only the URL path** — never query strings or fragments. The
leaderboard `?lat/lng` (approximate location), `?add=1`, and return-path query strings must never be
sent to Google.

- `GaScripts.tsx` (client) renders **nothing** unless `isValidGaMeasurementId(gaId)` (§5.A). When
  valid it: (a) in a mount `useEffect`, calls `ensureGaConfigured(gaId)` — a **plain side effect, no
  `setState`** (the `react-hooks/set-state-in-effect` rule forbids a `ready`-state gate) — which
  establishes the data layer + queues `js` + `config`; (b) renders the loader `<Script
  src={`…/gtag/js?id=${encodeURIComponent(gaId)}`} strategy="afterInteractive" />` directly; and (c)
  renders `<GaPageView gaId={gaId} />`. **Ordering** is guaranteed by the command queue, not script
  timing: `sendPageView`/`ensureGaConfigured` always push `config` before any `page_view`, the loader
  alone sends no hit, and gtag.js drains the data layer in order whenever it executes. No inline
  `dangerouslySetInnerHTML`.
- `gtag.ts` (client helper, `web/components/analytics/gtag.ts`) — owns the `Window` augmentation
  (`dataLayer?`, `gtag?`) and the **canonical `gtag()` wrapper** (pushes its `arguments`, exactly the
  shape gtag.js expects — not array literals), and **guarantees config precedes the first event**:
  - `getGtag()` — `window.dataLayer = window.dataLayer || []`; defines `window.gtag` once as
    `function gtag(){ window.dataLayer.push(arguments); }`; returns it.
  - `ensureGaConfigured(gaId)` — **once** (module-scoped guard) `gtag("js", new Date())` then
    `gtag("config", gaId, { send_page_view: false })`.
  - `sendPageView(gaId, params)` — calls `ensureGaConfigured(gaId)` **then** `gtag("event",
    "page_view", params)`. So the dataLayer order is always `js → config → page_view`, regardless of
    when the loader executes (gtag.js drains in order on load).
  - This is **our** code — no `@next/third-parties` module-state dependency; `gaId` is a plain JS
    value passed to `gtag()` (no HTML interpolation). A test-only `__resetGaConfigured()` resets the
    guard between tests.
- `GaPageView.tsx` (client) — props `{ gaId: string }`; uses **`usePathname()` only** (deliberately
  **not** `useSearchParams()`); keeps the previously-sent sanitized location in a ref, and on each
  pathname change (incl. initial mount) calls `sendPageView(gaId, { ...payload })` where the payload
  is **fully sanitized**:
  - `page_path: sanitizePagePath(pathname)`
  - `page_location: window.location.origin + sanitizePagePath(pathname)`
  - `page_referrer:` the **previous** sanitized `page_location` for in-app navigations, or
    `sanitizeUrl(document.referrer)` on the first hit (external referrer with its query/fragment
    stripped) — so **no field, including the referrer, can carry a query string**. (We set
    `page_referrer` explicitly rather than letting gtag fall back to the raw `document.referrer` or a
    prior unsanitized virtual-page URL.)
  - `page_title: document.title`
- With `send_page_view: false` (no config-time page view) **and** Enhanced-Measurement "Page views"
  off GA-Admin-side (§3), `GaPageView` is the **single** source of page views — no leak, no
  double-count.
- Tests: unit tests assert `sanitizePagePath`/`sanitizeUrl` strip `?…`/`#…` and `isValidGaMeasurementId`
  accepts `G-…`/rejects junk; a render test asserts the page_view payload's `page_path`,
  `page_location`, **and `page_referrer`** contain no `?`/`#`; and an integration test (see §6)
  proves `sendPageView` produces the **dataLayer order `js → config(send_page_view:false) → page_view`**
  for the first hit (and does not re-push `config` on the second hit).

### D. Privacy page — `web/app/privacy/page.tsx`

Add an **"Analytics"** section (new `sections` entry) covering: we use **Google Analytics 4**; it is
**loaded only after you accept** the consent banner; we send **only the page path** — query strings
are stripped from the page address **and the referrer** before sending, so map location and similar
are not shared; GA collects standard usage data (device, approximate location derived by Google from
IP, pages viewed) to understand aggregate usage; declining means it never loads and sets no cookies;
you can change your choice by clearing the site's stored choice. Bump `lastUpdated`.

### E. Production + canonical-host gating (summary)

| `NODE_ENV`   | host          | consent     | GA loads? | banner shows? |
|--------------|---------------|-------------|-----------|---------------|
| development  | any           | any         | no        | no            |
| production   | non-canonical | any         | no        | no            |
| production   | canonical     | undecided   | no        | **yes**       |
| production   | canonical     | granted     | **yes**   | no            |
| production   | canonical     | denied      | no        | no            |

### F. Style guide — `docs/style-guide.md`

Document the **Consent banner** as a new UI element (mandatory before any new UI element): purpose,
bottom placement, states (**shown** / **accepted→hidden** / **declined→hidden**), Accept/Decline
buttons + `/privacy` link, a11y (focusable buttons, not a focus trap, dismissible by choosing). If
`docs/style-guide.md` does not yet exist, create it and seed it with this element.

## 6. Testing & verification

Per `claude_help/testing-ci.md`, the **full web CI mirror is run locally before the PR** —
`./run.ps1 check -Web` (ESLint, Prettier on source globs, `tsc --noEmit`, `vitest run` for **all**
web tests incl. the new `*.test.tsx` component tests under jsdom, and `next build`). CI remains the
gate.

- **Pure unit tests (`web/lib/analytics.test.ts`)** cover every helper: `parseConsent`
  (granted/denied/null/garbage), `isCanonicalHost`, `shouldLoadGa` + `shouldShowBanner` across the
  full §5.E matrix (NODE_ENV × host × consent), `resolveGaMeasurementId` (default + override),
  `isValidGaMeasurementId` (accepts `G-…`, rejects junk/`<script>`/empty), `sanitizePagePath`
  (strips query/fragment, passes clean paths), and `sanitizeUrl` (origin+path only, `""` for
  empty/garbage).
- **Component render tests (`web/components/analytics/*.test.tsx`, jsdom):** `ConsentBanner` renders
  the buttons + `/privacy` link + a11y attrs and invokes the callbacks; `AnalyticsConsent` returns
  `null` before mount (SSR safety), shows the banner only when `shouldShowBanner` is true, and on
  accept persists + flips to loading GA (and on a thrown `setItem`, stays fail-closed: no GA, banner
  remains); `GaScripts` renders nothing for an invalid `gaId`; `GaPageView` calls `sendPageView` with
  `page_path`, `page_location`, **and `page_referrer`** all free of `?`/`#` (`sendPageView` mocked).
- **Integration test (jsdom):** call our real `sendPageView(gaId, {…})`
  (`web/components/analytics/gtag.ts`) against a fresh `window` (`__resetGaConfigured()` first) and
  assert `window.dataLayer` entries — each a `gtag()` `arguments` object, read by index — are, **in
  order**, `[0]="js"`, then `["config", gaId, {send_page_view:false}]`, then
  `["event","page_view",{…}]` (config before the event), and that a second call appends only another
  `page_view` (no duplicate `config`). No dependency on `@next/third-parties` module state.
- **Environment caveat (honest):** on this Windows host with Codex's WSL-built `node_modules`
  ([[fountainrank-windows-wsl-local-check-workarounds]]), specific mirror steps may not run cleanly
  locally. The plan/PR will **run what runs and record any step that the environment blocks with its
  exact error**, relying on CI for that step — never silently skipping. The new pure + component
  vitest tests are expected to run locally and will be run, not punted.
- No backend changes → **no api-client regen**, no pytest impact.

## 7. Security & privacy

- **No secret introduced** — the Measurement ID is public; committing it as a default is correct.
- **Data minimization** — only path-only `page_view` reaches GA; query strings + fragments (incl.
  approximate location) are stripped from `page_path`, `page_location`, **and `page_referrer`**
  (§5.C). We pass no user identifiers to GA.
- **Script-injection hardening** — there is **no inline `dangerouslySetInnerHTML`** at all (config is
  pushed to `dataLayer` as a plain JS value). The Measurement ID (incl. any
  `NEXT_PUBLIC_GA_MEASUREMENT_ID` override) is validated against `^G-[A-Z0-9]+$` before anything
  loads, and the only place it enters markup — the loader `src` — is `encodeURIComponent`-escaped
  (§5.A/§5.C).
- **Scope containment** — GA loads only on `NODE_ENV==="production"` **and** a canonical host
  (`fountainrank.com`/`www.fountainrank.com`), so forks, previews, and local `next build && next
  start` do **not** send traffic into the owner's property. A self-hoster who wants their own
  analytics overrides `NEXT_PUBLIC_GA_MEASUREMENT_ID` and edits `CANONICAL_HOSTS`.
- **Third-party scripts** — our `next/script` gtag bootstrap loads `googletagmanager.com` /
  `google-analytics.com` only after consent. No CSP exists today (no allowlist change needed); if a
  CSP is added later it must permit those origins (noted; out of scope).
- **Privacy-respecting by construction** — no GA cookies or network calls before `granted`, and a
  failed persistence stays fail-closed (no tracking). Stronger than Consent-Mode denied-pings.
- **Logging** — the only diagnostics are `console.warn` on `localStorage` failure; no secrets/PII
  logged (matches existing web client code, which has no structured-logging stack).

## 8. Out of scope / future (YAGNI for v1)

- GA custom **events** (sign-in, add-fountain, rate) — page_view only for v1.
- **Mobile** GA — separate later effort.
- A footer **"cookie settings"** re-prompt to revisit a decline (clear the stored key → banner
  returns) — revisit with owner.
- A **CSP** for the web app — none exists today; if added, allow the GA origins.

## 9. Delivery & process

Per `CLAUDE.md` + `claude_help/codex-review-process.md`:

Branch `feat/ga4-web-analytics` (off `main` = `d8d2ea1`) → **this spec** → Codex spec review loop
(APPROVED) → plan `docs/plans/2026-06-30-ga4-web-analytics.md` → Codex plan review loop (APPROVED) →
implement → full local web CI mirror (`./run.ps1 check -Web`, recording any env-blocked step) → PR →
**CI green AND Codex PR `VERDICT: APPROVED` AND every PR comment addressed** → squash-merge →
**owner GA-Admin prerequisite FIRST: confirm Enhanced-Measurement "Page views" is OFF on the stream
(§3)** → only then `gh workflow run deploy.yml --ref main` → post-deploy live verification. The
GA-Admin privacy setting is a **pre-deploy gate**, never post-deploy cleanup: if it were still on
when code reaches production, an accepting user could trigger Google's automatic (unsanitized)
page-view/history measurement before it is flipped. No AI attribution; no time estimates.

## 10. File inventory (planned)

| File | Change |
|---|---|
| `web/package.json` | **no new runtime dep** — uses `next/script` (ships with `next`) |
| `web/lib/analytics.ts` | **new** — pure consent/env/host/id/path helpers |
| `web/lib/analytics.test.ts` | **new** — unit tests (local) |
| `web/components/analytics/AnalyticsConsent.tsx` | **new** — client coordinator (consent state + GA + banner) |
| `web/components/analytics/ConsentBanner.tsx` | **new** — client presentational bottom bar |
| `web/components/analytics/GaScripts.tsx` | **new** — `next/script` gtag bootstrap (`send_page_view:false`) + mounts `GaPageView` |
| `web/components/analytics/gtag.ts` | **new** — typed `Window` augmentation + `sendPageView` (dataLayer push) |
| `web/components/analytics/GaPageView.tsx` | **new** — client sanitized path-only page_view sender |
| `web/components/analytics/*.test.tsx` | **new** — JSX render + integration tests (jsdom) |
| `web/app/layout.tsx` | render `<AnalyticsConsent />` |
| `web/app/privacy/page.tsx` | add "Analytics" section + bump `lastUpdated` |
| `docs/style-guide.md` | document the Consent banner element (create if absent) |
