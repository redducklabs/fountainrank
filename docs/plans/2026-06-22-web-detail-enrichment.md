# Web Detail Enrichment (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-live contribution data (operational status, attribute consensus, placement note, community notes) in the read-only web `FountainDetail` panel.

**Architecture:** Pure, unit-tested display helpers in `web/lib/map/format.ts`; a server-side notes fetch in `web/lib/fountains.ts`; three small presentational sub-components (`StatusBlock`, `AttributeList`, `NotesList`) composed by `FountainDetail`; the two existing detail routes fetch detail + notes in parallel and pass both down. No backend/API/client change (the generated `@fountainrank/api-client` already exposes every field + the notes path).

**Tech Stack:** Next.js 16 (App Router, RSC), React, Tailwind CSS v4, TypeScript, Vitest + @testing-library/react (jsdom), `@fountainrank/api-client` (openapi-typescript).

**Spec:** `docs/specs/2026-06-22-web-detail-enrichment-design.md` (Codex-approved). This plan implements it verbatim.

## Global Constraints

- **Read-only slice.** No write actions, no auth-gated UI, no map/filter/gamification changes. Anything beyond display belongs to a later slice (6b–6d). Do NOT add user-facing copy describing future functionality.
- **No new dependencies.** Reuse existing libs only.
- **No API/client/schema regeneration.** `packages/api-client/src/schema.d.ts` already has `current_status`, `last_verified_at`, `placement_note`, `attributes` (`AttributeConsensusOut`), `NoteOut`, and `GET /api/v1/fountains/{fountain_id}/notes`.
- **Style:** Tailwind utility classes only; brand colors as arbitrary values (`#0A357E` navy, `#0C44A0` blue, `#F2C200` gold). Status tones: ok→`bg-emerald-100 text-emerald-800`, warn→`bg-amber-100 text-amber-800`, bad→`bg-red-100 text-red-800`.
- **Paths:** under **Claude Code on Windows**, file tools use backslash paths and the Bash tool is Git Bash (forward slashes). Under **Codex (WSL)** follow `AGENTS.md` — repo-relative forward-slash paths. The repo-relative paths in this plan are correct on both.
- **Formatting/lint:** write prettier-compatible code (double quotes, 2-space indent, trailing commas) and run `pnpm exec prettier --write <files>` before each commit. eslint must pass.
- **Per-file test run (fast loop):** `pnpm --filter web exec vitest run <path-relative-to-web>`.
- **PR gate (mandatory):** the full mirror `./run.ps1 check` (backend + workspace-js + web build + mobile) must be green before opening the PR and before every push (`claude_help/testing-ci.md`). Scoped `-Web` is allowed only as a fast mid-loop check, never as the final gate.
- **Commits:** Conventional Commits, one per task. **No AI attribution. No time estimates.**
- **Logging redaction:** any server log added must carry only `requestId`, `id`, `status` — never note bodies, author names, tokens, cookies, or raw error objects.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `web/lib/map/format.ts` | Pure display helpers (status, dates, attributes, category) | Modify |
| `web/lib/map/format.test.ts` | Unit tests for the helpers | Modify |
| `web/lib/fountains.ts` | `getFountainNotesServer` + `NoteOut` type | Modify |
| `web/lib/fountains.test.ts` | Unit tests for the notes fetch | Modify |
| `docs/style-guide.md` | Document the new UI elements (before they are built) | Modify |
| `web/components/fountain/StatusBlock.tsx` (+`.test.tsx`) | Status chip + advisory + trust line | Create |
| `web/components/fountain/AttributeList.tsx` (+`.test.tsx`) | Attribute consensus, grouped by category | Create |
| `web/components/fountain/NotesList.tsx` (+`.test.tsx`) | Community notes list | Create |
| `web/components/fountain/FountainDetail.tsx` (+`.test.tsx`) | Composes everything; placement note; comment caption; `now`/`notes` props | Modify |
| `web/app/fountains/[id]/page.tsx` (+`.test.tsx`) | Standalone route: parallel detail+notes fetch (non-fatal) | Modify/Create test |
| `web/app/@modal/(.)fountains/[id]/page.tsx` (+`.test.tsx`) | Overlay route: parallel detail+notes fetch (non-fatal) | Modify/Create test |

Task order: helpers → notes fetch → **style guide (before any UI element, per the house rule)** → the three sub-components → the integrated `FountainDetail` + both routes (one atomic task so the `notes` prop contract is never half-wired).

---

### Task 1: Display helpers in `format.ts`

**Files:**
- Modify: `web/lib/map/format.ts`
- Test: `web/lib/map/format.test.ts`

**Interfaces:**
- Consumes: existing `formatDate`, `MONTHS` in `format.ts`.
- Produces:
  - `type StatusTone = "ok" | "warn" | "bad"`
  - `interface StatusDisplay { chipLabel: string; chipTone: StatusTone; advisory: string | null }`
  - `statusDisplay(currentStatus: string | null | undefined, isWorking: boolean): StatusDisplay`
  - `formatDateFull(iso: string): string`
  - `formatRelativeTime(iso: string, now: Date): string`
  - `attributeValueLabel(value: string): string`
  - `type AttrTone = "normal" | "muted" | "mixed"`
  - `interface AttributeDisplay { text: string; tone: AttrTone; hint: string | null }`
  - `attributeDisplay(attr: { consensus_value: string | null; confidence: string; observation_count: number; latest_observation_value: string | null }): AttributeDisplay`
  - `formatCategory(key: string): string`

- [ ] **Step 1: Write the failing tests** — append to `web/lib/map/format.test.ts`:

```ts
import {
  statusDisplay,
  formatDateFull,
  formatRelativeTime,
  attributeValueLabel,
  attributeDisplay,
  formatCategory,
} from "./format";

describe("statusDisplay", () => {
  it("ok -> verified working", () =>
    expect(statusDisplay("ok", true)).toEqual({
      chipLabel: "Verified working",
      chipTone: "ok",
      advisory: null,
    }));
  it("degraded -> working, issues reported (warn)", () => {
    const r = statusDisplay("degraded", true);
    expect(r.chipLabel).toBe("Working — issues reported");
    expect(r.chipTone).toBe("warn");
    expect(r.advisory).toBeNull();
  });
  it("not_working -> bad", () =>
    expect(statusDisplay("not_working", true)).toEqual({
      chipLabel: "Not working",
      chipTone: "bad",
      advisory: null,
    }));
  it("reported_issue keeps working baseline + advisory", () => {
    const r = statusDisplay("reported_issue", true);
    expect(r.chipLabel).toBe("Working");
    expect(r.chipTone).toBe("ok");
    expect(r.advisory).toMatch(/issue reported/i);
  });
  it("reported_issue keeps out-of-order baseline + advisory", () => {
    const r = statusDisplay("reported_issue", false);
    expect(r.chipLabel).toBe("Out of order");
    expect(r.chipTone).toBe("bad");
    expect(r.advisory).toMatch(/issue reported/i);
  });
  it("null -> working baseline, no advisory", () =>
    expect(statusDisplay(null, true)).toEqual({
      chipLabel: "Working",
      chipTone: "ok",
      advisory: null,
    }));
  it("null -> out of order baseline", () =>
    expect(statusDisplay(null, false).chipLabel).toBe("Out of order"));
  it("unexpected status -> baseline, no crash", () =>
    expect(statusDisplay("weird_future", true)).toEqual({
      chipLabel: "Working",
      chipTone: "ok",
      advisory: null,
    }));
});

describe("formatDateFull", () => {
  it("day precision UTC", () => expect(formatDateFull("2026-06-12T08:00:00Z")).toBe("Jun 12, 2026"));
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-22T12:00:00Z");
  it("just now (<60s)", () => expect(formatRelativeTime("2026-06-22T11:59:30Z", now)).toBe("just now"));
  it("future clamps to just now", () =>
    expect(formatRelativeTime("2026-06-22T13:00:00Z", now)).toBe("just now"));
  it("1 minute singular", () =>
    expect(formatRelativeTime("2026-06-22T11:59:00Z", now)).toBe("1 minute ago"));
  it("minutes plural", () =>
    expect(formatRelativeTime("2026-06-22T11:45:00Z", now)).toBe("15 minutes ago"));
  it("hours", () => expect(formatRelativeTime("2026-06-22T09:00:00Z", now)).toBe("3 hours ago"));
  it("days", () => expect(formatRelativeTime("2026-06-19T12:00:00Z", now)).toBe("3 days ago"));
  it("weeks", () => expect(formatRelativeTime("2026-06-08T12:00:00Z", now)).toBe("2 weeks ago"));
  it(">=28d -> precise date", () =>
    expect(formatRelativeTime("2026-05-01T12:00:00Z", now)).toBe("May 1, 2026"));
});

describe("attributeValueLabel", () => {
  it("yes/no/unknown", () => {
    expect(attributeValueLabel("yes")).toBe("Yes");
    expect(attributeValueLabel("no")).toBe("No");
    expect(attributeValueLabel("unknown")).toBe("Unknown");
  });
  it("enum underscores -> spaces, first-cap", () =>
    expect(attributeValueLabel("customer_only")).toBe("Customer only"));
  it("single-word enum", () => expect(attributeValueLabel("park")).toBe("Park"));
});

describe("attributeDisplay", () => {
  const base = {
    consensus_value: "yes" as string | null,
    confidence: "high",
    observation_count: 4,
    latest_observation_value: "yes" as string | null,
  };
  it("high consensus -> normal, no hint", () =>
    expect(attributeDisplay(base)).toEqual({ text: "Yes", tone: "normal", hint: null }));
  it("medium consensus -> normal", () =>
    expect(attributeDisplay({ ...base, confidence: "medium" }).tone).toBe("normal"));
  it("low consensus -> muted + (1 report)", () =>
    expect(attributeDisplay({ ...base, confidence: "low", observation_count: 1 })).toEqual({
      text: "Yes",
      tone: "muted",
      hint: "(1 report)",
    }));
  it("low plural reports", () =>
    expect(attributeDisplay({ ...base, confidence: "low", observation_count: 3 }).hint).toBe(
      "(3 reports)",
    ));
  it("mixed boolean -> Mixed + latest", () =>
    expect(
      attributeDisplay({
        consensus_value: null,
        confidence: "mixed",
        observation_count: 2,
        latest_observation_value: "yes",
      }),
    ).toEqual({ text: "Mixed", tone: "mixed", hint: "latest: Yes" }));
  it("mixed enum -> Mixed + latest enum", () =>
    expect(
      attributeDisplay({
        consensus_value: null,
        confidence: "mixed",
        observation_count: 4,
        latest_observation_value: "customer_only",
      }).hint,
    ).toBe("latest: Customer only"));
  it("none -> Unknown, no hint", () =>
    expect(
      attributeDisplay({
        consensus_value: null,
        confidence: "none",
        observation_count: 1,
        latest_observation_value: null,
      }),
    ).toEqual({ text: "Unknown", tone: "muted", hint: null }));
});

describe("formatCategory", () => {
  it("physical -> Features", () => expect(formatCategory("physical")).toBe("Features"));
  it("accessibility", () => expect(formatCategory("accessibility")).toBe("Accessibility"));
  it("access", () => expect(formatCategory("access")).toBe("Access"));
  it("unknown key title-cased", () => expect(formatCategory("future_kind")).toBe("Future kind"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run lib/map/format.test.ts`
Expected: FAIL — the new helper imports are not exported.

- [ ] **Step 3: Implement the helpers** — append to `web/lib/map/format.ts` (keep the existing exports above untouched):

