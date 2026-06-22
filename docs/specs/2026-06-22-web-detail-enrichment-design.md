# Web detail enrichment (read-only) — design (2026-06-22)

> **Slice 6a** of the contribution-data + gamification UI track. The umbrella design is
> `docs/specs/2026-06-22-contribution-data-and-gamification-design.md`; the UX intent is
> `docs/design/gamification/{gamification-concept,design-plan-and-approach}.md`; the visual
> language is `docs/style-guide.md`. This is the first UI slice — read-only, lowest-risk —
> and it establishes the display patterns (status, attribute consensus, notes) and the
> style-guide entries that the later write/capture slices build on.

## 1. Goal

The backend for issues #38–#44 is built and deployed, but the web `FountainDetail` panel
still shows only the pre-contribution data (`is_working` chip, overall rating, per-dimension
ratings, creator `comments`, dates, Directions/Share). This slice surfaces the **new
read-only data** already present in the live API so users can actually see the richer
community signal:

1. **Operational status & trust** — `current_status` (corroboration-gated) + `last_verified_at`.
2. **Attribute consensus** — the `attributes` array (bottle filler, wheelchair reachability,
   access kind, venue type, …), grouped by category.
3. **Placement note** — `placement_note` (a short "where to find it" hint).
4. **Community notes** — `GET /fountains/{id}/notes`.

**Non-goals (explicitly out of scope for this slice):** any write action (add / rate /
verify / report / note), authentication-gated UI, optimistic updates, the map, discovery
filters, photos, and gamification surfacing (points/badges/leaderboards). Those are later
slices (6b capture, 6c filters, 6d gamification). This slice adds **display only**.

## 2. Data sources (all already live, no API change)

From `GET /api/v1/fountains/{id}` → `FountainDetail` (`backend/app/schemas.py`):

- `is_working: bool` — baseline boolean (creator-set; drives the map pin).
- `current_status: str | null` — derived community status (`app/conditions.py::derive_status`):
  `ok` / `degraded` / `not_working` require ≥ `condition_corroboration_min` distinct users
  inside `condition_freshness_days`; `reported_issue` is a recent **uncorroborated** advisory;
  `null` means not enough recent evidence to assert anything.
- `last_verified_at: datetime | null` — timestamp of the most recent `working` condition report.
- `placement_note: str | null` — ≤ 200 chars.
- `attributes: AttributeConsensusOut[]` — **only observed attributes appear** (each has a
  consensus row). Per item (`app/consensus.py::derive_consensus`):
  - `key`, `name` (friendly label), `category` (`physical` | `accessibility` | `access`; render
    **dynamically** — do not hardcode the set, a future migration may add categories/attrs).
  - `consensus_value: str | null` — winning value, or `null` when `confidence` is `none`/`mixed`.
    Boolean → `yes` | `no`; enum → one of the type's allowed values (e.g. `park`, `public`).
  - `confidence: str` — `none` (no known votes; all `unknown`), `low`, `medium`, `high`, or
    `mixed` (a tie — deliberately not filterable; `consensus_value` is `null`).
  - `latest_observation_value: str | null` — most recent non-`unknown` value, preserved for
    UI even when consensus is `mixed`/`none`.
  - `observation_count`, `yes_count`/`no_count` (boolean), `value_counts` (enum).

From `GET /api/v1/fountains/{id}/notes` → `NoteOut[]`: `{ id, body, author_display_name,
created_at, updated_at }`. Public read. `author_display_name` is the safe public name (never
the Logto subject).

## 3. Layout

The panel shell (`DetailOverlay`: mobile bottom-sheet / desktop `md:w-96` right panel) and the
existing sections (overall rating, per-dimension `<dl>`, dates, Directions/Share) are
unchanged. New/changed regions in document order:

```
Public drinking fountain                    [heading — unchanged]
┌────────────────────────┐
│ ✓ Verified working      │                 [status chip — NOW driven by current_status]
└────────────────────────┘
Last verified 3 days ago                     [trust line — NEW, from last_verified_at]

📍 Behind the playground, east entrance      [placement note — NEW, only if present]

4.2  · 18 ratings                            [overall rating — unchanged]
Clarity 4.5 (12) / Taste 3.9 (10) / …        [per-dimension — unchanged]

Features                                     [attributes — NEW, grouped by category]
 • Bottle filler        Yes
 • Dual height          Unknown   (1 report)
Accessibility
 • Wheelchair reachable Yes
Access
 • Venue type           Park
 • Public access        Yes

“Cold and high pressure.” — who added it     [creator comments — unchanged, relabeled]

Community notes                              [notes — NEW, omitted when empty]
 “Tucked behind the restroom block.”
 — Alex · 2 days ago

Added Jun 12 · Last rated Jun 20             [meta — unchanged]
[ Directions ]  [ Share ]                    [actions — unchanged]
```

