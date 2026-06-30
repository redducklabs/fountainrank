# GA4 web analytics (consent-gated, path-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load Google Analytics 4 on the **web** app only after the visitor accepts a consent
banner, only in production, only on the canonical host, sending **path-only** page views (no query
strings/fragments in `page_path`, `page_location`, or `page_referrer`).

**Architecture:** A pure helper module (`web/lib/analytics.ts`) owns all consent/env/host/id/path
logic (unit-tested locally). A small client subtree (`web/components/analytics/`) is the single
source of consent truth: `AnalyticsConsent` (coordinator) reads/writes `localStorage` fail-closed,
and conditionally mounts `GaScripts` (gtag bootstrap with `send_page_view:false` + `GaPageView`
path-only sender) and `ConsentBanner`. Wired once into the server root layout. No backend changes.

**Tech Stack:** Next.js 16 App Router (`next` 16.2.9, `react` 19.2.7); `next/script` (bundled with
`next`) + a typed `window.gtag`/`dataLayer` helper — **no `@next/third-parties`** (spec §2
refinement: it can't do consent-gated, query-string-free GA on 16.2.9); `vitest` +
`@testing-library/react` (jsdom).

## Global Constraints

- Spec: `docs/specs/2026-06-30-ga4-web-analytics-design.md` — the source of truth. Read it first.
- **No backend changes** → no `packages/api-client` regen, no pytest.
- Conventional Commits; frequent commits; one PR; squash-merge. **No AI attribution**; **no time
  estimates**.
- Windows host: file tools use **backslash** paths; the Bash tool is Git Bash (forward-slash,
  `/d/repos/fountainrank/...`). Codex's WSL adapter sees the same files at `/mnt/d/repos/...`.
- **Web local checks:** pure-logic vitest + `tsc` + `prettier` run locally; run the **full** web CI
  mirror (`./run.ps1 check -Web`: ESLint, Prettier, `tsc`, `vitest run` incl. `*.test.tsx` jsdom
  component tests, `next build`) and **record any step the Windows/WSL-artifacts environment blocks
  with its exact error** (rely on CI for that step — CI is the gate). Do **not** claim a step passed
  locally if it did not run. Run prettier on source globs (`app/** lib/** components/**`), not the
  whole dir (root `.prettierignore` excludes `.next`).
- **Privacy invariants (never regress):** GA loads only when `shouldLoadGa` is true; every GA field
  is sanitized path-only; the Measurement ID is validated before any script renders; `localStorage`
  failure is fail-closed (no GA).
- The GA Measurement ID is **public** (not a secret); do **not** write any `.env` file.

## File structure

**Web (`web/`)**
- `package.json` — **no change** (no new runtime dependency; `next/script` ships with `next`).
- `lib/analytics.ts` (new) + `lib/analytics.test.ts` (new) — pure helpers + unit tests.
- `components/analytics/GaScripts.tsx` (new) — `next/script` gtag bootstrap (`send_page_view:false`)
  + mounts `GaPageView`; renders nothing for an invalid id.
- `components/analytics/gtag.ts` (new) — typed `Window` augmentation + `sendPageView` (dataLayer push).
- `components/analytics/GaPageView.tsx` (new) — `usePathname()`-driven path-only `sendPageView`.
- `components/analytics/ConsentBanner.tsx` (new) — presentational bottom bar.
- `components/analytics/AnalyticsConsent.tsx` (new) — client coordinator (consent state, GA + banner
  gating, fail-closed persistence).
- `components/analytics/AnalyticsConsent.test.tsx`, `ConsentBanner.test.tsx`, `GaPageView.test.tsx`,
  `GaScripts.test.tsx`, `gtag.test.ts` (new) — jsdom render + `sendPageView`/dataLayer ordering tests.
- `app/layout.tsx` — render `<AnalyticsConsent />`.
- `app/privacy/page.tsx` — add "Analytics" section + bump `lastUpdated`.

**Docs**
- `docs/style-guide.md` — document the Consent banner UI element (create if absent).

---

## Phase A — pure helpers (TDD, locally verifiable)

### Task 1: Confirm dependencies (no change)

**Files:** none.

- [ ] Confirm `next/script` is importable from the installed `next@16.2.9` (it is — it ships with
  `next`). **No new runtime dependency is added** and `web/package.json` / the lockfile are
  unchanged (spec §2 refinement: `@next/third-parties` is deliberately not used). No commit.

### Task 2: `web/lib/analytics.ts` + tests (pure)

**Files:** Create `web/lib/analytics.ts`, `web/lib/analytics.test.ts`.

- [ ] **Write `analytics.test.ts` first** (TDD). Cover:
  - `parseConsent`: `"granted"`→`granted`; `"denied"`→`denied`; `null`/`undefined`/`"x"`→`undecided`.
  - `isCanonicalHost`: `fountainrank.com` & `www.fountainrank.com`→true; `localhost`, `evil.com`,
    `undefined`→false.
  - `resolveGaMeasurementId`: default `"G-BG3PYM6T43"`; `envOverride` `{NEXT_PUBLIC_GA_MEASUREMENT_ID:"G-OTHER1"}`→`"G-OTHER1"`.
  - `isValidGaMeasurementId`: `"G-BG3PYM6T43"`/`"G-ABC123"`→true; `""`, `"UA-123"`, `"G-abc"` (lowercase),
    `"G-1');alert(1)//"`, `"<script>"`→false.
  - `sanitizePagePath`: `"/x"`→`"/x"`; `"/x?a=1"`→`"/x"`; `"/x#h"`→`"/x"`; `"/leaderboard?lat=1&lng=2"`→`"/leaderboard"`;
    **and the full-URL defense** `"https://fountainrank.com/leaderboard?lat=1#x"`→`"/leaderboard"` (origin + query + fragment dropped).
  - `sanitizeUrl`: `"https://fountainrank.com/x?a=1#h"`→`"https://fountainrank.com/x"`; `""`/`null`/`"not a url"`→`""`.
  - `shouldLoadGa` and `shouldShowBanner` across the full §5.E matrix
    (`NODE_ENV`∈{development,production} × host∈{canonical,non-canonical} × consent∈{granted,denied,undecided}).
- [ ] Implement `analytics.ts`:
  - `GA_MEASUREMENT_ID_DEFAULT = "G-BG3PYM6T43"`, `CONSENT_STORAGE_KEY = "fr-analytics-consent"`,
    `CANONICAL_HOSTS = ["fountainrank.com","www.fountainrank.com"]`.
  - `type Consent = "granted" | "denied" | "undecided"`.
  - `resolveGaMeasurementId(envOverride?)` — literal-static `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID`
    access (mirror `web/lib/api.ts` `resolveApiBaseUrl`, incl. the inlining comment).
  - `isValidGaMeasurementId(id)` — `/^G-[A-Z0-9]+$/.test(id)`.
  - `parseConsent`, `isCanonicalHost`, `sanitizePagePath` (strip from first `?`/`#`; if the input is
    a full URL — contains `://` — reduce to its `URL.pathname`, defaulting to `/`),
    `sanitizeUrl` (use `new URL(...)` in a try/catch → `origin + pathname`, `""` on failure),
    `shouldLoadGa(consent,nodeEnv,hostname)`, `shouldShowBanner(consent,nodeEnv,hostname)`.
- [ ] Run locally: `node "$(ls node_modules/.pnpm/vitest@*/node_modules/vitest/vitest.mjs|head -1)" run lib/analytics.test.ts`
  from `web/`. All green. `tsc --noEmit`. Prettier on `lib/**`.
- [ ] Commit: `feat(web): analytics consent/env/host/path helpers + tests`.

---

## Phase B — GA scripts + page-view sender (client)

### Task 3: `gtag.ts` + `GaScripts.tsx` + `GaPageView.tsx` + tests

**Files:** Create `web/components/analytics/gtag.ts`, `GaScripts.tsx`, `GaPageView.tsx`,
`web/components/analytics/GaPageView.test.tsx`, `web/components/analytics/GaScripts.test.tsx`,
`web/components/analytics/gtag.test.ts`.

- [ ] `gtag.ts`: `declare global { interface Window { dataLayer?: unknown[]; gtag?: (...args:
  unknown[]) => void } }`. Module-scoped `let configuredId: string | null = null`. Export
  `type PageViewParams = { page_path; page_location; page_referrer; page_title }` (all `string`):
  - `getGtag()` — guard `typeof window === "undefined"`; `window.dataLayer = window.dataLayer || []`;
    if `typeof window.gtag !== "function"` set `window.gtag = function gtag(){ window.dataLayer!.push(arguments); }`
    (**canonical wrapper — pushes the `arguments` object, the exact shape gtag.js expects, not array
    literals**); return `window.gtag`.
  - `ensureGaConfigured(gaId: string): void` — `const gtag = getGtag()`; if `configuredId !== gaId`,
    `gtag("js", new Date())` then `gtag("config", gaId, { send_page_view: false })`; set
    `configuredId = gaId` (idempotent).
  - `sendPageView(gaId: string, params: PageViewParams): void` — guard SSR; call
    `ensureGaConfigured(gaId)` **then** `window.gtag!("event", "page_view", params)`. **Guarantees
    `js → config → page_view` order.** No `@next/third-parties` import.
  - `__resetGaConfigured(): void` — test-only; sets `configuredId = null`.
- [ ] `GaScripts.tsx` (`"use client"`): props `{ gaId: string }`. If `!isValidGaMeasurementId(gaId)`
  return `null`. A mount `useEffect` (keyed on `gaId`/`valid`) calls `ensureGaConfigured(gaId)` — a
  **plain side effect, NO `setState`** (a `ready`-state gate trips `react-hooks/set-state-in-effect`).
  Render the loader directly: `<Script id="ga-loader"
  src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`} strategy="afterInteractive" />`
  (no inline `dangerouslySetInnerHTML`), plus `<GaPageView gaId={gaId} />`. Ordering is guaranteed by
  the command queue (`sendPageView`/`ensureGaConfigured` push `config` before any `page_view`; the
  loader carries no hit; gtag.js drains in order), not by gating the loader render.
- [ ] `GaPageView.tsx` (`"use client"`): props `{ gaId: string }`. `const pathname = usePathname();`
  keep a `useRef` of the previously-sent sanitized `page_location` (init `null`). In a `useEffect`
  keyed on `pathname`: compute `path = sanitizePagePath(pathname)`, `loc = window.location.origin +
  path`, `referrer = prevRef.current ?? sanitizeUrl(document.referrer)`; call
  `sendPageView(gaId, { page_path: path, page_location: loc, page_referrer: referrer, page_title:
  document.title })`; set `prevRef.current = loc`. **Never** read `useSearchParams()`.
- [ ] `GaPageView.test.tsx` (jsdom): mock `./gtag` `sendPageView`; mock `usePathname` (incl. a
  `?`-laden value to prove stripping). Assert `sendPageView` called once with `(gaId, payload)` whose
  `page_path`, `page_location`, **and `page_referrer`** contain no `?`/`#`; a second render with a
  new pathname sends `page_referrer` = the prior sanitized `page_location`.