```ts
export type StatusTone = "ok" | "warn" | "bad";
export interface StatusDisplay {
  chipLabel: string;
  chipTone: StatusTone;
  advisory: string | null;
}

const baseline = (isWorking: boolean): { chipLabel: string; chipTone: StatusTone } =>
  isWorking ? { chipLabel: "Working", chipTone: "ok" } : { chipLabel: "Out of order", chipTone: "bad" };

// `reported_issue` is a NON-flipping advisory (backend returns it only when there is a recent
// issue report but no corroborated category) — preserve the is_working baseline chip and surface
// the advisory separately. `null`/unexpected also fall back to the baseline.
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

// Day-resolution absolute date (UTC), e.g. "Jun 12, 2026" — precise enough for a trust/audit title.
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run lib/map/format.test.ts`
Expected: PASS (all new + existing format tests).

- [ ] **Step 5: Format + commit**

```bash
pnpm exec prettier --write web/lib/map/format.ts web/lib/map/format.test.ts
git add web/lib/map/format.ts web/lib/map/format.test.ts
git commit -m "feat(web): display helpers for status, relative time, attribute consensus, category"
```

---

### Task 2: `getFountainNotesServer` in `fountains.ts`

**Files:**
- Modify: `web/lib/fountains.ts`
- Test: `web/lib/fountains.test.ts`

**Interfaces:**
- Consumes: existing `makeClient`, `resolveApiBaseUrl` (already imported in `fountains.ts`).
- Produces:
  - `export type NoteOut = components["schemas"]["NoteOut"]`
  - `getFountainNotesServer(id: string, requestId: string): Promise<{ data: NoteOut[] | undefined; status: number }>` — mirrors `getFountainDetailServer` (network error → `{ data: undefined, status: 0 }`).

- [ ] **Step 1: Write the failing tests** — append to `web/lib/fountains.test.ts`, and add `getFountainNotesServer` to the existing import on line 18 (`import { fetchBbox, getFountainDetailServer, getFountainNotesServer } from "./fountains";`):

```ts
describe("getFountainNotesServer", () => {
  it("returns data + status on success", async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: "n1" }], response: { ok: true, status: 200 } });
    expect(await getFountainNotesServer("x", "rid")).toEqual({ data: [{ id: "n1" }], status: 200 });
  });
  it("returns status without data on non-2xx", async () => {
    mockGet.mockResolvedValueOnce({ data: undefined, response: { ok: false, status: 503 } });
    expect(await getFountainNotesServer("x", "rid")).toEqual({ data: undefined, status: 503 });
  });
  it("returns { data: undefined, status: 0 } on network error", async () => {
    mockGet.mockRejectedValueOnce(new Error("network error"));
    expect(await getFountainNotesServer("x", "rid")).toEqual({ data: undefined, status: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run lib/fountains.test.ts`
Expected: FAIL — `getFountainNotesServer` is not exported.

- [ ] **Step 3: Implement** — in `web/lib/fountains.ts`, add the `NoteOut` type export next to the other type exports (line ~8), and append the function:

```ts
export type NoteOut = components["schemas"]["NoteOut"];

export async function getFountainNotesServer(id: string, requestId: string) {
  const client = makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } });
  try {
    const { data, response } = await client.GET("/api/v1/fountains/{fountain_id}/notes", {
      params: { path: { fountain_id: id } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run lib/fountains.test.ts`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
pnpm exec prettier --write web/lib/fountains.ts web/lib/fountains.test.ts
git add web/lib/fountains.ts web/lib/fountains.test.ts
git commit -m "feat(web): server-side getFountainNotesServer (non-fatal notes fetch)"
```

---

### Task 3: Document the new UI elements in the style guide (before building them)

**Files:**
- Modify: `docs/style-guide.md`

House rule (`CLAUDE.md`): check + update `docs/style-guide.md` **before** creating any new UI element. We document the three new components + the detail additions up front from the approved spec, then refine at the end of Task 7 only if an implementation detail changed. No test; verified by review.

- [ ] **Step 1: Append three subsections** under the "Detail overlay" section of `docs/style-guide.md` (after the existing "Content" table):

```markdown
#### Status block (`StatusBlock.tsx`)

A small stack under the detail heading: a status **chip**, an optional **advisory line**, and a
**trust line**.

- **Chip** — driven by the fountain's `current_status` for the corroborated categories, and by the
  `is_working` baseline otherwise:
  | `current_status` | Label | Tone |
  | --- | --- | --- |
  | `ok` | "Verified working" | emerald (`bg-emerald-100 text-emerald-800`) |
  | `degraded` | "Working — issues reported" | amber (`bg-amber-100 text-amber-800`) |
  | `not_working` | "Not working" | red (`bg-red-100 text-red-800`) |
  | `reported_issue` | baseline ("Working" / "Out of order") | emerald / red |
  | `null` / unexpected | baseline ("Working" / "Out of order") | emerald / red |
  Chip shape: `rounded-full px-2.5 py-0.5 text-xs font-bold`.
- **Advisory line** — only for `reported_issue` (a non-flipping advisory): `text-xs text-amber-700`
  with a decorative `aria-hidden` ⚠, "Issue reported recently — not yet confirmed". The baseline
  chip is preserved so the working/out-of-order distinction is never lost.
- **Trust line** — `text-xs text-slate-400`: "Last verified {relative}" (relative time, with a
  precise day-resolution date in the `title`) when `last_verified_at` is set, else "Not yet
  verified by anyone".

#### Attribute consensus (`AttributeList.tsx`)

Observed attributes grouped by category. Group heading: `text-xs font-semibold uppercase
tracking-wide text-slate-500` (category labels: physical→"Features", accessibility→"Accessibility",
access→"Access"; unknown categories title-cased). Each row: attribute name (`text-slate-600`) left,
value right with emphasis by confidence — high/medium `text-slate-700`; low `text-slate-400` + a
muted `(N reports)` hint; `mixed` `text-amber-700` "Mixed" + a muted `latest: …` hint; all-unknown
`text-slate-400` "Unknown". No raw vote tallies.

#### Community notes (`NotesList.tsx`)