### 3.1 Status chip + advisory + trust line

The **chip** carries the authoritative status; an optional **advisory line** carries an
*uncorroborated* signal without overriding the baseline; a **trust line** carries the verified
timestamp. A pure `statusDisplay(currentStatus, isWorking)` → `{ chipLabel, chipTone, advisory }`
drives it.

Chip — driven by `current_status` for the **corroborated** categories (the community truth), and
by the `is_working` **baseline** for `reported_issue` and `null`:

| `current_status` | `is_working` | Chip label | Chip color |
|---|---|---|---|
| `ok` | * | "Verified working" | emerald (`bg-emerald-100 text-emerald-800`) |
| `degraded` | * | "Working — issues reported" | amber (`bg-amber-100 text-amber-800`) |
| `not_working` | * | "Not working" | red (`bg-red-100 text-red-800`) |
| `reported_issue` | `true` | "Working" | emerald |
| `reported_issue` | `false` | "Out of order" | red |
| `null` | `true` | "Working" | emerald |
| `null` | `false` | "Out of order" | red |

`reported_issue` is a **non-flipping advisory** — `derive_status` returns it only when there is a
recent issue report but **no** corroborated category (`backend/app/conditions.py`), and the
umbrella spec is explicit that a single uncorroborated outage does not flip the status. So it must
NOT replace the baseline chip: a working fountain with one uncorroborated issue still reads
"Working", and a broken one still reads "Out of order" (otherwise the two become indistinguishable
and the baseline is lost). The uncorroborated signal is surfaced as a separate **advisory line**.

Advisory line — only when `current_status === "reported_issue"`: `text-xs text-amber-700` with a
decorative `aria-hidden` ⚠ and text "Issue reported recently — not yet confirmed". (Corroborated
`degraded`/`not_working` already carry their state in the chip, so they get no advisory line; `ok`
and `null` get none.)

The `null`/baseline rows keep **exactly today's chip** (same emerald/red classes + labels) — most
fountains have no condition reports yet, so this avoids a jarring mass restyle. The
verified-vs-unverified distinction is carried by the **label** ("Verified working" vs "Working")
and the **trust line**, never by muting/recoloring the common case.

Trust line (below the chip/advisory), `text-xs text-slate-400`:
- `last_verified_at` present → "Last verified {relative}" (e.g. "Last verified 3 days ago"), with
  a **precise day-resolution** absolute date (`formatDateFull`, see §4 — the existing coarse
  `formatDate` emits only month + year and is too imprecise) in the `title` attribute.
- `last_verified_at` null → "Not yet verified by anyone".

Rationale: `current_status` is the corroboration-gated community truth and leads for the
corroborated categories; `reported_issue` is advisory and must preserve the `is_working` baseline;
the trust line satisfies the spec's "trust stays visible" principle without inventing a
verify-count the payload does not carry.

### 3.2 Attribute consensus

Grouped by `category` (dynamic), each group a small heading (`text-xs font-semibold uppercase
tracking-wide text-slate-500`) over a list of rows (`name` left, value right). Category display
names map the raw keys to friendly headers (`physical` → "Features", `accessibility` →
"Accessibility", `access` → "Access"); an unknown future category falls back to a title-cased
key. Only observed attributes are rendered (the API already filters).

**Value + emphasis rules** (a pure `attributeDisplay(attr)` helper, unit-tested):

`attributeDisplay(attr)` returns `{ text, tone, hint }`. The friendly value formatter
(`attributeValueLabel`) is reused for both the consensus value and the latest-observation hint.

- Display text:
  - `consensus_value` non-null → friendly form: `yes`→"Yes", `no`→"No"; enum value title-cased
    with underscores → spaces (`customer_only`→"Customer only", `restroom_area`→"Restroom area").
  - `consensus_value` null & `confidence === "mixed"` → text "Mixed". **When
    `latest_observation_value` is non-null, attach `hint = "latest: {attributeValueLabel(latest)}"`.**
    The backend deliberately carries the most-recent non-`unknown` value through ties
    *specifically for UI display* (`backend/app/consensus.py`; umbrella spec example
    "mixed reports — latest: yes"), so a mixed **boolean** and a mixed **enum** must both surface
    it — rendered as a secondary muted hint, never styled as the consensus winner.
  - `consensus_value` null & `confidence === "none"` → text "Unknown" (all observations were
    `unknown`, so `latest_observation_value` is null by construction — no hint).
