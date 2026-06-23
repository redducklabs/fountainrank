# Mobile slice 6e-4 — fountain detail + public reads Implementation Plan

> **Execution aid (optional, Claude-Code only):** when run by Claude Code, `superpowers:subagent-driven-development` or `superpowers:executing-plans` can drive this plan task-by-task. This is not a repo standard and not required — any agent may implement the tasks below directly. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `app/fountains/[id].tsx` _placeholder_ with the real fountain **detail screen** — fed by two **public** reads (`GET /api/v1/fountains/{fountain_id}` → `FountainDetail` and `GET /api/v1/fountains/{fountain_id}/notes` → `NoteOut[]`) — rendering the rating summary, per-dimension ratings, operational status, access/feature attributes, placement context, the adder's comments, community notes, and last-verified/added/last-rated timestamps. Unknown/missing values are shown **honestly** (never implying false certainty); the screen offers **pull-to-refresh + retry**; a missing fountain or invalid route id shows an honest **"not found"** state; a notes-fetch failure shows a small **non-blocking error row** (not silent disappearance); and returning from detail **preserves the map's context** (region/filters/results) because the map screen stays mounted under the stack push. All green on the local CI mirror.

**Architecture:** The 6e-1/6e-2/6e-3 split holds — **pure, unit-tested modules** (zero RN/Expo imports, Vitest `node`) carry the **display/transform logic**, and a **thin, untested shell** owns the **wiring** (query composition, navigation, refresh, and notes/invalid-id error policy) and is covered by `tsc` + ESLint + `expo-doctor`. For 6e-4 the pure core is the **display formatters** (mirroring the already-shipped, already-reviewed `web/lib/map/format.ts`), a small **attribute-grouping** helper, a **note-edited** flag helper, and an **API-error-status** helper for honest 404 handling. The shell is the four detail components + the screen. **No new native dependency, no config plugin, no CNG change** — 6e-4 is pure TypeScript/React on top of 6e-3's stack, so it tops out at the **Local CI** proof level (it does _not_ need a device).

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19.2, TypeScript 6 (strict), Expo Router (stack), `@tanstack/react-query@5.101.0`, `@fountainrank/api-client` (openapi-fetch) via the `createApiClient` facade, Vitest 4.1.9 (node env), Turbo, pnpm workspace. **No deps added in this slice.**

**Spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` (Codex-approved umbrella). This plan implements **slice 6e-4** from spec §18, realizing **§15 Phase 4** (render detail via the generated client + existing backend contract; show rating summary, dimensions, operational status, access attributes, placement context, notes, last-verification where present; handle missing/unknown values without false certainty; refresh/retry; preserve map context on return) and honoring **§14** (no dev-auth seam — reuse `createApiClient`; reads are public, no `Authorization`), **§21** (auth-unavailable mode unchanged — no signed-in UI, no write actions; proof level = **Local CI**), and the **Logging & Observability** standard (no token/PII logging; the detail screen logs nothing sensitive). Read §15 Phase 4, §18 (6e-4 row), §21 before starting.

**Reference (mirror, do not reinvent):** the web detail UI is already built, reviewed, and merged. Mirror its **informational** content and its **pure formatters** nearly verbatim:

- Formatters → `web/lib/map/format.ts` (`formatAverage`, `formatVotes`, `formatDimension`, `formatDate`, `statusDisplay`/`StatusTone`/`StatusDisplay`, `formatDateFull`, `formatRelativeTime`, `attributeValueLabel`, `attributeDisplay`/`AttrTone`/`AttributeDisplay`, `formatCategory`) and its test `web/lib/map/format.test.ts`.
- Components → `web/components/fountain/FountainDetail.tsx`, `StatusBlock.tsx`, `AttributeList.tsx`, `NotesList.tsx` (translate Tailwind/JSX → RN `StyleSheet`/`View`/`Text`).
- The web client fetches detail+notes via `web/lib/fountains.ts` server helpers (`getFountainDetailServer`/`getFountainNotesServer`) and **logs a warning** when notes fail before falling back to `[]`; the **mobile** client instead calls `createApiClient().GET(...)` directly through the `useApi()` provider — there is no server/client boundary on mobile — and surfaces a notes-fetch failure as a small on-screen error row (mobile's analog of the web warning).

---

## Global Constraints

- **No AI attribution** in commits/PRs; **no time estimates** anywhere. Conventional Commits; frequent commits; one task at a time; **squash-merge** only.
- **All shell commands below run from the repo root** and use **repo-relative paths** — no absolute repo root is hard-coded. If a shell's cwd has drifted, `cd` back to the repo root first.
- **Claude Code runs on Windows:** file tools use backslash paths (`...\mobile\...`); the Bash tool is Git Bash (forward slashes). Run the task runner as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>` (no `pwsh`). Any path handed to **Codex** in a review prompt must be **repo-relative**; the Codex MCP `cwd` is **derived** from the current repo root (`D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`), never hard-coded.
- **No dependency change in this slice** → no `mobile/package.json`/`pnpm-lock.yaml` edits, no `expo install`, no prebuild/`expo config` step. (If a clean reinstall is ever needed after a Codex WSL run, it is the standing one: `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`.)
- **🔑 Verify-the-exact-tree-you-commit.** For every task: write code → `pnpm exec prettier --write` the touched files → run the relevant check → **commit with no edits in between**, so the verified tree is byte-for-byte the committed tree. The mobile check does NOT run Prettier, so a check run before formatting verifies a tree you will not commit. Format `docs/**` files **explicitly** (they are outside the `{web,mobile,packages}/**` format:check glob). Keep wrapped lines that begin with `+ ` off (Prettier reads a leading `+ ` in markdown as a bullet).
- **`git add` is atomic:** a non-matching pathspec aborts the whole `git add`, silently leaving an incomplete commit. Stage only existing paths; verify each commit with `git show --stat HEAD`.
- **Scoped mobile Turbo checks run `generate` first** (needs backend `uv`). If a scoped mobile check fails _inside `generate`_, run `uv sync` in `backend/` (or `./run.ps1 bootstrap`) — that's a backend-deps problem, not a Vitest failure. A regenerated `packages/api-client/src/schema.d.ts` is usually a no-op diff — don't stage it accidentally.
- **Local mirror gates the PR:** the **full** `./run.ps1 check` (backend + workspace-js + web build + mobile) must be green on the **final committed tree** before the PR. Mid-loop, scope to mobile: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile` (lint + typecheck + vitest + expo-doctor); add `-Fast` to skip expo-doctor for quick inner loops. Per-mobile-file test: `pnpm --filter mobile exec vitest run lib/<path>.test.ts`.

**Security / standards (spec §14, §21) — binding:**

- **No dev-auth seam on mobile, ever (§14).** Both reads go through the existing `createApiClient` facade obtained from `useApi()` — never a raw `makeClient`/`openapi-fetch` client, never an `X-Dev-*` header. Detail + notes are **public** (no auth required) — no `Authorization` header is sent in this slice.
- **Auth-unavailable mode unchanged (§21).** 6e-4 adds **no** auth code and **no** signed-in actions. The web detail's **contribution** surfaces (`ContributeSection`/`RatingForm`/`ConditionForm`/`NoteForm`) are **out of scope** — they are write actions gated behind auth and land in 6e-5/6e-6. `isAuthConfigured` is untouched.
- **No token/PII logging (§20/§14).** The detail screen logs nothing sensitive — no full API payloads, no precise coordinates.
- **Proof level = Local CI (§21).** This slice's gate is type-check + lint + `expo-doctor` + unit tests. CI does **not** run Metro, a device, or render the screen. **PR and handoff wording must say "compiles, lints, type-checks, unit-tested" — never "the detail screen renders / works on device."** (6e-4 reaches Local CI; it does not need a Native build.)

**Scope boundaries (deferred, consistent with spec §18 — not deviations):**

- **Contribution / write actions** (rate, report condition, add note) → **6e-5/6e-6.** 6e-4 mirrors only the **read-only** detail. The web `ContributeSection`/`RatingForm`/`ConditionForm`/`NoteForm`/`StarGroup` (and `contributeError.ts`) are **not** ported here.
- **Proximity verification** (`is_proximate`, "I'm here" gating) is a write-side concern (the mobile app's job per the style guide) → with contributions in 6e-6, not 6e-4.
- **Share** (web `ShareButton` → `navigator.share`) has no 1:1 RN mirror and is not a Phase 4 requirement → **deferred**. (A future polish slice may add RN `Share`.)
- **Directions** _is_ included (a fountain detail without "how do I get there" is incomplete, and web has it) — a single `Linking.openURL` to the cross-platform Google Maps directions URL, with an honest `Alert` on the (rare) failure rather than a silent swallow.
- **Rating-types / attribute-types lookups are NOT needed.** `FountainDetail` already carries display names: `dimensions[].name`, `attributes[].name`/`.category`. The detail renders labels straight from the payload — no `/rating-types` or `/attribute-types` call (spec §5 "if needed for labels" — not needed here).

---

## File Structure

**Pure, unit-tested modules (zero RN/Expo imports — Vitest `node` env):**

- `mobile/lib/map/format.ts` (**modify**) — extend the existing `formatPill`-only file with the web detail formatters (faithful mirror of `web/lib/map/format.ts`). (Task 2)
- `mobile/lib/map/format.test.ts` (**create**) — mirror `web/lib/map/format.test.ts` (covers the new formatters + the existing `formatPill`). (Task 2)
- `mobile/lib/detail/attributes.ts` (**create**) — pure `groupAttributes(attributes)` (first-seen category order; mirrors the inline grouping in web `AttributeList.tsx`, extracted so it is unit-testable). (Task 3)
- `mobile/lib/detail/attributes.test.ts` (**create**). (Task 3)
- `mobile/lib/detail/notes.ts` (**create**) — pure `isNoteEdited(note)` (mirrors web `NotesList`'s inline `updated_at > created_at`, extracted so it is unit-testable). (Task 3)
- `mobile/lib/detail/notes.test.ts` (**create**). (Task 3)
- `mobile/lib/api.ts` (**modify**) — add a pure, read-only `apiErrorStatus(error): number | null` next to `ApiError` (for honest 404 handling; does **not** touch the sanitizing-client logic). (Task 4)
- `mobile/lib/api.test.ts` (**modify**) — add `apiErrorStatus` cases. (Task 4)

**Untested shell (RN components / route — `tsc`/ESLint/doctor covered, no Vitest):**

- `mobile/components/fountain/StatusBlock.tsx` (**create**) — status chip + advisory + last-verified line (with a full-date accessibility label). (Task 5)
- `mobile/components/fountain/AttributeList.tsx` (**create**) — grouped attribute consensus rows. (Task 5)
- `mobile/components/fountain/NotesList.tsx` (**create**) — community-notes cards. (Task 5)
- `mobile/components/fountain/FountainDetail.tsx` (**create**) — the composed read-only detail body (rating summary, dimensions, placement, comments, the three components above, a notes-error row, timestamps, Directions). (Task 6)
- `mobile/app/fountains/[id].tsx` (**replace** the placeholder) — detail + notes queries, invalid-id + 404 "not found", `QueryStateView`, notes-error policy, pull-to-refresh. (Task 7)

**Docs:**

- `docs/style-guide.md` (**modify**) — add a "Fountain detail (slice 6e-4)" subsection under `## Mobile (React Native)` documenting the new components. (Task 8)
- `docs/plans/2026-06-23-mobile-6e-4-fountain-detail-and-public-reads.md` — this plan (committed in Task 1).