A "Community notes" section (heading styled as the attribute group heading). Each note is a card
(`rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700`) with the body, then a
`text-xs text-slate-400` byline "— {author_display_name} · {relative time}" plus "· edited" when the
note was edited. The section is omitted entirely when there are no notes. The author is always the
backend's safe public `author_display_name`.
```

- [ ] **Step 2: Update the existing "Detail overlay → Content" table** intro line to note that the panel now also renders the status block, placement note (`📍` prefix, shown only when present), attribute consensus, a "from who added it" caption under the creator comment, and the community notes section.

- [ ] **Step 3: Commit**

```bash
pnpm exec prettier --write docs/style-guide.md
git add docs/style-guide.md
git commit -m "docs: style guide — status block, attribute consensus, community notes"
```

---

### Task 4: `StatusBlock` component

**Files:**
- Create: `web/components/fountain/StatusBlock.tsx`
- Test: `web/components/fountain/StatusBlock.test.tsx`

**Interfaces:**
- Consumes: `statusDisplay`, `formatRelativeTime`, `formatDateFull`, `StatusTone` (Task 1).
- Produces: `StatusBlock({ currentStatus, isWorking, lastVerifiedAt, now }: { currentStatus: string | null | undefined; isWorking: boolean; lastVerifiedAt: string | null | undefined; now: Date })`.

- [ ] **Step 1: Write the failing test** — `web/components/fountain/StatusBlock.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBlock } from "./StatusBlock";

const now = new Date("2026-06-22T12:00:00Z");