- Emphasis (`tone`):
  - `high`/`medium` → normal weight, `text-slate-700`, no hint.
  - `low` → `text-slate-400`, hint `(N reports)` from `observation_count` (`N === 1` →
    "(1 report)").
  - `mixed` → `text-amber-700` "Mixed", with the muted (`text-slate-400`) "latest: …" hint above.
  - `none` → `text-slate-400` "Unknown", no hint.

No raw yes/no vote tallies are shown — confidence is communicated through emphasis + the
report-count/latest hint, which keeps the panel glanceable and civic rather than spreadsheet-like.

### 3.3 Placement note

Rendered only when `placement_note` is non-null/non-empty, near the top (under the status
block) so a user can physically locate the fountain. A leading 📍 glyph (decorative,
`aria-hidden`) + the text in `text-sm text-slate-600`.

### 3.4 Community notes vs. creator comment

These are distinct backend concepts and stay visually distinct:
- The fountain's `comments` (set by whoever added it) keeps its existing single-box treatment,
  with a new `text-xs text-slate-400` caption beneath it: "From the person who added this
  fountain". (Box omitted entirely when `comments` is null, as today.)
- **Community notes** is a new section listing `NoteOut[]` (each: body, `author_display_name`,
  relative `created_at`, with "· edited" when `updated_at > created_at`). The author is rendered
  **only** from `note.author_display_name` (the backend's safe public name via
  `public_display_name`) — the web layer must never reach for a `User.display_name`/subject or any
  auth/profile object; this is asserted in the component test. When the list is empty the
  **entire section is omitted** (the "add a note" affordance arrives in slice 6b).

## 4. Architecture & data flow

- **Notes fetched server-side, in parallel with the detail.** A new
  `getFountainNotesServer(id, requestId)` in `web/lib/fountains.ts` mirrors
  `getFountainDetailServer` (typed `GET /api/v1/fountains/{fountain_id}/notes` via
  `@fountainrank/api-client`; returns `{ data, status }`, swallowing only the network-error
  case to `status: 0` exactly like the detail helper). Both the `@modal` intercepted route
  (`web/app/@modal/(.)fountains/[id]/page.tsx`) and the standalone page
  (`web/app/fountains/[id]/page.tsx`) `await` detail + notes together (`Promise.all`) and pass
  `notes` into `FountainDetail`. Notes are **non-fatal**: if the notes request fails
  (`status` not 2xx), the panel still renders with the notes section omitted. The failure is
  logged via the existing server logger with **only** `requestId`, the fountain `id`, and the
  `status` — never note bodies, author names, cookies, tokens, or raw error objects (per the
  logging/redaction standard). A notes outage must never blank the detail.
- **`FountainDetail` stays a pure presentational component**, now taking
  `{ detail, notes, now? }: { detail: Detail; notes: NoteOut[]; now?: Date }`. It uses `now` for
  all relative-time rendering, defaulting to `new Date()` at render; the optional prop is a **test
  seam** so component tests pin the clock (relative note/verification text is otherwise
  time-dependent). Output is deterministic for a given `now`.
- **New small, focused sub-pieces** (kept in the `components/fountain/` folder, split by
  responsibility):
  - `StatusBlock` — the chip + advisory line + trust line (consumes the §3.1 `statusDisplay`).
  - `AttributeList` — groups + renders attributes (consumes `attributeDisplay`).
  - `NotesList` — the community-notes section.
  These keep `FountainDetail.tsx` focused and each unit independently testable.
- **Pure helpers** added to `web/lib/map/format.ts` (the established formatter home, already
  unit-tested): `statusDisplay(currentStatus, isWorking)` → `{ chipLabel, chipTone, advisory }`
  (§3.1); `formatRelativeTime(iso, now)` → string; `formatDateFull(iso)` → precise day-resolution
  absolute date; `attributeValueLabel(value)` and `attributeDisplay(attr)` → `{ text, tone, hint }`;
  `formatCategory(key)`. All pure, all `now`-injected where time matters. (The existing coarse
  `formatDate` — month + year only — is left as-is for the unchanged meta line.)
  - `formatDateFull(iso)` → e.g. "Jun 12, 2026" (UTC, day resolution) — used for the trust-line
    `title` and the `≥ 28d` relative fallback below; precise enough for an audit/trust context.
  - `formatRelativeTime(iso, now)` buckets: `< 60s` → "just now" (also the future/skew clamp);
    `< 60min` → "N minute(s) ago"; `< 24h` → "N hour(s) ago"; `< 7d` → "N day(s) ago";
    `< 28d` → "N week(s) ago"; `≥ 28d` → `formatDateFull(iso)` (so old timestamps read precisely,
    not "13 weeks ago"). Singular/plural handled.