No backend, no `api-client`, no web changes. No CI workflow change (CI's `workspace-js` job already runs `turbo run lint typecheck test`; `run.ps1 check -Mobile` runs `test`).

**Interface summary (names later tasks rely on):**

- `mobile/lib/map/format.ts` (additions): `formatAverage(avg: number | null): string`; `formatVotes(n: number): string`; `formatDimension(avg: number | null, votes: number): string`; `formatDate(iso: string): string`; `type StatusTone = "ok" | "warn" | "bad"`; `interface StatusDisplay`; `statusDisplay(currentStatus, isWorking): StatusDisplay`; `formatDateFull(iso: string): string`; `formatRelativeTime(iso: string, now: Date): string`; `attributeValueLabel(value: string): string`; `type AttrTone = "normal" | "muted" | "mixed"`; `interface AttributeDisplay`; `attributeDisplay(attr): AttributeDisplay`; `formatCategory(key: string): string`. (`formatPill` unchanged.)
- `mobile/lib/detail/attributes.ts`: `type AttrGroup = { category: string; items: AttributeConsensusOut[] }`; `groupAttributes(attributes): AttrGroup[]`.
- `mobile/lib/detail/notes.ts`: `isNoteEdited(note: Pick<NoteOut, "created_at" | "updated_at">): boolean`.
- `mobile/lib/api.ts` (addition): `apiErrorStatus(error: unknown): number | null` — the numeric `status` of an `ApiError`, else `null`.

---

### Task 1: Branch + land this plan

**Files:**

- Add (already on disk, untracked): `docs/plans/2026-06-23-mobile-6e-4-fountain-detail-and-public-reads.md`

- [ ] **Step 1: Create the branch** off up-to-date `main`:

```bash
git fetch origin
git switch -c feat/mobile-6e-4-detail origin/main
```

- [ ] **Step 2: Format + commit the plan** (it rides this PR):

```bash
pnpm exec prettier --write docs/plans/2026-06-23-mobile-6e-4-fountain-detail-and-public-reads.md
git add docs/plans/2026-06-23-mobile-6e-4-fountain-detail-and-public-reads.md
git commit -m "docs(mobile): add slice 6e-4 (fountain detail + public reads) implementation plan"
git show --stat HEAD
```

Expected: one file committed.

---

### Task 2: Detail formatters (mirror web `lib/map/format.ts`)

**Files:**

- Modify: `mobile/lib/map/format.ts`
- Create: `mobile/lib/map/format.test.ts`

**Interfaces:**

- Produces the formatters listed in the Interface summary. `FountainDetail`/`StatusBlock`/`AttributeList`/`NotesList` (Tasks 5–6) consume them.

**Rationale:** these are the exact pure helpers the web detail uses; porting them verbatim keeps mobile and web display behavior identical and gives the slice its unit-tested core. `formatPill` already lives here (6e-3) and is kept (reuse its `one` helper). **`conditionStatusLabel` is intentionally NOT ported** — it labels the write-side condition form (6e-6), not the read-only detail.

- [ ] **Step 1: Write failing tests** — create `mobile/lib/map/format.test.ts` by mirroring `web/lib/map/format.test.ts` (same cases, same expectations) for `formatPill`, `formatAverage`, `formatVotes`, `formatDimension`, `formatDate`, `statusDisplay`, `formatDateFull`, `formatRelativeTime`, `attributeValueLabel`, `attributeDisplay`, `formatCategory`. Do **not** include the `conditionStatusLabel` block. Import from `./format`:

```typescript
import { describe, expect, it } from "vitest";

import {
  attributeDisplay,
  attributeValueLabel,
  formatAverage,
  formatCategory,
  formatDate,
  formatDateFull,
  formatDimension,
  formatPill,
  formatRelativeTime,
  formatVotes,
  statusDisplay,
} from "./format";
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter mobile exec vitest run lib/map/format.test.ts`
Expected: FAIL — the new formatters are not exported yet.

- [ ] **Step 3: Implement** — extend `mobile/lib/map/format.ts`, appending the web formatters verbatim **below** the existing `formatPill` (keep `formatPill` and its `one` helper; reuse the same `one`). The additions, copied from `web/lib/map/format.ts`:

```typescript
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const formatAverage = (avg: number | null) => (avg == null ? "Not yet rated" : one(avg));
export const formatVotes = (n: number) => `${n} ${n === 1 ? "rating" : "ratings"}`;
export const formatDimension = (avg: number | null, votes: number) =>
  avg == null ? "Not yet rated" : `★ ${one(avg)} (${votes})`;
export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export type StatusTone = "ok" | "warn" | "bad";
export interface StatusDisplay {
  chipLabel: string;
  chipTone: StatusTone;
  advisory: string | null;
}

const baseline = (isWorking: boolean): { chipLabel: string; chipTone: StatusTone } =>
  isWorking
    ? { chipLabel: "Working", chipTone: "ok" }
    : { chipLabel: "Out of order", chipTone: "bad" };

// `reported_issue` is a NON-flipping advisory — preserve the is_working baseline chip and
// surface the advisory separately. `null`/unexpected also fall back to the baseline.
export function statusDisplay(
  currentStatus: string | null | undefined,
  isWorking: boolean,
): StatusDisplay {
  switch (currentStatus) {
    case "ok":
      return { chipLabel: "Verified working", chipTone: "ok", advisory: null };
    case "degraded":
      return { chipLabel: "Working — issues reported", chipTone: "warn", advisory: null };
    case "not_working":
      return { chipLabel: "Not working", chipTone: "bad", advisory: null };
    case "reported_issue":
      return { ...baseline(isWorking), advisory: "Issue reported recently — not yet confirmed" };
    default:
      return { ...baseline(isWorking), advisory: null };
  }
}

export const formatDateFull = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

export function formatRelativeTime(iso: string, now: Date): string {
  const sec = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now"; // also the future/skew clamp (sec < 0)
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ${hr === 1 ? "hour" : "hours"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} ${day === 1 ? "day" : "days"} ago`;
  if (day < 28) {
    const wk = Math.floor(day / 7);
    return `${wk} ${wk === 1 ? "week" : "weeks"} ago`;
  }
  return formatDateFull(iso);
}

export const attributeValueLabel = (value: string): string => {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "unknown") return "Unknown";
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export type AttrTone = "normal" | "muted" | "mixed";
export interface AttributeDisplay {
  text: string;
  tone: AttrTone;
  hint: string | null;
}