- [ ] `gtag.test.ts` (jsdom, helper NOT mocked; `__resetGaConfigured()` + `delete window.dataLayer`/
  `window.gtag` between cases): call `sendPageView("G-ABC123", {page_path:"/x", …})`. Each
  `window.dataLayer` entry is the `gtag()` `arguments` object (array-like) → assert **by index**:
  entry0 `[0]==="js"`, `[1]` is a `Date`; entry1 `[0]==="config"`, `[1]==="G-ABC123"`, `[2]` deep-equals
  `{send_page_view:false}`; entry2 `[0]==="event"`, `[1]==="page_view"`, `[2]` = the params — **in that
  order** (config BEFORE event). A second `sendPageView` appends only another `event`/`page_view`
  entry (no duplicate `config`).
- [ ] `GaScripts.test.tsx` (jsdom): spy on `ensureGaConfigured`; mock `GaPageView` to a sentinel and
  `next/script` to a non-`<script>` element (carrying `data-src`, to avoid `@next/next/no-sync-scripts`).
  (a) invalid `gaId` → renders nothing, `ensureGaConfigured` not called; (b) valid `gaId` → after
  mount, `ensureGaConfigured` called with `gaId` and the loader element is present with the
  `encodeURIComponent`-built `?id=`.
- [ ] Local vitest on these files (jsdom); `tsc`; prettier on `components/**`. Record any step the
  environment blocks with its exact error.