describe("StatusBlock", () => {
  it("ok: verified-working chip + relative trust line + precise title", () => {
    render(
      <StatusBlock currentStatus="ok" isWorking lastVerifiedAt="2026-06-19T12:00:00Z" now={now} />,
    );
    expect(screen.getByText("Verified working")).toBeInTheDocument();
    const trust = screen.getByText(/Last verified 3 days ago/);
    expect(trust).toHaveAttribute("title", "Jun 19, 2026");
  });
  it("reported_issue: baseline Working chip + advisory line", () => {
    render(<StatusBlock currentStatus="reported_issue" isWorking lastVerifiedAt={null} now={now} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText(/Issue reported recently/)).toBeInTheDocument();
  });
  it("null + working: baseline chip + not-yet-verified line", () => {
    render(<StatusBlock currentStatus={null} isWorking lastVerifiedAt={null} now={now} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Not yet verified by anyone")).toBeInTheDocument();
  });
  it("null + not working: out-of-order baseline", () => {
    render(<StatusBlock currentStatus={null} isWorking={false} lastVerifiedAt={null} now={now} />);
    expect(screen.getByText("Out of order")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run components/fountain/StatusBlock.test.tsx`
Expected: FAIL — `./StatusBlock` does not exist.

- [ ] **Step 3: Implement** — `web/components/fountain/StatusBlock.tsx`:

```tsx
import { statusDisplay, formatRelativeTime, formatDateFull, type StatusTone } from "../../lib/map/format";

const CHIP: Record<StatusTone, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
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
  return (
    <div className="mt-1 space-y-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${CHIP[chipTone]}`}
      >
        {chipLabel}
      </span>
      {advisory && (
        <p className="text-xs text-amber-700">
          <span aria-hidden="true">⚠ </span>
          {advisory}
        </p>
      )}
      <p className="text-xs text-slate-400">
        {lastVerifiedAt ? (
          <span title={formatDateFull(lastVerifiedAt)}>
            Last verified {formatRelativeTime(lastVerifiedAt, now)}
          </span>
        ) : (
          "Not yet verified by anyone"
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run components/fountain/StatusBlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
pnpm exec prettier --write web/components/fountain/StatusBlock.tsx web/components/fountain/StatusBlock.test.tsx
git add web/components/fountain/StatusBlock.tsx web/components/fountain/StatusBlock.test.tsx
git commit -m "feat(web): StatusBlock — current_status chip + advisory + trust line"
```

---

### Task 5: `AttributeList` component

**Files:**
- Create: `web/components/fountain/AttributeList.tsx`
- Test: `web/components/fountain/AttributeList.test.tsx`

**Interfaces:**
- Consumes: `attributeDisplay`, `formatCategory`, `AttrTone` (Task 1); `components["schemas"]["AttributeConsensusOut"]`.
- Produces: `AttributeList({ attributes }: { attributes: AttributeConsensusOut[] })` — returns `null` when empty; otherwise groups by `category` (first-seen order).

- [ ] **Step 1: Write the failing test** — `web/components/fountain/AttributeList.test.tsx` (typed fixture so a generated-client contract change fails at type-check):

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { components } from "@fountainrank/api-client";
import { describe, expect, it } from "vitest";
import { AttributeList } from "./AttributeList";

type Attr = components["schemas"]["AttributeConsensusOut"];

const attr = (over: Partial<Attr> = {}): Attr => ({
  attribute_type_id: 1,
  key: "bottle_filler",
  name: "Bottle filler",
  category: "physical",
  consensus_value: "yes",
  confidence: "high",
  yes_count: 3,
  no_count: 0,
  unknown_count: 0,
  value_counts: null,
  observation_count: 3,
  latest_observation_value: "yes",
  ...over,
});

describe("AttributeList", () => {
  it("returns null when empty", () => {
    const { container } = render(<AttributeList attributes={[]} />);
    expect(container.firstChild).toBeNull();
  });
  it("groups by category with friendly headers + values", () => {
    render(
      <AttributeList
        attributes={[
          attr(),
          attr({ attribute_type_id: 2, name: "Wheelchair reachable", category: "accessibility" }),
        ]}
      />,
    );
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("Accessibility")).toBeInTheDocument();
    expect(screen.getByText("Bottle filler")).toBeInTheDocument();
    expect(screen.getByText("Wheelchair reachable")).toBeInTheDocument();
    expect(screen.getAllByText("Yes").length).toBe(2);
  });
  it("mixed shows the latest hint", () => {
    render(
      <AttributeList
        attributes={[attr({ consensus_value: null, confidence: "mixed", latest_observation_value: "no" })]}
      />,
    );
    expect(screen.getByText("Mixed")).toBeInTheDocument();
    expect(screen.getByText("latest: No")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run components/fountain/AttributeList.test.tsx`
Expected: FAIL — `./AttributeList` does not exist.

- [ ] **Step 3: Implement** — `web/components/fountain/AttributeList.tsx`:

```tsx
import type { components } from "@fountainrank/api-client";
import { attributeDisplay, formatCategory, type AttrTone } from "../../lib/map/format";

type Attr = components["schemas"]["AttributeConsensusOut"];

const TONE: Record<AttrTone, string> = {
  normal: "text-slate-700",
  muted: "text-slate-400",
  mixed: "text-amber-700",
};

export function AttributeList({ attributes }: { attributes: Attr[] }) {
  if (attributes.length === 0) return null;
  const groups: { category: string; items: Attr[] }[] = [];
  for (const a of attributes) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) {
      g = { category: a.category, items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.category}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatCategory(g.category)}
          </h3>
          <ul className="mt-1 space-y-1">
            {g.items.map((a) => {
              const d = attributeDisplay(a);
              return (
                <li
                  key={a.attribute_type_id}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span className="text-slate-600">{a.name}</span>
                  <span className={`text-right ${TONE[d.tone]}`}>
                    {d.text}
                    {d.hint && <span className="ml-1 text-xs text-slate-400">{d.hint}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run components/fountain/AttributeList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
pnpm exec prettier --write web/components/fountain/AttributeList.tsx web/components/fountain/AttributeList.test.tsx
git add web/components/fountain/AttributeList.tsx web/components/fountain/AttributeList.test.tsx
git commit -m "feat(web): AttributeList — attribute consensus grouped by category"
```

---

### Task 6: `NotesList` component

**Files:**
- Create: `web/components/fountain/NotesList.tsx`
- Test: `web/components/fountain/NotesList.test.tsx`

**Interfaces:**
- Consumes: `formatRelativeTime` (Task 1); `NoteOut` (Task 2).
- Produces: `NotesList({ notes, now }: { notes: NoteOut[]; now: Date })` — returns `null` when empty; author rendered ONLY from `note.author_display_name`; "· edited" when `updated_at > created_at`.

- [ ] **Step 1: Write the failing test** — `web/components/fountain/NotesList.test.tsx` (typed fixture; the last case proves no other identity field leaks):

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NoteOut } from "../../lib/fountains";
import { NotesList } from "./NotesList";

const now = new Date("2026-06-22T12:00:00Z");
const note = (over: Partial<NoteOut> = {}): NoteOut => ({
  id: "n1",
  body: "Behind the restroom block",
  author_display_name: "Alex",
  created_at: "2026-06-20T12:00:00Z",
  updated_at: "2026-06-20T12:00:00Z",
  ...over,
});

describe("NotesList", () => {
  it("returns null when empty", () => {
    const { container } = render(<NotesList notes={[]} now={now} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders heading, body, author, relative time + edited marker", () => {
    render(<NotesList notes={[note({ updated_at: "2026-06-21T12:00:00Z" })]} now={now} />);
    expect(screen.getByText("Community notes")).toBeInTheDocument();
    expect(screen.getByText("Behind the restroom block")).toBeInTheDocument();
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });
  it("no edited marker when not edited", () => {
    render(<NotesList notes={[note()]} now={now} />);
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
  });
  it("renders ONLY author_display_name — no other identity field leaks", () => {
    // A widened object carrying fields the web layer must never render.
    const leaky = {
      ...note({ author_display_name: "Alex" }),
      display_name: "PRIVATE_NAME",
      user_id: "logto-subject-123",
    } as unknown as NoteOut;
    render(<NotesList notes={[leaky]} now={now} />);
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_NAME/)).not.toBeInTheDocument();
    expect(screen.queryByText(/logto-subject-123/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run components/fountain/NotesList.test.tsx`
Expected: FAIL — `./NotesList` does not exist.

- [ ] **Step 3: Implement** — `web/components/fountain/NotesList.tsx`:

```tsx
import type { NoteOut } from "../../lib/fountains";
import { formatRelativeTime } from "../../lib/map/format";

export function NotesList({ notes, now }: { notes: NoteOut[]; now: Date }) {
  if (notes.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Community notes</h3>
      <ul className="space-y-2">
        {notes.map((note) => {
          const edited = new Date(note.updated_at).getTime() > new Date(note.created_at).getTime();
          return (
            <li
              key={note.id}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
            >
              <p>{note.body}</p>
              <p className="mt-1 text-xs text-slate-400">
                — {note.author_display_name} · {formatRelativeTime(note.created_at, now)}
                {edited ? " · edited" : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run components/fountain/NotesList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
pnpm exec prettier --write web/components/fountain/NotesList.tsx web/components/fountain/NotesList.test.tsx
git add web/components/fountain/NotesList.tsx web/components/fountain/NotesList.test.tsx
git commit -m "feat(web): NotesList — community notes (safe public author, edited marker)"
```

---

### Task 7: Integrate `FountainDetail` + wire both routes (atomic — notes data flow end-to-end)

This single task changes the `FountainDetail` props contract AND both routes together, so the `notes` prop is never half-wired (no interim `tsc` break). It adds component tests (pinned clock) and **executable route tests** proving the non-fatal notes behavior.

**Files:**
- Modify: `web/components/fountain/FountainDetail.tsx` + `web/components/fountain/FountainDetail.test.tsx`
- Modify: `web/app/fountains/[id]/page.tsx` + Create `web/app/fountains/[id]/page.test.tsx`
- Modify: `web/app/@modal/(.)fountains/[id]/page.tsx` + Create `web/app/@modal/(.)fountains/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `StatusBlock` (4), `AttributeList` (5), `NotesList` (6), `NoteOut` (2), `getFountainDetailServer`/`getFountainNotesServer` (2), `log`.
- Produces: `FountainDetail({ detail, notes, now }: { detail: Detail; notes: NoteOut[]; now?: Date })` — `now` defaults to `new Date()` at render. Both routes fetch detail + notes in parallel; notes non-2xx → `notes = []` + a `warn` log of `{ requestId, id, status }` only; the `404`/`!data` detail branches are unchanged.

- [ ] **Step 1: Replace `web/components/fountain/FountainDetail.test.tsx`** with the extended, pinned-clock, typed-fixture suite:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { components } from "@fountainrank/api-client";
import type { FountainDetail as Detail } from "../../lib/fountains";
import { FountainDetail } from "./FountainDetail";

const now = new Date("2026-06-22T12:00:00Z");
const base: Detail = {
  id: "a",
  location: { latitude: 1, longitude: 2 },
  is_working: true,
  comments: null,
  average_rating: 4.3,
  rating_count: 128,
  ranking_score: 4.1,
  created_at: "2026-06-01T00:00:00Z",
  last_rated_at: "2026-06-17T00:00:00Z",
  current_status: null,
  last_verified_at: null,
  placement_note: null,
  attributes: [],
  dimensions: [
    { rating_type_id: 1, name: "Clarity", average_rating: 4.6, vote_count: 96 },
    { rating_type_id: 4, name: "Appearance", average_rating: null, vote_count: 0 },
  ],
};

describe("FountainDetail", () => {
  it("working + overall + votes", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument();
    expect(screen.getByText("128 ratings")).toBeInTheDocument();
  });
  it("out of order", () => {
    render(<FountainDetail detail={{ ...base, is_working: false }} notes={[]} now={now} />);
    expect(screen.getByText("Out of order")).toBeInTheDocument();
  });
  it("unrated overall + unrated dimension", () => {
    render(<FountainDetail detail={{ ...base, average_rating: null }} notes={[]} now={now} />);
    expect(screen.getAllByText("Not yet rated").length).toBeGreaterThan(0);
  });
  it("creator comment + caption only when present", () => {
    const { rerender } = render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.queryByText("Cold and fast")).not.toBeInTheDocument();
    rerender(<FountainDetail detail={{ ...base, comments: "Cold and fast" }} notes={[]} now={now} />);
    expect(screen.getByText("Cold and fast")).toBeInTheDocument();
    expect(screen.getByText("From the person who added this fountain")).toBeInTheDocument();
  });
  it("renders meta (added + last rated) and the Directions + Share actions", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.getByText(/Added Jun 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Last rated Jun 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });
  it("status chip reflects current_status (verified working) + relative trust", () => {
    render(
      <FountainDetail
        detail={{ ...base, current_status: "ok", last_verified_at: "2026-06-19T12:00:00Z" }}
        notes={[]}
        now={now}
      />,
    );
    expect(screen.getByText("Verified working")).toBeInTheDocument();
    expect(screen.getByText(/Last verified 3 days ago/)).toBeInTheDocument();
  });
  it("reported_issue keeps baseline chip + advisory (both baselines)", () => {
    const { rerender } = render(
      <FountainDetail detail={{ ...base, current_status: "reported_issue", is_working: true }} notes={[]} now={now} />,
    );
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText(/Issue reported recently/)).toBeInTheDocument();
    rerender(
      <FountainDetail detail={{ ...base, current_status: "reported_issue", is_working: false }} notes={[]} now={now} />,
    );
    expect(screen.getByText("Out of order")).toBeInTheDocument();
    expect(screen.getByText(/Issue reported recently/)).toBeInTheDocument();
  });
  it("placement note shown only when present", () => {
    const { rerender } = render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.queryByText(/east entrance/)).not.toBeInTheDocument();
    rerender(
      <FountainDetail
        detail={{ ...base, placement_note: "Behind the playground, east entrance" }}
        notes={[]}
        now={now}
      />,
    );
    expect(screen.getByText(/east entrance/)).toBeInTheDocument();
  });
  it("renders grouped attributes incl. a mixed latest hint", () => {
    const attributes: components["schemas"]["AttributeConsensusOut"][] = [
      {
        attribute_type_id: 1,
        key: "bottle_filler",
        name: "Bottle filler",
        category: "physical",
        consensus_value: "yes",
        confidence: "high",
        yes_count: 3,
        no_count: 0,
        unknown_count: 0,
        value_counts: null,
        observation_count: 3,
        latest_observation_value: "yes",
      },
      {
        attribute_type_id: 2,
        key: "dual_height",
        name: "Dual height",
        category: "physical",
        consensus_value: null,
        confidence: "mixed",
        yes_count: 1,
        no_count: 1,
        unknown_count: 0,
        value_counts: null,
        observation_count: 2,
        latest_observation_value: "no",
      },
    ];
    render(<FountainDetail detail={{ ...base, attributes }} notes={[]} now={now} />);
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("Bottle filler")).toBeInTheDocument();
    expect(screen.getByText("latest: No")).toBeInTheDocument();
  });
  it("renders community notes (author from author_display_name); omitted when empty", () => {
    const { rerender } = render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.queryByText("Community notes")).not.toBeInTheDocument();
    rerender(
      <FountainDetail
        detail={base}
        notes={[
          {
            id: "n1",
            body: "Hidden tap on the north wall",
            author_display_name: "Sam",
            created_at: "2026-06-20T12:00:00Z",
            updated_at: "2026-06-20T12:00:00Z",
          },
        ]}
        now={now}
      />,
    );
    expect(screen.getByText("Community notes")).toBeInTheDocument();
    expect(screen.getByText("Hidden tap on the north wall")).toBeInTheDocument();
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing route tests.**

`web/app/fountains/[id]/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDetail = vi.fn();
const getNotes = vi.fn();
const logFn = vi.fn();
const notFoundFn = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("../../../lib/fountains", () => ({
  getFountainDetailServer: (...a: unknown[]) => getDetail(...a),
  getFountainNotesServer: (...a: unknown[]) => getNotes(...a),
}));
vi.mock("../../../lib/server/log", () => ({ log: (...a: unknown[]) => logFn(...a) }));
vi.mock("next/navigation", () => ({ notFound: () => notFoundFn() }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("../../../components/fountain/FountainDetail", () => ({
  FountainDetail: ({ notes }: { notes: unknown[] }) => <div data-testid="detail">notes:{notes.length}</div>,
}));

import FountainPage from "./page";

const params = Promise.resolve({ id: "f1" });

beforeEach(() => {
  getDetail.mockReset();
  getNotes.mockReset();
  logFn.mockReset();
  notFoundFn.mockClear();
});

describe("FountainPage route (standalone)", () => {
  it("passes fetched notes through to the detail on success", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [{ id: "n1" }, { id: "n2" }], status: 200 });
    render(await FountainPage({ params }));
    expect(screen.getByTestId("detail")).toHaveTextContent("notes:2");
    expect(logFn).not.toHaveBeenCalled();
  });
  it("non-fatal notes: 503 renders detail with notes=[] and a constrained warn log", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: undefined, status: 503 });
    render(await FountainPage({ params }));
    expect(screen.getByTestId("detail")).toHaveTextContent("notes:0");
    expect(logFn).toHaveBeenCalledWith("warn", expect.stringMatching(/notes/i), {
      requestId: expect.any(String),
      id: "f1",
      status: 503,
    });
  });
  it("detail 404 calls notFound() and does not render the detail", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 404 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    await expect(FountainPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundFn).toHaveBeenCalled();
  });
  it("detail network failure (!data) renders the error UI, not a blank/crash", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 0 });
    getNotes.mockResolvedValue({ data: undefined, status: 0 });
    render(await FountainPage({ params }));
    expect(screen.getByText(/Couldn.t load this fountain/i)).toBeInTheDocument();
  });
});
```

`web/app/@modal/(.)fountains/[id]/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDetail = vi.fn();
const getNotes = vi.fn();
const logFn = vi.fn();

vi.mock("../../../../lib/fountains", () => ({
  getFountainDetailServer: (...a: unknown[]) => getDetail(...a),
  getFountainNotesServer: (...a: unknown[]) => getNotes(...a),
}));
vi.mock("../../../../lib/server/log", () => ({ log: (...a: unknown[]) => logFn(...a) }));
vi.mock("../../../../components/fountain/DetailOverlay", () => ({
  DetailOverlay: ({ children }: { children: ReactNode }) => <div data-testid="overlay">{children}</div>,
}));
vi.mock("../../../../components/fountain/FountainDetail", () => ({
  FountainDetail: ({ notes }: { notes: unknown[] }) => <div data-testid="detail">notes:{notes.length}</div>,
}));

import FountainModal from "./page";

const params = Promise.resolve({ id: "f1" });

beforeEach(() => {
  getDetail.mockReset();
  getNotes.mockReset();
  logFn.mockReset();
});

describe("FountainModal route (overlay)", () => {
  it("passes fetched notes through on success", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [{ id: "n1" }], status: 200 });
    render(await FountainModal({ params }));
    expect(screen.getByTestId("detail")).toHaveTextContent("notes:1");
    expect(logFn).not.toHaveBeenCalled();
  });
  it("non-fatal notes: 503 renders detail with notes=[] + constrained warn log", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: undefined, status: 503 });
    render(await FountainModal({ params }));
    expect(screen.getByTestId("detail")).toHaveTextContent("notes:0");
    expect(logFn).toHaveBeenCalledWith("warn", expect.stringMatching(/notes/i), {
      requestId: expect.any(String),
      id: "f1",
      status: 503,
    });
  });
  it("detail 404 renders the overlay not-found message", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 404 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    render(await FountainModal({ params }));
    expect(screen.getByText(/Fountain not found/i)).toBeInTheDocument();
  });
  it("detail network failure renders the overlay error message", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 0 });
    getNotes.mockResolvedValue({ data: undefined, status: 0 });
    render(await FountainModal({ params }));
    expect(screen.getByText(/Couldn.t load this fountain/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm --filter web exec vitest run components/fountain/FountainDetail.test.tsx "app/fountains/[id]/page.test.tsx" "app/@modal/(.)fountains/[id]/page.test.tsx"`
Expected: FAIL — `FountainDetail` doesn't accept `notes`/`now` and doesn't render the new sections; the routes don't fetch notes or pass them down.

- [ ] **Step 4: Implement `FountainDetail`** — overwrite `web/components/fountain/FountainDetail.tsx`:

```tsx
import type { FountainDetail as Detail, NoteOut } from "../../lib/fountains";
import { formatAverage, formatDate, formatDimension, formatVotes } from "../../lib/map/format";
import { ShareButton } from "./ShareButton";
import { StatusBlock } from "./StatusBlock";
import { AttributeList } from "./AttributeList";
import { NotesList } from "./NotesList";

export function FountainDetail({
  detail,
  notes,
  now,
}: {
  detail: Detail;
  notes: NoteOut[];
  now?: Date;
}) {
  const renderNow = now ?? new Date();
  const { latitude, longitude } = detail.location;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-[#0A357E]">Public drinking fountain</h1>
        <StatusBlock
          currentStatus={detail.current_status}
          isWorking={detail.is_working}
          lastVerifiedAt={detail.last_verified_at}
          now={renderNow}
        />
      </div>
      {detail.placement_note && (
        <p className="text-sm text-slate-600">
          <span aria-hidden="true">📍 </span>
          {detail.placement_note}
        </p>
      )}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-[#0A357E]">
          {formatAverage(detail.average_rating ?? null)}
        </span>
        {detail.average_rating != null && (
          <>
            <span className="text-sm text-slate-500">·</span>{" "}
            <span className="text-sm text-slate-500">{formatVotes(detail.rating_count)}</span>
          </>
        )}
      </div>
      <dl className="divide-y divide-slate-100 border-t border-slate-100">
        {detail.dimensions.map((d) => (
          <div key={d.rating_type_id} className="flex items-center justify-between py-2">
            <dt className="text-sm font-medium">{d.name}</dt>
            <dd className="text-sm text-slate-600">
              {formatDimension(d.average_rating ?? null, d.vote_count)}
            </dd>
          </div>
        ))}
      </dl>
      <AttributeList attributes={detail.attributes} />
      {detail.comments && (
        <div>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {detail.comments}
          </p>
          <p className="mt-1 text-xs text-slate-400">From the person who added this fountain</p>
        </div>
      )}
      <NotesList notes={notes} now={renderNow} />
      <p className="text-xs text-slate-400">
        Added {formatDate(detail.created_at)}
        {detail.last_rated_at ? ` · Last rated ${formatDate(detail.last_rated_at)}` : ""}
      </p>
      <div className="flex gap-2">
        <a
          href={dir}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
        >
          Directions
        </a>
        <ShareButton />
      </div>
    </div>
  );
}
```

(Note: the prior `"Rate this fountain" arrives in Phase 3b.` placeholder is intentionally removed — no future-slice copy in this read-only slice.)

- [ ] **Step 5: Wire `web/app/fountains/[id]/page.tsx`.** Change the import to add the notes fetch:

```tsx
import { getFountainDetailServer, getFountainNotesServer } from "../../../lib/fountains";
```

Replace the body from `const requestId = ...` through `getFountainDetailServer(...)` with a parallel fetch, keeping the `404`/`!data` branches that follow it unchanged:

```tsx
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const [{ data, status }, notesRes] = await Promise.all([
    getFountainDetailServer(id, requestId),
    getFountainNotesServer(id, requestId),
  ]);
```

Then replace the final success `return (...)` block:

```tsx
  const notesOk = notesRes.status >= 200 && notesRes.status < 300;
  if (!notesOk) {
    log("warn", "failed to load fountain notes", { requestId, id, status: notesRes.status });
  }
  const notes = notesOk && notesRes.data ? notesRes.data : [];
  return (
    <main className={shell}>
      <Link href="/" className="text-sm text-[#0C44A0] underline">
        ← Back to the map
      </Link>
      <div className="mt-6">
        <FountainDetail detail={data} notes={notes} />
      </div>
    </main>
  );
```

- [ ] **Step 6: Wire `web/app/@modal/(.)fountains/[id]/page.tsx`** the same way. Import:

```tsx
import { getFountainDetailServer, getFountainNotesServer } from "../../../../lib/fountains";
```

Parallel fetch:

```tsx
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const [{ data, status }, notesRes] = await Promise.all([
    getFountainDetailServer(id, requestId),
    getFountainNotesServer(id, requestId),
  ]);
```

Final success `return`:

```tsx
  const notesOk = notesRes.status >= 200 && notesRes.status < 300;
  if (!notesOk) {
    log("warn", "failed to load fountain notes (overlay)", { requestId, id, status: notesRes.status });
  }
  const notes = notesOk && notesRes.data ? notesRes.data : [];
  return (
    <DetailOverlay>
      <FountainDetail detail={data} notes={notes} />
    </DetailOverlay>
  );
```

- [ ] **Step 7: Run all affected tests to verify they pass**

Run: `pnpm --filter web exec vitest run components/fountain/FountainDetail.test.tsx "app/fountains/[id]/page.test.tsx" "app/@modal/(.)fountains/[id]/page.test.tsx"`
Expected: PASS.

- [ ] **Step 8: Type-check the whole web workspace** (the routes only become type-correct once both FountainDetail and the wiring are done):

Run: `pnpm --filter web run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 9: Format + commit**

```bash
pnpm exec prettier --write web/components/fountain/FountainDetail.tsx web/components/fountain/FountainDetail.test.tsx "web/app/fountains/[id]/page.tsx" "web/app/fountains/[id]/page.test.tsx" "web/app/@modal/(.)fountains/[id]/page.tsx" "web/app/@modal/(.)fountains/[id]/page.test.tsx"
git add web/components/fountain/FountainDetail.tsx web/components/fountain/FountainDetail.test.tsx "web/app/fountains/[id]/page.tsx" "web/app/fountains/[id]/page.test.tsx" "web/app/@modal/(.)fountains/[id]/page.tsx" "web/app/@modal/(.)fountains/[id]/page.test.tsx"
git commit -m "feat(web): surface status/attributes/notes/placement in detail + non-fatal notes fetch"
```

- [ ] **Step 10: Refine the style guide if any implementation detail drifted** from Task 3's documentation (class names, copy). If it did, edit `docs/style-guide.md` and `git commit -m "docs: align style guide with detail-enrichment implementation"`. If nothing drifted, skip.

---

## Final verification (before opening the PR)

- [ ] Run the **full** mirror: `./run.ps1 check` (backend + workspace-js + web build + mobile). Expected: all green. (`-Web` alone is NOT sufficient as the PR gate — a cross-workspace contract break must be caught.)
- [ ] `git log --oneline` shows the task commits on `feat/web-detail-enrichment` (plus the spec + plan docs commits).

---

## Self-Review (completed by plan author)

**Spec coverage:** §3.1 status block (incl. `reported_issue` baseline + advisory) → Tasks 1,4,7; §3.2 attributes incl. mixed-latest → Tasks 1,5,7; §3.3 placement note → Task 7; §3.4 comment caption + community notes → Tasks 6,7; §4 parallel non-fatal notes fetch + `now` seam + constrained logging → Tasks 2,7; §5 edge cases → helper/component/route tests; §6 testing (pinned clock, both `reported_issue` baselines, mixed boolean+enum latest, title precision, author-only field, route non-fatal behavior) → Tasks 1,4,6,7; §7 style guide (documented before the components per house rule) → Task 3 (refined in Task 7 step 10). No gaps.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; no future-slice user-facing copy.

**Type consistency:** `statusDisplay`→`{chipLabel,chipTone,advisory}` (Tasks 1,4); `attributeDisplay`→`{text,tone,hint}` (Tasks 1,5); `StatusTone`/`AttrTone` maps (Tasks 4,5); `NoteOut` produced Task 2, consumed Tasks 6,7; `getFountainNotesServer` shape `{data,status}` consumed identically in both routes (Task 7); `FountainDetail` props `{detail,notes,now?}` consumed by both routes (Task 7); typed fixtures bind tests to the generated client.