export function attributeDisplay(attr: {
  consensus_value: string | null;
  confidence: string;
  observation_count: number;
  latest_observation_value: string | null;
}): AttributeDisplay {
  const { consensus_value, confidence, observation_count, latest_observation_value } = attr;
  if (consensus_value != null) {
    if (confidence === "low") {
      const n = observation_count;
      return {
        text: attributeValueLabel(consensus_value),
        tone: "muted",
        hint: `(${n} ${n === 1 ? "report" : "reports"})`,
      };
    }
    return { text: attributeValueLabel(consensus_value), tone: "normal", hint: null };
  }
  if (confidence === "mixed") {
    return {
      text: "Mixed",
      tone: "mixed",
      hint:
        latest_observation_value != null
          ? `latest: ${attributeValueLabel(latest_observation_value)}`
          : null,
    };
  }
  return { text: "Unknown", tone: "muted", hint: null };
}

const CATEGORY_LABELS: Record<string, string> = {
  physical: "Features",
  accessibility: "Accessibility",
  access: "Access",
};

export function formatCategory(key: string): string {
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
```

- [ ] **Step 4: Format, then run tests to confirm pass** (format first so the green run is the committed tree):

```bash
pnpm exec prettier --write mobile/lib/map/format.ts mobile/lib/map/format.test.ts
pnpm --filter mobile exec vitest run lib/map/format.test.ts
```

Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/map/format.ts mobile/lib/map/format.test.ts
git commit -m "feat(mobile): add fountain detail formatters (mirrors web)"
git show --stat HEAD
```

---

### Task 3: Pure detail helpers — attribute grouping + note-edited flag

**Files:**

- Create: `mobile/lib/detail/attributes.ts` + `mobile/lib/detail/attributes.test.ts`
- Create: `mobile/lib/detail/notes.ts` + `mobile/lib/detail/notes.test.ts`

**Interfaces:**

- Consumes: `AttributeConsensusOut`, `NoteOut` from `@fountainrank/api-client`.
- Produces: `groupAttributes(attributes): AttrGroup[]` (consumed by `AttributeList`); `isNoteEdited(note): boolean` (consumed by `NotesList`).

**Rationale:** web `AttributeList.tsx` groups by `category` in **first-seen order** inline, and `NotesList.tsx` computes an "edited" marker (`updated_at > created_at`) inline. RN component files are not unit-tested in this setup, so both pieces of non-trivial logic are extracted to pure helpers to keep them under test and honor the pure-core/thin-shell split. Intentional, justified divergences from web's inline versions.

- [ ] **Step 1: Write failing tests.**

`mobile/lib/detail/attributes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type { components } from "@fountainrank/api-client";

import { groupAttributes } from "./attributes";

type Attr = components["schemas"]["AttributeConsensusOut"];

const make = (attribute_type_id: number, category: string, name: string): Attr => ({
  attribute_type_id,
  key: `k${attribute_type_id}`,
  name,
  category,
  consensus_value: "yes",
  confidence: "high",
  yes_count: 1,
  no_count: 0,
  unknown_count: 0,
  value_counts: null,
  observation_count: 1,
  latest_observation_value: "yes",
});

describe("groupAttributes", () => {
  it("returns [] for no attributes", () => {
    expect(groupAttributes([])).toEqual([]);
  });

  it("groups by category in first-seen order, preserving item order", () => {
    const groups = groupAttributes([
      make(1, "physical", "Bottle filler"),
      make(2, "access", "Public"),
      make(3, "physical", "Pet bowl"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["physical", "access"]);
    expect(groups[0].items.map((a) => a.name)).toEqual(["Bottle filler", "Pet bowl"]);
    expect(groups[1].items.map((a) => a.name)).toEqual(["Public"]);
  });
});
```

`mobile/lib/detail/notes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { isNoteEdited } from "./notes";

describe("isNoteEdited", () => {
  it("is false when updated_at equals created_at", () => {
    expect(
      isNoteEdited({ created_at: "2026-06-22T10:00:00Z", updated_at: "2026-06-22T10:00:00Z" }),
    ).toBe(false);
  });
  it("is true when updated_at is strictly later", () => {
    expect(
      isNoteEdited({ created_at: "2026-06-22T10:00:00Z", updated_at: "2026-06-22T11:00:00Z" }),
    ).toBe(true);
  });
  it("is false when updated_at precedes created_at (clock skew)", () => {
    expect(
      isNoteEdited({ created_at: "2026-06-22T11:00:00Z", updated_at: "2026-06-22T10:00:00Z" }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter mobile exec vitest run lib/detail/attributes.test.ts lib/detail/notes.test.ts
```

Expected: FAIL — `./attributes` / `./notes` do not exist.

- [ ] **Step 3: Implement.**

`mobile/lib/detail/attributes.ts`:

```typescript
import type { components } from "@fountainrank/api-client";

type Attr = components["schemas"]["AttributeConsensusOut"];

export type AttrGroup = { category: string; items: Attr[] };

/** Group attribute consensus rows by `category` in first-seen order, preserving
 *  each category's item order. Mirrors the inline grouping in web AttributeList. */
export function groupAttributes(attributes: Attr[]): AttrGroup[] {
  const groups: AttrGroup[] = [];
  for (const a of attributes) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) {
      g = { category: a.category, items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }
  return groups;
}
```

`mobile/lib/detail/notes.ts`:

```typescript
import type { components } from "@fountainrank/api-client";

type NoteOut = components["schemas"]["NoteOut"];

/** A note is "edited" when its updated_at is strictly later than created_at.
 *  Mirrors the inline check in web NotesList; clock-skew (updated < created) is
 *  treated as not-edited. */
export function isNoteEdited(note: Pick<NoteOut, "created_at" | "updated_at">): boolean {
  return new Date(note.updated_at).getTime() > new Date(note.created_at).getTime();
}
```

- [ ] **Step 4: Format, then run tests to confirm pass**

```bash
pnpm exec prettier --write mobile/lib/detail/attributes.ts mobile/lib/detail/attributes.test.ts mobile/lib/detail/notes.ts mobile/lib/detail/notes.test.ts
pnpm --filter mobile exec vitest run lib/detail/attributes.test.ts lib/detail/notes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/detail/attributes.ts mobile/lib/detail/attributes.test.ts mobile/lib/detail/notes.ts mobile/lib/detail/notes.test.ts
git commit -m "feat(mobile): add pure detail helpers (attribute grouping + note-edited flag)"
git show --stat HEAD
```

---

### Task 4: `apiErrorStatus` helper (honest 404 handling)

**Files:**

- Modify: `mobile/lib/api.ts`
- Modify: `mobile/lib/api.test.ts`

**Interfaces:**

- Produces: `apiErrorStatus(error: unknown): number | null`. The detail screen (Task 7) uses it to detect a 404 and render an honest, non-retryable "not found" state.

**Rationale:** `unwrap` throws `ApiError(status)` on an HTTP error. A 404 on the detail read means "this fountain does not exist" — not a transient failure — so it must show a distinct, **non-retryable** message rather than the generic "Something went wrong — try again". A tiny pure reader on `ApiError.status`, co-located with `ApiError`, keeps that branch testable and reusable (6e-5/6e-6 will want status checks too). It does **not** touch the sanitizing-client / dev-seam logic.

**Relationship to `resolveViewState`:** `resolveViewState` (`lib/view-state.ts`) deliberately reads `.status` **structurally** (duck-typed) so it classifies offline-vs-error resiliently even for errors that aren't a literal `ApiError` instance across a module boundary. `apiErrorStatus` is the **precise** complement used for value-specific branching (e.g. exactly 404): in this app, anything thrown with an HTTP status from `unwrap` _is_ an `ApiError`, so an `instanceof` check is correct and avoids matching an unrelated `{ status }` object. The two coexist intentionally; `resolveViewState` is left unchanged to keep 6e-3 behavior and its tests stable.

- [ ] **Step 1: Write failing tests** — append to `mobile/lib/api.test.ts` (and add `apiErrorStatus` to the existing `./api` import line):

```typescript
describe("apiErrorStatus", () => {
  it("returns the numeric status of an ApiError", () => {
    expect(apiErrorStatus(new ApiError(404))).toBe(404);
    expect(apiErrorStatus(new ApiError(500))).toBe(500);
  });
  it("returns null for a non-ApiError (network error / arbitrary value)", () => {
    expect(apiErrorStatus(new Error("boom"))).toBeNull();
    expect(apiErrorStatus(null)).toBeNull();
    expect(apiErrorStatus({ status: 404 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter mobile exec vitest run lib/api.test.ts`
Expected: FAIL — `apiErrorStatus` is not exported.

- [ ] **Step 3: Implement** — in `mobile/lib/api.ts`, add immediately after the `ApiError` class:

```typescript
/**
 * The numeric HTTP status of an `ApiError`, or `null` for anything else
 * (network/offline errors have no status; a bare `{ status }` object is NOT an
 * ApiError). Use for value-specific branching (e.g. 404 -> "not found"). See
 * resolveViewState for the structural offline-vs-error classification this
 * complements.
 */
export function apiErrorStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}
```

- [ ] **Step 4: Format, then run tests to confirm pass**

```bash
pnpm exec prettier --write mobile/lib/api.ts mobile/lib/api.test.ts
pnpm --filter mobile exec vitest run lib/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/api.ts mobile/lib/api.test.ts
git commit -m "feat(mobile): add apiErrorStatus helper for status-specific error handling"
git show --stat HEAD
```

---

### Task 5: Leaf detail components — `StatusBlock`, `AttributeList`, `NotesList`

**Files:**

- Create: `mobile/components/fountain/StatusBlock.tsx`
- Create: `mobile/components/fountain/AttributeList.tsx`
- Create: `mobile/components/fountain/NotesList.tsx`

**Proof:** shell — `tsc` + ESLint + `expo-doctor` (no Vitest; they import RN). All display logic lives in the Task 2/3 pure helpers.

**Translation notes (Tailwind → RN `StyleSheet`):** use `mobile/theme.ts` tokens (`colors`, `spacing`, `typography`). The web tone palettes have no theme tokens, so define small local tone→color maps (hex mirroring the web Tailwind), documented in the style guide (Task 8). `View`/`Text` only; `gap` is supported in RN 0.85.

- [ ] **Step 1: `StatusBlock.tsx`** — mirror `web/components/fountain/StatusBlock.tsx`. Props: `{ currentStatus: string | null | undefined; isWorking: boolean; lastVerifiedAt: string | null | undefined; now: Date }`. Renders the toned status chip, an optional `⚠`-prefixed advisory, and a muted last-verified line. Web shows the exact date via a hover `title`; RN has no hover, so the **full date is preserved in an `accessibilityLabel`** (screen readers / honest "last-verified" data) while the visible text stays relative.

```tsx
import { StyleSheet, Text, View } from "react-native";

import {
  formatDateFull,
  formatRelativeTime,
  statusDisplay,
  type StatusTone,
} from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

const CHIP: Record<StatusTone, { bg: string; fg: string }> = {
  ok: { bg: "#D1FAE5", fg: "#065F46" },
  warn: { bg: "#FEF3C7", fg: "#92400E" },
  bad: { bg: "#FEE2E2", fg: "#991B1B" },
};

export function StatusBlock({
  currentStatus,
  isWorking,
  lastVerifiedAt,
  now,
}: {
  currentStatus: string | null | undefined;
  isWorking: boolean;
  lastVerifiedAt: string | null | undefined;
  now: Date;
}) {
  const { chipLabel, chipTone, advisory } = statusDisplay(currentStatus, isWorking);
  const chip = CHIP[chipTone];
  const verifiedText = lastVerifiedAt
    ? `Last verified ${formatRelativeTime(lastVerifiedAt, now)}`
    : "Not yet verified by anyone";
  const verifiedA11y = lastVerifiedAt
    ? `${verifiedText} (${formatDateFull(lastVerifiedAt)})`
    : verifiedText;
  return (
    <View style={styles.wrap}>
      <View style={[styles.chip, { backgroundColor: chip.bg }]}>
        <Text style={[styles.chipText, { color: chip.fg }]}>{chipLabel}</Text>
      </View>
      {advisory ? <Text style={styles.advisory}>{`⚠ ${advisory}`}</Text> : null}
      <Text style={styles.verified} accessibilityLabel={verifiedA11y}>
        {verifiedText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, alignItems: "flex-start" },
  chip: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipText: { ...typography.meta, fontWeight: "700" },
  advisory: { ...typography.meta, color: "#92400E" },
  verified: { ...typography.meta, color: colors.textMuted },
});
```

- [ ] **Step 2: `AttributeList.tsx`** — mirror `web/components/fountain/AttributeList.tsx` using `groupAttributes` (Task 3) + `attributeDisplay`/`formatCategory` (Task 2). Props: `{ attributes: AttributeConsensusOut[] }`. Return `null` when empty.

```tsx
import type { components } from "@fountainrank/api-client";
import { StyleSheet, Text, View } from "react-native";

import { groupAttributes } from "../../lib/detail/attributes";
import { attributeDisplay, type AttrTone, formatCategory } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

type Attr = components["schemas"]["AttributeConsensusOut"];

const TONE: Record<AttrTone, string> = {
  normal: colors.text,
  muted: colors.textMuted,
  mixed: "#92400E",
};

export function AttributeList({ attributes }: { attributes: Attr[] }) {
  const groups = groupAttributes(attributes);
  if (groups.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {groups.map((g) => (
        <View key={g.category} style={styles.group}>
          <Text style={styles.header}>{formatCategory(g.category).toUpperCase()}</Text>
          {g.items.map((a) => {
            const d = attributeDisplay(a);
            return (
              <View key={a.attribute_type_id} style={styles.row}>
                <Text style={styles.name}>{a.name}</Text>
                <Text style={[styles.value, { color: TONE[d.tone] }]}>
                  {d.text}
                  {d.hint ? <Text style={styles.hint}>{` ${d.hint}`}</Text> : null}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  group: { gap: spacing.xs },
  header: { ...typography.meta, color: colors.textMuted, fontWeight: "600", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  name: { ...typography.body, color: colors.textMuted, flexShrink: 1 },
  value: { ...typography.body, textAlign: "right" },
  hint: { ...typography.meta, color: colors.textMuted },
});
```

- [ ] **Step 3: `NotesList.tsx`** — mirror `web/components/fountain/NotesList.tsx`, using `isNoteEdited` (Task 3). Props: `{ notes: NoteOut[]; now: Date }`. Return `null` when empty.

```tsx
import type { components } from "@fountainrank/api-client";
import { StyleSheet, Text, View } from "react-native";

import { isNoteEdited } from "../../lib/detail/notes";
import { formatRelativeTime } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

type NoteOut = components["schemas"]["NoteOut"];

export function NotesList({ notes, now }: { notes: NoteOut[]; now: Date }) {
  if (notes.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>COMMUNITY NOTES</Text>
      {notes.map((note) => (
        <View key={note.id} style={styles.card}>
          <Text style={styles.body}>{note.body}</Text>
          <Text style={styles.byline}>
            {`— ${note.author_display_name} · ${formatRelativeTime(note.created_at, now)}${
              isNoteEdited(note) ? " · edited" : ""
            }`}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { ...typography.meta, color: colors.textMuted, fontWeight: "600", letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  body: { ...typography.body, color: colors.text },
  byline: { ...typography.meta, color: colors.textMuted },
});
```

- [ ] **Step 4: Format, then typecheck/lint** (format first so the verified tree is the committed tree):

```bash
pnpm exec prettier --write mobile/components/fountain/StatusBlock.tsx mobile/components/fountain/AttributeList.tsx mobile/components/fountain/NotesList.tsx
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile -Fast
```

Expected: lint + typecheck + vitest green.

- [ ] **Step 5: Commit**

```bash
git add mobile/components/fountain/StatusBlock.tsx mobile/components/fountain/AttributeList.tsx mobile/components/fountain/NotesList.tsx
git commit -m "feat(mobile): add detail leaf components (status, attributes, notes)"
git show --stat HEAD
```

---

### Task 6: `FountainDetail` body component

**Files:**

- Create: `mobile/components/fountain/FountainDetail.tsx`

**Interfaces:**

- Props: `{ detail: FountainDetail; notes: NoteOut[]; notesError?: boolean; onRetryNotes?: () => void; now: Date }`. The screen (Task 7) renders it once the detail read resolves; `notesError`/`onRetryNotes` drive the non-blocking notes-error row.

**Proof:** shell — `tsc` + ESLint + `expo-doctor`.

**Mirror** `web/components/fountain/FountainDetail.tsx`, **dropping** the write/auth surfaces (`ContributeSection`, `ShareButton`). Sections, in order: title + `<StatusBlock>`; `placement_note` (📍, when present); rating summary (`formatAverage` + `formatVotes`); dimensions (only when `dimensions.length > 0`); `<AttributeList>`; adder `comments` card (when present); **notes section** — `<NotesList>` when `!notesError`, else a small non-blocking error row with a Retry; footer (`Added`/`Last rated`); Directions button.

```tsx
import type { components } from "@fountainrank/api-client";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { formatAverage, formatDate, formatDimension, formatVotes } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";
import { AttributeList } from "./AttributeList";
import { NotesList } from "./NotesList";
import { StatusBlock } from "./StatusBlock";

type FountainDetailT = components["schemas"]["FountainDetail"];
type NoteOut = components["schemas"]["NoteOut"];

export function FountainDetail({
  detail,
  notes,
  notesError,
  onRetryNotes,
  now,
}: {
  detail: FountainDetailT;
  notes: NoteOut[];
  notesError?: boolean;
  onRetryNotes?: () => void;
  now: Date;
}) {
  const { latitude, longitude } = detail.location;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const openDirections = () => {
    Linking.openURL(directionsUrl).catch(() => {
      Alert.alert("Couldn't open maps", "No maps app is available to open directions.");
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Public drinking fountain</Text>
        <StatusBlock
          currentStatus={detail.current_status}
          isWorking={detail.is_working}
          lastVerifiedAt={detail.last_verified_at}
          now={now}
        />
      </View>

      {detail.placement_note ? (
        <Text style={styles.placement}>{`📍 ${detail.placement_note}`}</Text>
      ) : null}

      <View style={styles.ratingRow}>
        <Text style={styles.average}>{formatAverage(detail.average_rating ?? null)}</Text>
        {detail.average_rating != null ? (
          <Text style={styles.votes}>{` · ${formatVotes(detail.rating_count)}`}</Text>
        ) : null}
      </View>

      {detail.dimensions.length > 0 ? (
        <View style={styles.dimensions}>
          {detail.dimensions.map((d) => (
            <View key={d.rating_type_id} style={styles.dimensionRow}>
              <Text style={styles.dimensionName}>{d.name}</Text>
              <Text style={styles.dimensionValue}>
                {formatDimension(d.average_rating ?? null, d.vote_count)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <AttributeList attributes={detail.attributes} />

      {detail.comments ? (
        <View>
          <View style={styles.commentCard}>
            <Text style={styles.commentText}>{detail.comments}</Text>
          </View>
          <Text style={styles.commentCaption}>From the person who added this fountain</Text>
        </View>
      ) : null}

      {notesError ? (
        <View style={styles.notesError}>
          <Text style={styles.notesErrorText}>Community notes couldn&apos;t load.</Text>
          {onRetryNotes ? (
            <Pressable accessibilityRole="button" onPress={onRetryNotes}>
              <Text style={styles.notesRetry}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <NotesList notes={notes} now={now} />
      )}

      <Text style={styles.footer}>
        {`Added ${formatDate(detail.created_at)}`}
        {detail.last_rated_at ? ` · Last rated ${formatDate(detail.last_rated_at)}` : ""}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Get directions"
        onPress={openDirections}
        style={styles.directions}
      >
        <Text style={styles.directionsText}>Directions</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  headerBlock: { gap: spacing.xs },
  title: { ...typography.heading, color: colors.brandBlue },
  placement: { ...typography.body, color: colors.textMuted },
  ratingRow: { flexDirection: "row", alignItems: "baseline" },
  average: { fontSize: 28, fontWeight: "800", color: colors.brandBlue },
  votes: { ...typography.body, color: colors.textMuted },
  dimensions: { borderTopColor: colors.border, borderTopWidth: 1 },
  dimensionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  dimensionName: { ...typography.body, fontWeight: "600", color: colors.text },
  dimensionValue: { ...typography.body, color: colors.textMuted },
  commentCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
  },
  commentText: { ...typography.body, color: colors.text },
  commentCaption: { ...typography.meta, color: colors.textMuted, marginTop: spacing.xs },
  notesError: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notesErrorText: { ...typography.meta, color: colors.textMuted },
  notesRetry: { ...typography.meta, color: colors.brandBlue, fontWeight: "700" },
  footer: { ...typography.meta, color: colors.textMuted },
  directions: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandYellow,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  directionsText: { ...typography.body, fontWeight: "700", color: colors.brandBlue },
});
```

- [ ] **Step 1: Write the component above.**

- [ ] **Step 2: Format, then typecheck/lint**

```bash
pnpm exec prettier --write mobile/components/fountain/FountainDetail.tsx
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile -Fast
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/fountain/FountainDetail.tsx
git commit -m "feat(mobile): add read-only fountain detail body component"
git show --stat HEAD
```

---

### Task 7: Detail screen — wire the public reads

**Files:**

- Replace: `mobile/app/fountains/[id].tsx` (the 6e-2 placeholder)

**Interfaces:**

- Consumes: `useApi()` (client), `useLocalSearchParams` (id), `unwrap`/`apiErrorStatus` from `lib/api`, `QueryStateView`, `FountainDetail`.
- Two **public** `useQuery` reads: detail (`/api/v1/fountains/{fountain_id}`) and notes (`/api/v1/fountains/{fountain_id}/notes`).

**Proof:** shell — `tsc` + ESLint + `expo-doctor`.

**Behavior:**

- **Normalize the route id first.** `useLocalSearchParams` can yield `string | string[] | undefined`. Compute `fountainId = typeof id === "string" && id.length > 0 ? id : null`. When `null` (bad deep link / unexpected param), render an honest, **non-retryable** "not found" state — never a blank "ready" screen. `fountainId` (not the raw param) is used in both query keys and path params, and gates `enabled`.
- **Detail query gates the screen.** Wrap with `QueryStateView` on the **detail** query (`isLoading`/`isError`). `LoadingState` on first load; `OfflineState` (no status) / `ErrorState` (has status) with a retry that refetches **both** queries.
- **404 → honest "not found"**, handled **before** `QueryStateView`: when `apiErrorStatus(detailQuery.error) === 404`, render the same non-retryable "not found" state (retrying a 404 is pointless).
- **Notes are best-effort but NOT silent.** Pass `notesQuery.data ?? []` plus `notesError={notesQuery.isError}` and `onRetryNotes`; `FountainDetail` shows a small non-blocking "Community notes couldn't load — Retry" row on failure (mobile's analog of the web's notes warning). A notes failure never blanks the detail.
- **Pull-to-refresh:** a `ScrollView` with `RefreshControl` whose `onRefresh` refetches both queries; `refreshing` = `detailQuery.isRefetching || notesQuery.isRefetching`. (`isLoading` is first-load-only, so a manual refresh shows the `RefreshControl` spinner, not the full-screen `LoadingState`.)
- **`now`** is computed once per render and passed down for deterministic relative-time formatting within a render.
- **Header:** `<Stack.Screen options={{ headerShown: true, title: "Fountain" }} />` (the stack back button returns to the still-mounted Map screen).
- **Preserve map context:** nothing to build — navigation from the map is `router.push`, so the Map screen stays mounted and its region/filters/query cache are intact on back. This task must not change that (no `router.replace`, no invalidation of the bbox query).

```tsx
import type { components } from "@fountainrank/api-client";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { FountainDetail } from "../../components/fountain/FountainDetail";
import { ScreenContainer } from "../../components/ScreenContainer";
import { QueryStateView } from "../../components/states/QueryStateView";
import { apiErrorStatus, unwrap } from "../../lib/api";
import { useApi } from "../../providers/api-provider";
import { colors, spacing, typography } from "../../theme";

type FountainDetailT = components["schemas"]["FountainDetail"];
type NoteOut = components["schemas"]["NoteOut"];

function NotFound({ note }: { note: string }) {
  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Fountain" }} />
      <View style={styles.centered}>
        <Text style={styles.notFoundTitle}>Fountain not found</Text>
        <Text style={styles.notFoundNote}>{note}</Text>
      </View>
    </ScreenContainer>
  );
}

export default function FountainDetailScreen() {
  const { client } = useApi();
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const fountainId = typeof id === "string" && id.length > 0 ? id : null;
  const now = new Date();

  const detailQuery = useQuery({
    queryKey: ["fountain", fountainId],
    enabled: fountainId != null,
    queryFn: async (): Promise<FountainDetailT> =>
      unwrap(
        await client.GET("/api/v1/fountains/{fountain_id}", {
          params: { path: { fountain_id: fountainId as string } },
        }),
      ),
  });

  const notesQuery = useQuery({
    queryKey: ["fountain", fountainId, "notes"],
    enabled: fountainId != null,
    queryFn: async (): Promise<NoteOut[]> =>
      unwrap(
        await client.GET("/api/v1/fountains/{fountain_id}/notes", {
          params: { path: { fountain_id: fountainId as string } },
        }),
      ),
  });

  const refetchAll = () => {
    void detailQuery.refetch();
    void notesQuery.refetch();
  };

  // Invalid route id (bad deep link / unexpected param) — honest, non-retryable.
  if (fountainId == null) {
    return <NotFound note="This link doesn't reference a fountain." />;
  }
  // A 404 means "no such fountain" — honest, non-retryable (not a transient error).
  if (apiErrorStatus(detailQuery.error) === 404) {
    return <NotFound note="This fountain may have been removed." />;
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Fountain" }} />
      <QueryStateView
        input={{
          isLoading: detailQuery.isLoading,
          isError: detailQuery.isError,
          error: detailQuery.error,
        }}
        onRetry={refetchAll}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={detailQuery.isRefetching || notesQuery.isRefetching}
              onRefresh={refetchAll}
              tintColor={colors.brandBlue}
            />
          }
        >
          {detailQuery.data ? (
            <FountainDetail
              detail={detailQuery.data}
              notes={notesQuery.data ?? []}
              notesError={notesQuery.isError}
              onRetryNotes={() => void notesQuery.refetch()}
              now={now}
            />
          ) : null}
        </ScrollView>
      </QueryStateView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: spacing.md, gap: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  notFoundTitle: { ...typography.title, color: colors.brandBlue },
  notFoundNote: { ...typography.body, color: colors.textMuted },
});
```

- [ ] **Step 1: Replace the placeholder** with the screen above.

- [ ] **Step 2: Format, then run the full mobile check** (typecheck + lint + vitest + expo-doctor):

```bash
pnpm exec prettier --write "mobile/app/fountains/[id].tsx"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add "mobile/app/fountains/[id].tsx"
git commit -m "feat(mobile): wire fountain detail screen to public detail + notes reads"
git show --stat HEAD
```

---

### Task 8: Style guide + full local CI mirror + PR

**Files:**

- Modify: `docs/style-guide.md`

- [ ] **Step 1: Document the new components** — add a "### Fountain detail (slice 6e-4)" subsection at the end of the `## Mobile (React Native)` section, covering: the detail **screen** (`ScreenContainer` + `ScrollView` + pull-to-refresh; detail query gates via `QueryStateView`; honest non-retryable "Fountain not found" for both invalid id and 404; notes best-effort with a non-blocking error row); **`StatusBlock`** (status chip tones ok/warn/bad with their hex palettes, advisory line, last-verified line + full-date `accessibilityLabel`); **`AttributeList`** (category groups via the pure `groupAttributes`, toned consensus rows); **`NotesList`** (community-note cards, `edited` marker via the pure `isNoteEdited`); **`FountainDetail`** body (rating summary, dimensions, placement, adder comments, notes-error row, Directions brand-yellow button). Note the read-only scope (contribution affordances arrive in 6e-5/6e-6).

- [ ] **Step 2: Format + commit the style guide** (commit BEFORE the full mirror, so the mirror verifies the final committed tree):

```bash
pnpm exec prettier --write docs/style-guide.md
git add docs/style-guide.md
git commit -m "docs(style-guide): document mobile fountain detail components (slice 6e-4)"
git show --stat HEAD
```

- [ ] **Step 3: Run the FULL local CI mirror on the final committed tree** (gates the PR):

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check
```

Expected: backend + workspace-js + web build + mobile all green. (If `generate` fails inside, run `./run.ps1 bootstrap` — backend-deps issue, not a test failure.) If anything needs fixing, commit the fix and re-run this step so the green run always reflects the committed tree.

- [ ] **Step 4: Push + open the PR**

```bash
git push -u origin feat/mobile-6e-4-detail
gh pr create --title "feat(mobile): fountain detail + public reads (slice 6e-4)" --body-file <repo-relative body file>
```

PR body: what shipped (read-only detail screen fed by two public reads; honest unknowns / invalid-id / 404; non-silent notes-error row; pull-to-refresh/retry; preserves map context), the proof level (**Local CI** — compiles, lints, type-checks, unit-tested; not device-verified), the deferred scope (contributions → 6e-5/6e-6; Share deferred), and the test-count delta. **No AI attribution; no time estimates.**

- [ ] **Step 5: Monitor CI to green, then run Codex Loop B** (see `claude_help/codex-review-process.md`), address every finding + any other PR comment, loop to `VERDICT: APPROVED`, then **squash-merge**.

---

## Definition of done

- All 8 tasks complete; every commit Conventional + AI-attribution-free.
- New unit tests: `mobile/lib/map/format.test.ts` (detail formatters), `mobile/lib/detail/attributes.test.ts` (grouping), `mobile/lib/detail/notes.test.ts` (note-edited), `mobile/lib/api.test.ts` (apiErrorStatus additions) — all green.
- The detail screen + four components type-check, lint, and pass `expo-doctor`; the placeholder is gone.
- `./run.ps1 check` green on the final committed tree; PR CI green; Codex `VERDICT: APPROVED`; every PR comment addressed; squash-merged.
- Proof level honestly stated as **Local CI** (no device claim).
- Post-merge: write the 6e-4 handoff (NEXT = 6e-5 native auth) following the repo's handoff convention. (Handoff-commit mechanics are an orchestration step outside this implementation plan — handled the same way the 6e-1…6e-3 handoffs were.)
  </content>