- [ ] Commit: `feat(web): GA gtag bootstrap (send_page_view off) + path-only page_view sender`.

---

## Phase C — consent banner + coordinator (client)

### Task 4: `ConsentBanner.tsx` + test

**Files:** Create `web/components/analytics/ConsentBanner.tsx`,
`web/components/analytics/ConsentBanner.test.tsx`.

- [ ] `ConsentBanner.tsx` (`"use client"`): props `{ onAccept: () => void; onDecline: () => void }`.
  Fixed bottom bar (`fixed inset-x-0 bottom-0 z-50`), `role="region"` `aria-label="Analytics
  consent"`. Short copy + a `next/link` to `/privacy` + **Accept** and **Decline** `<button type="button">`s
  wired to the callbacks. Follow existing Tailwind tokens (brand `#0C44A0`/`#0A357E`, slate text;
  see `SiteHeader.tsx`/`privacy/page.tsx`).
- [ ] `ConsentBanner.test.tsx` (jsdom): renders both buttons + the `/privacy` link + the a11y attrs;
  clicking Accept/Decline invokes the respective callback once.
- [ ] `tsc`; prettier. Commit: `feat(web): analytics consent banner (presentational)`.

### Task 5: `AnalyticsConsent.tsx` + test

**Files:** Create `web/components/analytics/AnalyticsConsent.tsx`,
`web/components/analytics/AnalyticsConsent.test.tsx`.