No new dependencies. No API/client/schema change (the generated client already exposes all
fields and the notes path).

## 5. Error handling & edge cases

- **Notes endpoint down / non-2xx** → omit the notes section, render the rest (logged with only
  `requestId`/`id`/`status`, per §4).
- **`current_status === "reported_issue"`** → baseline chip from `is_working` is preserved (never
  replaced); advisory line shown. Both `is_working` baselines covered by tests.
- **`attributes` empty** → omit the entire attributes block (no empty headings).
- **A category present but all its attrs `unknown`/`none`** → still render them muted as
  "Unknown" (transparency); the API only includes observed attributes, so the block is never
  noise.
- **`current_status` an unexpected/new string** → fall back to the `is_working` baseline chip
  (the mapping is a lookup with a default), so a future status value can't crash the panel.
- **Enum `consensus_value` with no friendly mapping** → title-case the raw value generically
  (no hardcoded enum table to drift).
- **`last_verified_at` in the future / clock skew** → `formatRelativeTime` clamps to
  "just now".
- **XSS** — all note bodies / comments / placement notes render as React text children (no
  `dangerouslySetInnerHTML`), so they are escaped by default.
- **Accessibility** — status conveyed by **text label**, not color alone (colorblind-safe,
  matching the existing pin design); new headings use real heading/`<dl>` semantics; the
  focus-trap/Escape behavior of `DetailOverlay` is unchanged.

## 6. Testing (mirrors the existing vitest patterns)

- **`lib/map/format.test.ts`** (extend): `statusDisplay` across every row — `ok`/`degraded`/
  `not_working`, **`reported_issue` for BOTH `is_working` baselines** (chip stays "Working" /
  "Out of order" *and* advisory is set), the `null` baselines, and an unexpected status (defaults
  to the `is_working` baseline, no crash); `formatRelativeTime` (seconds/min/hours/days/weeks,
  future-clamp to "just now", and the `≥28d` → `formatDateFull` fallback); `formatDateFull`
  precision; `attributeDisplay` for boolean yes/no, low-confidence `(N reports)` hint, **`mixed`
  boolean AND `mixed` enum both surfacing `latest: …`**, `none` → "Unknown" (no hint), and enum
  title-casing; `formatCategory` incl. unknown-key fallback.
- **`components/fountain/FountainDetail.test.tsx`** (extend): render with a **pinned `now` prop**
  (fixed clock) so relative text is deterministic. Assert: status chip from `current_status`
  (incl. the `null` baseline fallback); `reported_issue` shows the baseline chip **plus** the
  advisory line (both `is_working` baselines); the trust line's visible relative text **and** its
  precise `title` date are asserted separately; shows/omits the placement note; grouped attributes
  with correct values/emphasis incl. a `mixed` "latest: …" hint; community notes render with the
  author taken from `author_display_name`, and the section is **omitted** when `notes` is `[]`;
  all existing assertions stay green.
- **`lib/fountains.test.ts`** (extend): `getFountainNotesServer` happy path + non-2xx +
  network-error (`status: 0`) shapes (mirror the existing `getFountainDetailServer` tests).
- Full local mirror before PR: `./run.ps1 check -Web` (eslint + prettier + tsc + vitest +
  next build) **and** rely on CI's `workspace-js` job.

## 7. Style guide

Add to `docs/style-guide.md` under "Detail overlay": the **status chip + advisory line + trust
line** (the `current_status`→chip mapping, the baseline-preserving `reported_issue` advisory, and
the trust line), the **attribute consensus group** (category heading + row, value emphasis tiers,
the `mixed` "latest" hint), and the **community notes list**. Update the existing "Detail overlay
→ Content" table to reflect the new sections. (House rule: document UI elements as they are
added.)

## 8. Out of scope / follow-ups

- Write actions on the detail (rate / verify / report / add-note) → **slice 6b** (capture).
- Discovery filter controls → **slice 6c**.
- Profile / badges / leaderboard surfacing → **slice 6d**.
- Photos → not yet modeled.
- Mobile → after the base mobile app exists.