- [ ] `AnalyticsConsent.tsx` (`"use client"`): **no mount `useEffect`/`setState`** (the
  `react-hooks/set-state-in-effect` rule forbids it). Read both browser values via
  `useSyncExternalStore`:
  - `consent = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsent)` where
    `getServerConsent` returns `"undecided"`, `getConsentSnapshot` returns
    `parseConsent(localStorage.getItem(KEY))` (try/catch → `"undecided"` + `console.warn`), and
    `subscribeConsent` listens for a custom `fr-analytics-consent-change` event + `storage`.
  - `hostname = useSyncExternalStore(noopSubscribe, () => window.location.hostname, () => "")`.
  - Server snapshots (`"undecided"`/`""`) → both `shouldLoadGa`/`shouldShowBanner` are false → renders
    nothing on the server and the first client paint (no hydration mismatch).
  - `accept()`/`decline()`: `try { localStorage.setItem(KEY, value) } catch { console.warn(...); return }`
    — **only on success** `window.dispatchEvent(new Event("fr-analytics-consent-change"))` so the
    store re-reads. Fail-closed: a failed write leaves `localStorage` (and thus the snapshot)
    unchanged → still `"undecided"`, GA off, banner stays.
  - Render `{shouldLoadGa(consent, process.env.NODE_ENV, hostname) && <GaScripts gaId={resolveGaMeasurementId()} />}`
    and `{shouldShowBanner(consent, process.env.NODE_ENV, hostname) && <ConsentBanner onAccept={accept} onDecline={decline} />}`.
- [ ] `AnalyticsConsent.test.tsx` (jsdom). Mock `GaScripts` to a sentinel to detect mount without
  real scripts. **Two test layers (per Codex plan-review MINOR — do not only mock the gating
  helpers):**
  - **Real-helper gating (NODE_ENV via stub, real `shouldLoadGa`/`shouldShowBanner`):** stub
    `process.env.NODE_ENV` with `vi.stubEnv("NODE_ENV", …)` and set `window.location.hostname`, so
    the component passes the REAL `(consent, NODE_ENV, hostname)` into the REAL helpers. Assert:
    (i) non-prod + canonical + granted → `GaScripts` NOT mounted, no banner; (ii) prod +
    non-canonical (`localhost`) + undecided → no banner, no `GaScripts`; (iii) prod + canonical +
    undecided → banner shown; (iv) prod + canonical + granted (seed `localStorage`) → `GaScripts`
    mounted, no banner. This verifies the wiring, not just the helpers.
  - **State transitions (prod + canonical):** (a) Accept persists `"granted"` to `localStorage`,
    hides the banner, mounts `GaScripts`; (b) when `localStorage.setItem` is stubbed to throw, Accept
    does **not** mount `GaScripts` and the banner remains (fail-closed); (c) Decline persists
    `"denied"` and hides the banner.
- [ ] `tsc`; prettier. Commit: `feat(web): analytics consent coordinator (fail-closed, prod+host gated)`.

---

## Phase D — wiring, docs, verification

### Task 6: Wire into the root layout

**Files:** Modify `web/app/layout.tsx`.

- [ ] Import `AnalyticsConsent` and render `<AnalyticsConsent />` after `{children}`/`{modal}` inside
  `<body>`. Layout stays a **server** component (no `"use client"`). `tsc`; prettier.
- [ ] Commit: `feat(web): mount consent-gated GA4 in the root layout`.

### Task 7: Privacy page "Analytics" section

**Files:** Modify `web/app/privacy/page.tsx`.

- [ ] Add an `{ title: "Analytics", body: [...] }` entry to `sections` per spec §5.D (GA4;
  load-only-after-accept; **only the page path is sent — query strings stripped from address and
  referrer**; what GA collects; decline = nothing loads/no cookies; how to change the choice). Bump
  `lastUpdated` to today.
- [ ] `tsc`; prettier. Commit: `docs(web): privacy policy — analytics (GA4) section`.

### Task 8: Style guide — Consent banner element

**Files:** Modify (or create) `docs/style-guide.md`.

- [ ] If `docs/style-guide.md` exists, append a **Consent banner** entry; else create the file and
  seed it with this element. Document: purpose; bottom placement; states (shown / accepted→hidden /
  declined→hidden); Accept/Decline buttons + `/privacy` link; a11y (focusable buttons, `role`/`aria-label`,
  not a focus trap, dismissible by choosing); a short JSX snippet.
- [ ] Commit: `docs: style guide — consent banner element`.

### Task 9: Full local mirror, PR, Codex PR review, deploy

- [ ] Run `./run.ps1 check -Web` (ESLint, Prettier, `tsc`, `vitest run` incl. all new `*.test.tsx`,
  `next build`). Record any env-blocked step with its exact error; rely on CI for that step.
- [ ] Push `feat/ga4-web-analytics`; open the PR (`gh pr create`) describing the consent-gated,
  path-only design and linking the spec. **No AI attribution.**
- [ ] Get CI green. Run the **Codex PR review loop** (`claude_help/codex-review-process.md`, Loop B):
  bypass mode, WSL `cwd` `/mnt/d/repos/fountainrank`, repo-relative paths; address every finding +
  any other PR comment; loop until `VERDICT: APPROVED`.
- [ ] Squash-merge once CI green **AND** Codex `APPROVED` **AND** all comments addressed.
- [ ] **Pre-deploy gate:** confirm with the owner that GA4 Enhanced-Measurement **"Page views" is
  OFF** on stream `15178325095` (spec §3) — required before traffic can arrive.
- [ ] Deploy: `gh workflow run deploy.yml --ref main`; monitor to success.
- [ ] Post-deploy owner verification: on `https://fountainrank.com`, banner appears; Decline → no GA
  network calls / no `_ga` cookie; Accept → `gtag/js` loads and a `page_view` (path-only) is sent;
  reload persists the choice; navigate to `/leaderboard?lat=…&lng=…` and confirm the collected
  `page_path`, `page_location`, **and** `page_referrer` all carry **no** query string.

---

## Risks / watch-outs

- **`process.env.NODE_ENV` in tests** is `"test"`, not `"production"` — exercise the prod branches by
  mocking the helper functions or `NODE_ENV`, not by relying on the ambient value.
- **gtag/dataLayer ordering** — ordering is guaranteed by the **command queue**, not script timing:
  `sendPageView` calls `ensureGaConfigured` first, so `js` + `config(send_page_view:false)` precede
  any `page_view`. The external loader carries no hit on its own and gtag.js drains the data layer in
  order whenever it executes, so a loader that runs before the first command is harmless. `GaScripts`
  also calls `ensureGaConfigured` in a side-effect (no `setState` — the `react-hooks/set-state-in-effect`
  rule forbids a `ready`-state gate). Commands use the **canonical `gtag()` wrapper** (`function
  gtag(){ window.dataLayer.push(arguments); }`), not array literals, so production and tests exercise
  the exact shape gtag.js consumes. Asserted by `gtag.test.ts` + `GaScripts.test.tsx`. No
  `@next/third-parties` dep.
- **Do not** add `useSearchParams()` anywhere in the analytics subtree (it both reintroduces query
  strings and would opt routes into client rendering / Suspense requirements).
- **No `.env` writes**; the public Measurement ID lives as a source constant.
