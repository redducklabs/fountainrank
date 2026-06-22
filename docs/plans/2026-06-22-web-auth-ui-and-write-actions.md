# Web auth UI + write actions (slice 6b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the authenticated web shell (slim header, one-click sign-in that returns you where you were, avatar user menu with admin-awareness, `/admin` placeholder) and the first write actions on an existing fountain (rate / verify-report / note), with a request-time subject-based admin authority.

**Architecture:** Reads stay unauthenticated; writes go through Next.js Server Actions that fetch the Logto access token server-side (token never reaches the browser) and POST via the generated typed client, then refresh the detail. Admin authority is `ADMIN_SUBJECTS` evaluated against the verified JWT `sub` and reconciled into `User.is_admin` on every authenticated request. The header derives auth state server-side via `getViewer()` (`getLogtoContext` + `GET /me`).

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, TypeScript, Tailwind, `@logto/next` 4.2.10, `@fountainrank/api-client` (openapi-typescript), Vitest + jsdom; FastAPI + SQLAlchemy 2 async + pydantic-settings, pytest.

**Spec:** `docs/specs/2026-06-22-web-auth-ui-and-write-actions-design.md` (Codex-approved). Read it before starting; section refs below point into it.

## Global Constraints

- **No AI attribution** in commits/PRs; **no time estimates** anywhere. Conventional Commits; frequent commits; one task at a time.
- **Windows host:** file tools use backslash paths (`D:\repos\fountainrank\...`); the Bash tool is Git Bash (forward slashes). Run the task runner as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>` (no `pwsh`).
- **Local mirror gates the PR:** `./run.ps1 check` (backend + workspace-js + web build + mobile) must be green before PR. Mid-loop: `./run.ps1 check -Web` / `-Backend`. Per-web-file: `pnpm --filter web exec vitest run <path>`.
- **Web lint/format quirks:** eslint forbids duplicate imports (merge named imports into the existing line from a module); Prettier's Tailwind plugin reorders `className` utilities — run `pnpm --filter web exec prettier --write <files>` before committing so `prettier --check` passes.
- **Security invariants (spec §11):** the API access token lives only in `server-only` modules and is never serialized to the client or logged; `is_proximate` is always `false` on web; `ConditionStatus` is the hardcoded set; admin authority is the verified `sub` matched **exactly, case-sensitively, trim-only** (never lowercased); Server Action arguments are **untrusted** and validated server-side before any API call; `safeReturnPath` is the open-redirect defense and is re-validated on read in the callback.
- **Backend write endpoints already exist and are unchanged** (`POST /fountains/{id}/{ratings,conditions,notes}`); the only backend code change is the admin authority (Tasks 2–3). No DB migration, no openapi/client regeneration.
- **Style guide before UI** (spec §12): Task 1 lands the style-guide entries first.
- **ConditionStatus set:** `working | broken | low_pressure | dirty | bad_taste | blocked | seasonal_unavailable | hours_limited`.

---

## File Structure

**Backend (admin authority):**
- Modify `backend/app/config.py` — add `admin_subjects` setting + parser.
- Modify `backend/app/auth.py` — request-time admin reconciliation in `get_current_user` + transition log.
- Test `backend/tests/test_config.py` (extend), `backend/tests/test_admin_authority.py` (new).

**Web (shared auth + header):**
- Create `web/lib/return-path.ts` — `safeReturnPath`. Test `web/lib/return-path.test.ts`.
- Modify `web/app/actions/auth.ts` — add `signInWithReturn`. Modify `web/app/callback/route.ts` — honor the return cookie.
- Create `web/lib/server/viewer.ts` — `getViewer()`. Test `web/lib/server/viewer.test.ts`.
- Create `web/components/AuthControl.tsx` (client) + `web/components/SiteHeader.tsx` (server). Tests alongside.
- Modify `web/app/page.tsx` (slim hero + footer), `web/app/account/page.tsx` (use SiteHeader bar), `web/app/fountains/[id]/page.tsx` (SiteHeader + isAuthenticated).
- Create `web/app/admin/page.tsx` (+ test).

**Web (write actions):**
- Modify `web/lib/map/format.ts` — `conditionStatusLabel`. Test in `web/lib/map/format.test.ts`.
- Modify `web/lib/server/api.ts` — `getAuthedApiClientForAction`. Test in `web/lib/server/api.test.ts`.
- Create `web/app/actions/contribute.ts` (+ `web/app/actions/contribute.test.ts`).
- Create `web/components/fountain/{ContributeSection,RatingForm,ConditionForm,NoteForm}.tsx` (+ tests).
- Modify `web/components/fountain/FountainDetail.tsx` (+ test) and both detail routes (+ tests).
- Modify `web/next.config.ts` — `serverActions.allowedOrigins`.

**Deploy/docs:**
- Modify `infra/k8s/backend.yaml` + `.github/workflows/deploy.yml` — `ADMIN_SUBJECTS` env.
- Modify `docs/style-guide.md`; add a smoke-runbook entry (e.g. `docs/setup/` or the PR body) for the post-deploy authenticated-write check.

---

## Task 1: Style-guide entries for the new UI (prerequisite)

**Files:**
- Modify: `docs/style-guide.md`

Per spec §12, document the new elements before building them (slim site header hero/bar variants; auth control = sign-in button + avatar button/user menu incl. `aria-label="Open account menu"`, decorative avatar `alt=""`, menu items/divider/admin-item visibility/open-close-focus-Escape; signed-in footer contents+spacing; Contribute section; star-rating input; condition action row + "Report a problem" disclosure; note form + counter + replace copy; inline form pending/success/error convention; `/admin` placeholder). Update the "Detail overlay → Content" table.

- [ ] **Step 1:** Read `docs/style-guide.md` (note the existing hero/header section that will change).
- [ ] **Step 2:** Add the entries above, matching the existing doc's structure/voice (element name, purpose, structure, states, a11y, example classes). Use the project palette already in the guide (`#0A357E`, `#F2C200`, slate/emerald/amber/red scales).
- [ ] **Step 3:** Commit.

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): add slim header, auth control/user menu, contribute forms, /admin entries (slice 6b-1)"
```

---

## Task 2: Backend — `admin_subjects` setting

**Files:**
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_config.py`

**Interfaces:**
- Produces: `Settings.admin_subjects: list[str]` — parsed from `ADMIN_SUBJECTS` (comma-separated or JSON array; empty → `[]`); values trimmed, **not** lowercased.

- [ ] **Step 1: Write failing tests** — append to `backend/tests/test_config.py`:

```python
def test_admin_subjects_default_is_empty(monkeypatch):
    monkeypatch.delenv("ADMIN_SUBJECTS", raising=False)
    assert Settings().admin_subjects == []


def test_admin_subjects_parses_comma_separated(monkeypatch):
    monkeypatch.setenv("ADMIN_SUBJECTS", " sub-a , sub-b ")
    assert Settings().admin_subjects == ["sub-a", "sub-b"]


def test_admin_subjects_parses_json_array(monkeypatch):
    monkeypatch.setenv("ADMIN_SUBJECTS", '["sub-c"]')
    assert Settings().admin_subjects == ["sub-c"]


def test_admin_subjects_empty_env_is_empty_list(monkeypatch):
    monkeypatch.setenv("ADMIN_SUBJECTS", "")
    assert Settings().admin_subjects == []


def test_admin_subjects_not_lowercased(monkeypatch):
    # Logto sub is opaque/case-sensitive — must NOT be normalized.
    monkeypatch.setenv("ADMIN_SUBJECTS", "AbC-123")
    assert Settings().admin_subjects == ["AbC-123"]
```

- [ ] **Step 2: Run, verify fail**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd backend; uv run pytest tests/test_config.py -k admin_subjects -q"`
Expected: FAIL (`admin_subjects` attribute does not exist).

- [ ] **Step 3: Implement** — in `backend/app/config.py`, add the field next to `cors_allow_origins` (reuse the `NoDecode` + before-validator pattern):

```python
    # Logto subjects (the validated JWT `sub`) granted admin. Opaque, case-sensitive ids —
    # trimmed but NEVER lowercased. NoDecode + a custom parser: a bare list[str] from env
    # crashes startup on a comma-separated/empty value (same reasoning as cors_allow_origins).
    admin_subjects: Annotated[list[str], NoDecode] = []

    @field_validator("admin_subjects", mode="before")
    @classmethod
    def _parse_admin_subjects(cls, v: object) -> object:
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                return json.loads(s)
            return [sub.strip() for sub in s.split(",") if sub.strip()]
        return v
```

- [ ] **Step 4: Run, verify pass**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd backend; uv run pytest tests/test_config.py -q"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/test_config.py
git commit -m "feat(backend): ADMIN_SUBJECTS setting (case-sensitive subject allowlist) (slice 6b-1)"
```

---

## Task 3: Backend — request-time admin reconciliation

**Files:**
- Modify: `backend/app/auth.py`
- Test: `backend/tests/test_admin_authority.py` (new)

**Interfaces:**
- Consumes: `Settings.admin_subjects` (Task 2).
- Produces: after every authenticated request, `User.is_admin == (sub in settings.admin_subjects)` (write-if-changed); a structured `admin status changed` log line on transition.

Reconcile in `get_current_user` for BOTH the real-JWT path (`sub`) and the dev-auth seam (`x_dev_user`). Add a helper to keep both paths DRY.

- [ ] **Step 1: Write failing tests** — `backend/tests/test_admin_authority.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.main import app


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def _get_me(headers):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.get("/api/v1/me", headers=headers)


async def test_subject_in_allowlist_is_admin(settings_override):
    settings_override(dev_auth_enabled=True, admin_subjects=["logto-admin"])
    resp = await _get_me({"X-Dev-User": "logto-admin"})
    assert resp.status_code == 200
    assert resp.json()["is_admin"] is True


async def test_subject_not_in_allowlist_is_not_admin(settings_override):
    settings_override(dev_auth_enabled=True, admin_subjects=["logto-admin"])
    resp = await _get_me({"X-Dev-User": "logto-regular"})
    assert resp.json()["is_admin"] is False


async def test_admin_demoted_when_removed_from_allowlist(settings_override):
    # Promote, then reconcile to a config without the subject -> demoted on next request.
    settings_override(dev_auth_enabled=True, admin_subjects=["logto-x"])
    assert (await _get_me({"X-Dev-User": "logto-x"})).json()["is_admin"] is True
    settings_override(dev_auth_enabled=True, admin_subjects=[])
    assert (await _get_me({"X-Dev-User": "logto-x"})).json()["is_admin"] is False


async def test_case_sensitive_subject_match(settings_override):
    settings_override(dev_auth_enabled=True, admin_subjects=["AbC"])
    assert (await _get_me({"X-Dev-User": "abc"})).json()["is_admin"] is False


async def test_write_endpoint_works_immediately_after_admin_transition(settings_override):
    # The reconciliation commit inside get_current_user must not break the write
    # endpoint's own transaction on the shared AsyncSession.
    settings_override(dev_auth_enabled=True, admin_subjects=["logto-writer"])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 5.0, "longitude": 6.0}, "is_working": True},
            headers={"X-Dev-User": "logto-writer"},
        )
    assert resp.status_code == 201
```

- [ ] **Step 2: Run, verify fail**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd backend; uv run pytest tests/test_admin_authority.py -q"`
Expected: FAIL (admin reconciliation not implemented → `is_admin` stays False; demotion test fails).

- [ ] **Step 3: Implement** — in `backend/app/auth.py`, add a helper and call it from both branches of `get_current_user` after the user is resolved:

```python
async def _reconcile_admin(
    session: AsyncSession, user: User, sub: str, settings: Settings
) -> User:
    """Authoritative, request-time admin reconciliation: User.is_admin tracks
    `sub in settings.admin_subjects` (exact, case-sensitive). Write-if-changed only —
    steady state issues no write. Grant and demotion both take effect on the next
    authenticated request. The user row is already provisioned; this independent update
    is committed here so /me and admin gates read a fresh value."""
    desired = sub in settings.admin_subjects
    if user.is_admin != desired:
        previous = user.is_admin
        user.is_admin = desired
        await session.commit()
        await session.refresh(user)
        logger.info(
            "admin status changed",
            extra={"sub": sub, "previous": previous, "current": desired},
        )
    return user
```

Then in `get_current_user`, replace the two `return await get_or_create_user(...)` calls with provision-then-reconcile, e.g. for the real path:

```python
        user = await get_or_create_user(
            session, logto_user_id=sub, email=email, display_name=display_name
        )
        return await _reconcile_admin(session, user, sub, settings)
```

and for the dev path:

```python
    if settings.dev_auth_enabled and x_dev_user:
        user = await get_or_create_user(
            session,
            logto_user_id=x_dev_user,
            email=x_dev_email or f"{x_dev_user}@dev.local",
            display_name=x_dev_name or x_dev_user,
        )
        return await _reconcile_admin(session, user, x_dev_user, settings)
```

(The `extra={"sub": ...}` mirrors the existing debug auth log; `sub` is already validated and logged at debug. Never log `settings.admin_subjects` or any email.)

- [ ] **Step 4: Run, verify pass** (this file, then the auth/me suites for regressions)

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd backend; uv run pytest tests/test_admin_authority.py tests/test_me.py tests/test_auth_seam.py -q"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth.py backend/tests/test_admin_authority.py
git commit -m "feat(backend): request-time admin reconciliation from ADMIN_SUBJECTS (slice 6b-1)"
```

---

## Task 4: Web — `safeReturnPath`

**Files:**
- Create: `web/lib/return-path.ts`
- Test: `web/lib/return-path.test.ts`

**Interfaces:**
- Produces: `safeReturnPath(value: string | null | undefined): string | null` — returns the value when it is a safe internal path, else `null`.

- [ ] **Step 1: Write failing test** — `web/lib/return-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("accepts safe internal paths", () => {
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/fountains/123e4567-e89b-12d3-a456-426614174000")).toBe(
      "/fountains/123e4567-e89b-12d3-a456-426614174000",
    );
    expect(safeReturnPath("/account?x=1#h")).toBe("/account?x=1#h");
  });

  it("rejects empty / nullish", () => {
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });

  it("rejects protocol-relative, absolute, and scheme URLs", () => {
    expect(safeReturnPath("//evil.com")).toBeNull();
    expect(safeReturnPath("https://evil.com")).toBeNull();
    expect(safeReturnPath("http:/evil")).toBeNull();
    expect(safeReturnPath("not-a-path")).toBeNull();
  });

  it("rejects backslashes and encoded hostile forms", () => {
    expect(safeReturnPath("/\\evil")).toBeNull();
    expect(safeReturnPath("/%5c%5cevil")).toBeNull();
    expect(safeReturnPath("/%2f%2fevil")).toBeNull();
    expect(safeReturnPath("/%00null")).toBeNull();
  });

  it("rejects control chars and unicode line/paragraph separators", () => {
    expect(safeReturnPath("/a" + String.fromCharCode(0x01) + "b")).toBeNull();
    expect(safeReturnPath("/a" + String.fromCharCode(0x2028) + "b")).toBeNull();
    expect(safeReturnPath("/a" + String.fromCharCode(0x2029) + "b")).toBeNull();
  });

  it("rejects malformed percent-encoding and overly long values", () => {
    expect(safeReturnPath("/%zz")).toBeNull();
    expect(safeReturnPath("/" + "a".repeat(600))).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter web exec vitest run lib/return-path.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `web/lib/return-path.ts`:

```ts
// Open-redirect defense for the post-sign-in return path. Accepts ONLY a safe internal
// path; everything else -> null. Re-validated on read in app/callback/route.ts.
function hasControlOrSeparator(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  // Must be a single-slash-rooted path (reject protocol-relative `//` and `/\`).
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\")) return null;
  if (value.includes("://")) return null;
  if (hasControlOrSeparator(value)) return null;
  // Decode percent-encoding once and re-apply the checks so encoded hostile forms
  // (%5c, %2f%2f, %00, ...) can't slip through. Malformed % -> reject.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    decoded.includes("\\") || // any backslash (e.g. decoded %5c) is hostile
    decoded.startsWith("//") || // protocol-relative after decode (covers decoded %2f%2f -> ///)
    decoded.startsWith("/\\") ||
    hasControlOrSeparator(decoded)
  ) {
    return null;
  }
  // Note: a `//` *inside* the path (e.g. `/foo//bar`) is allowed — only a protocol-relative
  // START is an open-redirect risk.
  return value;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter web exec vitest run lib/return-path.test.ts`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
pnpm --filter web exec prettier --write web/lib/return-path.ts web/lib/return-path.test.ts
git add web/lib/return-path.ts web/lib/return-path.test.ts
git commit -m "feat(web): safeReturnPath open-redirect-safe internal path validator (slice 6b-1)"
```

---

## Task 5: Web — `signInWithReturn` action + callback return-path

**Files:**
- Modify: `web/app/actions/auth.ts`
- Modify: `web/app/callback/route.ts`
- Test: `web/app/actions/auth.test.ts` (new)

**Interfaces:**
- Consumes: `safeReturnPath` (Task 4), `getLogtoConfig`, `signIn`/`handleSignIn`.
- Produces: `signInWithReturn(returnTo: string): Promise<void>` (sets the `fr_return_to` cookie when valid, then `signIn`). Cookie: name `fr_return_to`, `path:"/"`, `httpOnly`, `sameSite:"lax"`, `secure` in prod, `maxAge: 600`.

- [ ] **Step 1: Write failing test** — `web/app/actions/auth.test.ts` (mock `@logto/next/server-actions`, `next/headers`, `../../lib/logto`):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const { signIn, cookieSet } = vi.hoisted(() => ({ signIn: vi.fn(), cookieSet: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ signIn, signOut: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock("../../lib/logto", () => ({
  getLogtoConfig: () => ({ baseUrl: "https://fountainrank.com" }),
}));

import { signInWithReturn } from "./auth";

afterEach(() => vi.clearAllMocks());

describe("signInWithReturn", () => {
  it("sets the return cookie for a safe path then signs in", async () => {
    await signInWithReturn("/fountains/123e4567-e89b-12d3-a456-426614174000");
    expect(cookieSet).toHaveBeenCalledWith(
      "fr_return_to",
      "/fountains/123e4567-e89b-12d3-a456-426614174000",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 }),
    );
    expect(signIn).toHaveBeenCalledWith(
      expect.anything(),
      "https://fountainrank.com/callback",
    );
  });

  it("does not set a cookie for an unsafe path but still signs in", async () => {
    await signInWithReturn("//evil.com");
    expect(cookieSet).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter web exec vitest run app/actions/auth.test.ts`
Expected: FAIL (`signInWithReturn` not exported).

- [ ] **Step 3: Implement** — add to `web/app/actions/auth.ts` (keep existing `signInAction`/`signOutAction`; merge imports per the no-duplicate-import rule):

```ts
import { cookies } from "next/headers";
import { signIn, signOut } from "@logto/next/server-actions";
import { getLogtoConfig } from "../../lib/logto";
import { safeReturnPath } from "../../lib/return-path";

export const RETURN_COOKIE = "fr_return_to";

export async function signInWithReturn(returnTo: string): Promise<void> {
  const config = getLogtoConfig();
  const safe = safeReturnPath(returnTo);
  if (safe) {
    const store = await cookies();
    store.set(RETURN_COOKIE, safe, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
  }
  await signIn(config, `${config.baseUrl}/callback`);
}
```

- [ ] **Step 4: Implement callback** — in `web/app/callback/route.ts`, after a successful `handleSignIn`, read+delete+re-validate the cookie and redirect there (fallback `/account`). Replace the final redirect logic:

```ts
import { cookies } from "next/headers";
import { safeReturnPath } from "../../lib/return-path";
import { RETURN_COOKIE } from "../actions/auth";
// ... existing imports ...

// inside GET, replace `redirect(ok ? "/account" : "/account?error=signin");` with:
  if (!ok) redirect("/account?error=signin");
  const store = await cookies();
  const raw = store.get(RETURN_COOKIE)?.value;
  store.delete({ name: RETURN_COOKIE, path: "/" });
  redirect(safeReturnPath(raw) ?? "/account");
```

(Keep the `isNextRedirect` rethrow and the rule that `redirect()` runs OUTSIDE the try/catch.)

- [ ] **Step 5: Run tests + format + commit**

Run: `pnpm --filter web exec vitest run app/actions/auth.test.ts`
Expected: PASS.

```bash
pnpm --filter web exec prettier --write web/app/actions/auth.ts web/app/callback/route.ts web/app/actions/auth.test.ts
git add web/app/actions/auth.ts web/app/callback/route.ts web/app/actions/auth.test.ts
git commit -m "feat(web): signInWithReturn + callback return-path (returns user to where they signed in) (slice 6b-1)"
```

---

## Task 6: Web — `getViewer()`

**Files:**
- Create: `web/lib/server/viewer.ts`
- Test: `web/lib/server/viewer.test.ts`

**Interfaces:**
- Consumes: `getLogtoContext`, `getAuthedApiClient` (existing), `getLogtoConfig`, `log`.
- Produces:
```ts
export type Viewer =
  | { state: "anonymous" }
  | { state: "authed"; displayName: string; avatarUrl: string | null; isAdmin: boolean }
  | { state: "error" };
export function getViewer(requestId: string): Promise<Viewer>;
```

- [ ] **Step 1: Write failing test** — `web/lib/server/viewer.test.ts` (mirror `api.test.ts` hoisted-mock style):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const { getLogtoContext, GET } = vi.hoisted(() => ({ getLogtoContext: vi.fn(), GET: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ getLogtoContext, getAccessTokenRSC: vi.fn() }));
vi.mock("./api", () => ({ getAuthedApiClient: vi.fn(async () => ({ GET })) }));
vi.mock("../logto", () => ({ getLogtoConfig: () => ({}), API_RESOURCE: "https://api" }));

import { getViewer } from "./viewer";

afterEach(() => vi.clearAllMocks());

describe("getViewer", () => {
  it("returns anonymous when not authenticated", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: false });
    expect(await getViewer("r1")).toEqual({ state: "anonymous" });
  });

  it("returns anonymous when getLogtoContext throws (broken session)", async () => {
    getLogtoContext.mockRejectedValue(new Error("bad cookie"));
    expect(await getViewer("r1")).toEqual({ state: "anonymous" });
  });

  it("returns authed with profile on success", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockResolvedValue({
      data: { display_name: "Aron", avatar_url: "http://a", is_admin: true },
      response: { status: 200 },
    });
    expect(await getViewer("r1")).toEqual({
      state: "authed",
      displayName: "Aron",
      avatarUrl: "http://a",
      isAdmin: true,
    });
  });

  it("returns anonymous when /me is 401 (session no longer usable)", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockResolvedValue({ data: undefined, response: { status: 401 } });
    expect(await getViewer("r1")).toEqual({ state: "anonymous" });
  });

  it("returns error when /me is 5xx (backend down) — never silently non-admin", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockResolvedValue({ data: undefined, response: { status: 503 } });
    expect(await getViewer("r1")).toEqual({ state: "error" });
  });

  it("returns error when /me throws", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockRejectedValue(new Error("network"));
    expect(await getViewer("r1")).toEqual({ state: "error" });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter web exec vitest run lib/server/viewer.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `web/lib/server/viewer.ts`:

```ts
import "server-only";
import { getLogtoContext } from "@logto/next/server-actions";
import { getLogtoConfig } from "../logto";
import { getAuthedApiClient } from "./api";
import { log } from "./log";

export type Viewer =
  | { state: "anonymous" }
  | { state: "authed"; displayName: string; avatarUrl: string | null; isAdmin: boolean }
  | { state: "error" };

export async function getViewer(requestId: string): Promise<Viewer> {
  // A broken/expired/malformed session cookie can make getLogtoContext throw — that means
  // the session is no longer usable, so treat it as anonymous (offer sign-in), never crash
  // the header/page.
  let isAuthenticated = false;
  try {
    ({ isAuthenticated } = await getLogtoContext(getLogtoConfig(), { fetchUserInfo: false }));
  } catch {
    return { state: "anonymous" };
  }
  if (!isAuthenticated) return { state: "anonymous" };
  try {
    const client = await getAuthedApiClient(requestId);
    const { data, response } = await client.GET("/api/v1/me");
    const status = response?.status ?? 0;
    if (data) {
      return {
        state: "authed",
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        isAdmin: data.is_admin,
      };
    }
    if (status === 401) return { state: "anonymous" }; // session no longer usable
    log("warn", "viewer /me failed", { requestId, status });
    return { state: "error" };
  } catch (err) {
    log("error", "viewer /me error", { requestId, reason: (err as Error).name });
    return { state: "error" };
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter web exec vitest run lib/server/viewer.test.ts`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
pnpm --filter web exec prettier --write web/lib/server/viewer.ts web/lib/server/viewer.test.ts
git add web/lib/server/viewer.ts web/lib/server/viewer.test.ts
git commit -m "feat(web): getViewer server auth-state (anonymous/authed/error, fail-closed) (slice 6b-1)"
```

---

## Task 7: Web — `AuthControl` + `SiteHeader`

**Files:**
- Create: `web/components/AuthControl.tsx` (client), `web/components/SiteHeader.tsx` (server)
- Test: `web/components/AuthControl.test.tsx`, `web/components/SiteHeader.test.tsx`

**Interfaces:**
- Consumes: `Viewer` (Task 6), `getViewer` (SiteHeader), `signInWithReturn` (Task 5), `signOutAction` (existing).
- Produces: `AuthControl({ viewer }: { viewer: Viewer })`; `SiteHeader({ variant }: { variant: "hero" | "bar" })` (async server component).

`AuthControl` is a client component; it computes `returnTo` from `usePathname()` + `useSearchParams()` and binds it to `signInWithReturn`. The user menu is a button + dropdown with `aria-haspopup="menu"`, `aria-expanded`, `role="menu"`/`menuitem`, Escape + outside-click to close, focus first item on open and restore to the button on close. Admin item renders only when `viewer.state === "authed" && viewer.isAdmin`. Style per Task 1.

- [ ] **Step 1: Write failing tests** — `web/components/AuthControl.test.tsx` (`// @vitest-environment jsdom`, mock the actions, use `@testing-library/react`):

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

vi.mock("../app/actions/auth", () => ({ signInWithReturn: vi.fn(), signOutAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/fountains/abc",
  useSearchParams: () => new URLSearchParams(""),
}));

import { AuthControl } from "./AuthControl";

afterEach(cleanup);

describe("AuthControl", () => {
  it("shows Sign in when anonymous", () => {
    render(<AuthControl viewer={{ state: "anonymous" }} />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("authed shows avatar menu with Account + Sign out, no Admin for non-admin", () => {
    render(
      <AuthControl
        viewer={{ state: "authed", displayName: "Aron", avatarUrl: null, isAdmin: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    expect(screen.getByRole("menuitem", { name: /your account/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /admin/i })).toBeNull();
  });

  it("authed admin shows the Admin item", () => {
    render(
      <AuthControl
        viewer={{ state: "authed", displayName: "Aron", avatarUrl: null, isAdmin: true }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    expect(screen.getByRole("menuitem", { name: /admin/i })).toBeTruthy();
  });

  it("error state shows a degraded menu without Admin", () => {
    render(<AuthControl viewer={{ state: "error" }} />);
    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    expect(screen.queryByRole("menuitem", { name: /admin/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeTruthy();
  });

  it("closes the menu on Escape", () => {
    render(
      <AuthControl
        viewer={{ state: "authed", displayName: "Aron", avatarUrl: null, isAdmin: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run components/AuthControl.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement `AuthControl.tsx`** (client). Sign-in branch:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signInWithReturn, signOutAction } from "../app/actions/auth";
import type { Viewer } from "../lib/server/viewer";

export function AuthControl({ viewer }: { viewer: Viewer }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const returnTo = pathname + (search?.toString() ? `?${search.toString()}` : "");

  if (viewer.state === "anonymous") {
    return (
      <form action={signInWithReturn.bind(null, returnTo)}>
        <button
          type="submit"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#F2C200] px-5 py-2 text-sm font-semibold text-[#0A357E] transition hover:bg-[#ffce1f]"
        >
          Sign in
        </button>
      </form>
    );
  }

  const isAdmin = viewer.state === "authed" && viewer.isAdmin;
  const name = viewer.state === "authed" ? viewer.displayName : "";
  const avatarUrl = viewer.state === "authed" ? viewer.avatarUrl : null;
  return <UserMenu name={name} avatarUrl={avatarUrl} isAdmin={isAdmin} degraded={viewer.state === "error"} />;
}

function UserMenu({
  name,
  avatarUrl,
  isAdmin,
  degraded,
}: {
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  degraded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white/20 text-sm font-semibold text-white"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external avatar host
          <img src={avatarUrl} alt="" width={36} height={36} className="h-9 w-9 object-cover" />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg"
        >
          {name && <p className="px-3 py-2 text-sm font-semibold text-slate-700">{name}</p>}
          {degraded && (
            <p className="px-3 py-1 text-xs text-amber-700">Couldn&rsquo;t load your account.</p>
          )}
          <Link role="menuitem" href="/account" className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Your account
          </Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Admin
            </Link>
          )}
          <div className="my-1 border-t border-slate-100" />
          <form action={signOutAction}>
            <button
              role="menuitem"
              type="submit"
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run AuthControl test, verify pass.** `pnpm --filter web exec vitest run components/AuthControl.test.tsx` → PASS.

- [ ] **Step 5: Implement `SiteHeader.tsx`** (server) + test. It calls `getViewer`, renders the logo + `AuthControl`, and the tagline when `variant === "hero"`:

```tsx
import Image from "next/image";
import Link from "next/link";
import { AuthControl } from "./AuthControl";
import { getViewer } from "../lib/server/viewer";

export async function SiteHeader({ variant }: { variant: "hero" | "bar" }) {
  const requestId = crypto.randomUUID();
  const viewer = await getViewer(requestId);
  return (
    <header className="bg-gradient-to-b from-[#0A357E] to-[#0E4DA4] px-6 py-3 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link href="/" aria-label="FountainRank home">
          <Image
            src="/fountainrank-logo.png"
            alt="FountainRank"
            width={480}
            height={205}
            priority
            className="h-9 w-auto"
          />
        </Link>
        <AuthControl viewer={viewer} />
      </div>
      {variant === "hero" && (
        <p className="mx-auto mt-2 max-w-6xl text-sm font-semibold sm:text-base">
          Find a drinking fountain near you.
        </p>
      )}
    </header>
  );
}
```

`SiteHeader.test.tsx` (mock `getViewer` + `AuthControl`):

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../lib/server/viewer", () => ({ getViewer: vi.fn(async () => ({ state: "anonymous" })) }));
vi.mock("./AuthControl", () => ({ AuthControl: () => <div data-testid="auth-control" /> }));

import { SiteHeader } from "./SiteHeader";

afterEach(cleanup);

describe("SiteHeader", () => {
  it("hero variant shows the tagline", async () => {
    render(await SiteHeader({ variant: "hero" }));
    expect(screen.getByText(/find a drinking fountain near you/i)).toBeTruthy();
    expect(screen.getByTestId("auth-control")).toBeTruthy();
  });

  it("bar variant has no tagline", async () => {
    render(await SiteHeader({ variant: "bar" }));
    expect(screen.queryByText(/find a drinking fountain near you/i)).toBeNull();
  });
});
```

- [ ] **Step 6: Run both component tests, verify pass.** `pnpm --filter web exec vitest run components/AuthControl.test.tsx components/SiteHeader.test.tsx`

- [ ] **Step 7: Format + commit**

```bash
pnpm --filter web exec prettier --write web/components/AuthControl.tsx web/components/SiteHeader.tsx web/components/AuthControl.test.tsx web/components/SiteHeader.test.tsx
git add web/components/AuthControl.tsx web/components/SiteHeader.tsx web/components/AuthControl.test.tsx web/components/SiteHeader.test.tsx
git commit -m "feat(web): SiteHeader + AuthControl (avatar user menu, admin-aware, fail-closed) (slice 6b-1)"
```

---

## Task 8: Web — wire the header into pages (slim map hero, footer, subpages)

**Files:**
- Modify: `web/app/page.tsx`, `web/app/account/page.tsx`, `web/app/fountains/[id]/page.tsx`
- Test: `web/app/page.test.tsx` (new, light)

**Interfaces:** Consumes `SiteHeader` (Task 7). The map page replaces its tall hero with `<SiteHeader variant="hero" />`; the footer "Sign in" link is removed (sign-in now lives in the header). `/account` and the fountain standalone page render `<SiteHeader variant="bar" />` at the top.

- [ ] **Step 1:** In `web/app/page.tsx`: add `export const dynamic = "force-dynamic";` (the header reads the session cookie); replace the entire `<header>…</header>` block with `<SiteHeader variant="hero" />`; remove the footer's `Sign in` `<Link>` (keep Privacy/Terms/©). Import `SiteHeader`; drop now-unused `Image`/hero imports if unused.
- [ ] **Step 2:** In `web/app/account/page.tsx` and `web/app/fountains/[id]/page.tsx`: render `<SiteHeader variant="bar" />` above the existing main content (import it; keep the existing `← Back to the map` link on the fountain page).
- [ ] **Step 3: Write a light test** `web/app/page.test.tsx` mocking `SiteHeader` and `MapBrowserLoader` to assert the page renders the header and no longer renders a footer "Sign in" link:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="site-header" /> }));
vi.mock("../components/map/MapBrowserLoader", () => ({ default: () => <div data-testid="map" /> }));

import Home from "./page";

afterEach(cleanup);

it("renders the site header and no footer sign-in link", () => {
  render(<Home />);
  expect(screen.getByTestId("site-header")).toBeTruthy();
  expect(screen.queryByText(/^sign in$/i)).toBeNull();
});
```

- [ ] **Step 4: Run** `pnpm --filter web exec vitest run app/page.test.tsx` → PASS. Then `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Web` for lint/build (catches unused imports + Tailwind ordering).
- [ ] **Step 5: Format + commit**

```bash
pnpm --filter web exec prettier --write web/app/page.tsx web/app/account/page.tsx web/app/fountains/[id]/page.tsx web/app/page.test.tsx
git add web/app/page.tsx web/app/account/page.tsx web/app/fountains/[id]/page.tsx web/app/page.test.tsx
git commit -m "feat(web): slim map hero + global SiteHeader on map/account/detail; remove footer sign-in (slice 6b-1)"
```

---

## Task 9: Web — `/admin` placeholder (fail-closed gate)

**Files:**
- Create: `web/app/admin/page.tsx`
- Test: `web/app/admin/page.test.tsx`

**Interfaces:** Consumes `getViewer` (Task 6), `SiteHeader`, `signInWithReturn` (Task 5). Anonymous → render a **sign-in prompt form** bound to `/admin` (NOT an RSC redirect/cookie mutation — see the MAJOR fix below); authed non-admin → `notFound()`; `error` → retry state (not admin content, not 404); admin → stub.

- [ ] **Step 1: Write failing test** — `web/app/admin/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { getViewer, notFound } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("../../lib/server/viewer", () => ({ getViewer }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="hdr" /> }));
vi.mock("../actions/auth", () => ({ signInWithReturn: vi.fn() }));

import AdminPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders a sign-in prompt for anonymous (no cookie mutation during render)", async () => {
  getViewer.mockResolvedValue({ state: "anonymous" });
  render(await AdminPage());
  // Assert the ADMIN-specific prompt (a stable contract that the return path is preserved),
  // not just any sign-in button — so a future edit can't silently drop the /admin context.
  expect(screen.getByText(/sign in to access the admin tools/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
});

it("404s a non-admin", async () => {
  getViewer.mockResolvedValue({ state: "authed", displayName: "x", avatarUrl: null, isAdmin: false });
  await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
});

it("shows a retry state on error (not admin content, not 404)", async () => {
  getViewer.mockResolvedValue({ state: "error" });
  render(await AdminPage());
  expect(screen.getByText(/couldn.t verify admin access/i)).toBeTruthy();
  expect(notFound).not.toHaveBeenCalled();
});

it("renders the stub for an admin", async () => {
  getViewer.mockResolvedValue({ state: "authed", displayName: "x", avatarUrl: null, isAdmin: true });
  render(await AdminPage());
  expect(screen.getByText(/moderation tools/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run app/admin/page.test.tsx`

- [ ] **Step 3: Implement** — `web/app/admin/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { SiteHeader } from "../../components/SiteHeader";
import { getViewer } from "../../lib/server/viewer";
import { signInWithReturn } from "../actions/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await getViewer(crypto.randomUUID());
  if (viewer.state === "anonymous") {
    // IMPORTANT: do NOT call signInWithReturn() directly here — it mutates cookies, which is
    // only allowed in a Server Action / Route Handler, never during an RSC render. Render a
    // sign-in FORM instead; submitting it runs the action in a valid (cookie-writable) context.
    return (
      <>
        <SiteHeader variant="bar" />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-lg font-bold text-[#0A357E]">Admin</h1>
          <p className="mt-2 text-slate-600">Sign in to access the admin tools.</p>
          <form action={signInWithReturn.bind(null, "/admin")} className="mt-3">
            <button
              type="submit"
              className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
            >
              Sign in
            </button>
          </form>
        </main>
      </>
    );
  }
  if (viewer.state === "error") {
    return (
      <>
        <SiteHeader variant="bar" />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-lg font-bold text-[#0A357E]">Couldn&rsquo;t verify admin access</h1>
          <p className="mt-2 text-slate-600">Please try again in a moment.</p>
        </main>
      </>
    );
  }
  if (!viewer.isAdmin) notFound();
  return (
    <>
      <SiteHeader variant="bar" />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-lg font-bold text-[#0A357E]">Admin</h1>
        <p className="mt-2 text-slate-600">Moderation tools are coming soon.</p>
        <ul className="mt-4 list-disc pl-5 text-sm text-slate-500">
          <li>Hide / unhide fountains and notes</li>
          <li>Review reported content</li>
        </ul>
      </main>
    </>
  );
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web exec vitest run app/admin/page.test.tsx`
- [ ] **Step 5: Format + commit**

```bash
pnpm --filter web exec prettier --write web/app/admin/page.tsx web/app/admin/page.test.tsx
git add web/app/admin/page.tsx web/app/admin/page.test.tsx
git commit -m "feat(web): /admin placeholder, server-gated fail-closed on is_admin (slice 6b-1)"
```

---

## Task 10: Web — `conditionStatusLabel` helper

**Files:**
- Modify: `web/lib/map/format.ts`
- Test: `web/lib/map/format.test.ts`

**Interfaces:** Produces `conditionStatusLabel(status: string): string`.

- [ ] **Step 1: Write failing test** — append to `web/lib/map/format.test.ts`:

```ts
import { conditionStatusLabel } from "./format";

describe("conditionStatusLabel", () => {
  it("maps the known statuses", () => {
    expect(conditionStatusLabel("working")).toBe("It's working");
    expect(conditionStatusLabel("broken")).toBe("Broken / not working");
    expect(conditionStatusLabel("low_pressure")).toBe("Low water pressure");
    expect(conditionStatusLabel("dirty")).toBe("Dirty");
    expect(conditionStatusLabel("bad_taste")).toBe("Bad taste");
    expect(conditionStatusLabel("blocked")).toBe("Blocked / clogged");
    expect(conditionStatusLabel("seasonal_unavailable")).toBe("Shut off for the season");
    expect(conditionStatusLabel("hours_limited")).toBe("Only available certain hours");
  });
  it("title-cases an unknown status generically", () => {
    expect(conditionStatusLabel("some_new_status")).toBe("Some new status");
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run lib/map/format.test.ts -t conditionStatusLabel`

- [ ] **Step 3: Implement** — add to `web/lib/map/format.ts`:

```ts
const CONDITION_LABELS: Record<string, string> = {
  working: "It's working",
  broken: "Broken / not working",
  low_pressure: "Low water pressure",
  dirty: "Dirty",
  bad_taste: "Bad taste",
  blocked: "Blocked / clogged",
  seasonal_unavailable: "Shut off for the season",
  hours_limited: "Only available certain hours",
};

export function conditionStatusLabel(status: string): string {
  const known = CONDITION_LABELS[status];
  if (known) return known;
  const words = status.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web exec vitest run lib/map/format.test.ts`
- [ ] **Step 5: Format + commit**

```bash
pnpm --filter web exec prettier --write web/lib/map/format.ts web/lib/map/format.test.ts
git add web/lib/map/format.ts web/lib/map/format.test.ts
git commit -m "feat(web): conditionStatusLabel helper for problem statuses (slice 6b-1)"
```

---

## Task 11: Web — authed action client + Contribute server actions + CSRF origins

**Files:**
- Modify: `web/lib/server/api.ts` (+ `web/lib/server/api.test.ts`)
- Create: `web/app/actions/contribute.ts` (+ `web/app/actions/contribute.test.ts`)
- Modify: `web/next.config.ts`

**Interfaces:**
- Produces: `getAuthedApiClientForAction(requestId: string): Promise<ApiClient>` (uses `getAccessToken`, the server-action token).
- Produces (contribute.ts):
```ts
import type { components } from "@fountainrank/api-client";
type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];
export type ContributeError = "unauthenticated" | "validation" | "not_found" | "server";
export type ActionResult = { ok: true } | { ok: false; error: ContributeError };
export function submitRating(fountainId: string, ratings: { rating_type_id: number; stars: number }[]): Promise<ActionResult>;
export function submitCondition(fountainId: string, status: ConditionStatus): Promise<ActionResult>;
export function submitNote(fountainId: string, body: string): Promise<ActionResult>;
```

- [ ] **Step 1: Write failing test for `getAuthedApiClientForAction`** — append to `web/lib/server/api.test.ts` (add `getAccessToken` to the hoisted mock + the `@logto/next/server-actions` mock):

```ts
// in vi.hoisted: add getAccessToken: vi.fn()
// in vi.mock("@logto/next/server-actions", ...): include getAccessToken
import { getAuthedApiClientForAction } from "./api";

describe("getAuthedApiClientForAction", () => {
  it("mints a server-action token and attaches it", async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    getAccessToken.mockResolvedValue("tok-act");
    const sentinel = { POST: vi.fn() };
    makeClient.mockReturnValue(sentinel);
    const client = await getAuthedApiClientForAction("rid-2");
    expect(getAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ resources: [API_RESOURCE] }),
      API_RESOURCE,
    );
    expect(makeClient).toHaveBeenCalledWith("https://api.fountainrank.com", {
      headers: { Authorization: "Bearer tok-act", "X-Request-ID": "rid-2" },
    });
    expect(client).toBe(sentinel);
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run lib/server/api.test.ts`

- [ ] **Step 3: Implement** — add to `web/lib/server/api.ts` (merge the `getAccessToken` import into the existing `@logto/next/server-actions` import line):

```ts
import { getAccessToken, getAccessTokenRSC } from "@logto/next/server-actions";

// Server-Action variant: getAccessToken can persist a refreshed token to the writable
// action cookie store (RSC cookies are read-only). Token never leaves the server.
export async function getAuthedApiClientForAction(requestId: string): Promise<ApiClient> {
  const token = await getAccessToken(getLogtoConfig(), API_RESOURCE);
  return makeClient(resolveApiBaseUrl(), { headers: authedClientHeaders(token, requestId) });
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web exec vitest run lib/server/api.test.ts`

- [ ] **Step 5: Write failing tests for contribute actions** — `web/app/actions/contribute.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { POST, getClient, revalidatePath, log } = vi.hoisted(() => ({
  POST: vi.fn(),
  getClient: vi.fn(),
  revalidatePath: vi.fn(),
  log: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("../../lib/server/api", () => ({ getAuthedApiClientForAction: getClient }));
vi.mock("../../lib/server/log", () => ({ log }));

import { submitRating, submitCondition, submitNote } from "./contribute";

const FID = "123e4567-e89b-12d3-a456-426614174000";
beforeEach(() => getClient.mockImplementation(async () => ({ POST })));
afterEach(() => vi.clearAllMocks());

describe("submitRating", () => {
  it("validation fails BEFORE any API call for empty ratings", async () => {
    const res = await submitRating(FID, []);
    expect(res).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });
  it("rejects out-of-range stars and a bad fountain id (hostile input)", async () => {
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 9 }])).toEqual({
      ok: false,
      error: "validation",
    });
    expect(await submitRating("not-a-uuid", [{ rating_type_id: 1, stars: 3 }])).toEqual({
      ok: false,
      error: "validation",
    });
  });
  it("posts and revalidates on success", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    const res = await submitRating(FID, [{ rating_type_id: 1, stars: 4 }]);
    expect(res).toEqual({ ok: true });
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/ratings",
      expect.objectContaining({
        params: { path: { fountain_id: FID } },
        body: { ratings: [{ rating_type_id: 1, stars: 4 }] },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/fountains/${FID}`);
  });
  it("maps status codes to errors", async () => {
    POST.mockResolvedValue({ response: { status: 401 } });
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    POST.mockResolvedValue({ response: { status: 404 } });
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "not_found",
    });
    POST.mockResolvedValue({ response: { status: 503 } });
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "server",
    });
  });
  it("treats a thrown token error as unauthenticated", async () => {
    getClient.mockRejectedValueOnce(new Error("no token"));
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });
  it("maps a POST/network throw to server (NOT unauthenticated)", async () => {
    POST.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "server",
    });
  });
  it("rejects a non-positive rating_type_id (hostile input)", async () => {
    expect(await submitRating(FID, [{ rating_type_id: 0, stars: 4 }])).toEqual({
      ok: false,
      error: "validation",
    });
    expect(getClient).not.toHaveBeenCalled();
  });
});

describe("submitCondition", () => {
  it("rejects an unknown status", async () => {
    // @ts-expect-error hostile input
    expect(await submitCondition(FID, "explode")).toEqual({ ok: false, error: "validation" });
  });
  it("posts is_proximate:false", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    await submitCondition(FID, "working");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/conditions",
      expect.objectContaining({ body: { status: "working", is_proximate: false } }),
    );
  });
});

describe("submitNote", () => {
  it("rejects empty/whitespace and >1000 chars", async () => {
    expect(await submitNote(FID, "   ")).toEqual({ ok: false, error: "validation" });
    expect(await submitNote(FID, "a".repeat(1001))).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });
  it("trims and posts", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    await submitNote(FID, "  hi  ");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/notes",
      expect.objectContaining({ body: { body: "hi" } }),
    );
  });
});
```


- [ ] **Step 6: Run, verify fail.** `pnpm --filter web exec vitest run app/actions/contribute.test.ts`

- [ ] **Step 7: Implement** — `web/app/actions/contribute.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import type { components } from "@fountainrank/api-client";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];
export type ContributeError = "unauthenticated" | "validation" | "not_found" | "server";
export type ActionResult = { ok: true } | { ok: false; error: ContributeError };

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CONDITION_STATUSES: ReadonlySet<string> = new Set([
  "working", "broken", "low_pressure", "dirty", "bad_taste", "blocked",
  "seasonal_unavailable", "hours_limited",
]);

function fail(error: ContributeError): ActionResult {
  return { ok: false, error };
}
function mapStatus(status: number): ActionResult {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401) return fail("unauthenticated");
  if (status === 404) return fail("not_found");
  if (status === 422) return fail("validation");
  return fail("server");
}

async function run(
  fountainId: string,
  action: string,
  call: (client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>) => Promise<{ response?: { status: number } }>,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  // Split the two failure classes: a token/session failure (getAccessToken throws) is
  // "unauthenticated"; a POST/network failure (backend down, fetch threw) is "server".
  // Collapsing both into "unauthenticated" would tell users to sign in again when the
  // backend is merely down.
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "contribute auth error", { requestId, action, fountainId, reason: (err as Error).name });
    return fail("unauthenticated");
  }
  try {
    const { response } = await call(client);
    const status = response?.status ?? 0;
    const result = mapStatus(status);
    log(result.ok ? "info" : "warn", "contribute action", { requestId, action, fountainId, status });
    if (result.ok) revalidatePath(`/fountains/${fountainId}`);
    return result;
  } catch (err) {
    log("warn", "contribute action error", { requestId, action, fountainId, reason: (err as Error).name });
    return fail("server");
  }
}

export async function submitRating(
  fountainId: string,
  ratings: { rating_type_id: number; stars: number }[],
): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  if (
    !Array.isArray(ratings) ||
    ratings.length === 0 ||
    !ratings.every(
      (r) =>
        Number.isInteger(r?.rating_type_id) &&
        r.rating_type_id > 0 &&
        Number.isInteger(r?.stars) &&
        r.stars >= 1 &&
        r.stars <= 5,
    )
  ) {
    return fail("validation");
  }
  return run(fountainId, "rate", (client) =>
    client.POST("/api/v1/fountains/{fountain_id}/ratings", {
      params: { path: { fountain_id: fountainId } },
      body: { ratings },
    }),
  );
}

export async function submitCondition(
  fountainId: string,
  status: ConditionStatus,
): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  if (!CONDITION_STATUSES.has(status)) return fail("validation");
  return run(fountainId, "condition", (client) =>
    client.POST("/api/v1/fountains/{fountain_id}/conditions", {
      params: { path: { fountain_id: fountainId } },
      body: { status, is_proximate: false },
    }),
  );
}

export async function submitNote(fountainId: string, body: string): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  const trimmed = typeof body === "string" ? body.trim() : "";
  if (trimmed.length < 1 || trimmed.length > 1000) return fail("validation");
  return run(fountainId, "note", (client) =>
    client.POST("/api/v1/fountains/{fountain_id}/notes", {
      params: { path: { fountain_id: fountainId } },
      body: { body: trimmed },
    }),
  );
}
```

- [ ] **Step 8: Run, verify pass.** `pnpm --filter web exec vitest run app/actions/contribute.test.ts lib/server/api.test.ts`

- [ ] **Step 9: Configure CSRF origins** — `web/next.config.ts`:

```ts
const nextConfig: NextConfig = {
  transpilePackages: ["@fountainrank/api-client"],
  experimental: {
    serverActions: { allowedOrigins: ["fountainrank.com", "www.fountainrank.com"] },
  },
};
```

- [ ] **Step 10: Format + commit**

```bash
pnpm --filter web exec prettier --write web/lib/server/api.ts web/lib/server/api.test.ts web/app/actions/contribute.ts web/app/actions/contribute.test.ts web/next.config.ts
git add web/lib/server/api.ts web/lib/server/api.test.ts web/app/actions/contribute.ts web/app/actions/contribute.test.ts web/next.config.ts
git commit -m "feat(web): authed action client + contribute server actions (rate/condition/note) + CSRF origins (slice 6b-1)"
```

---

## Task 12: Web — Contribute forms + wire into FountainDetail + routes

**Files:**
- Create: `web/components/fountain/{ContributeSection,RatingForm,ConditionForm,NoteForm}.tsx` (+ `.test.tsx` each)
- Modify: `web/components/fountain/FountainDetail.tsx` (+ `.test.tsx`)
- Modify: `web/app/fountains/[id]/page.tsx` (+ `.test.tsx`), `web/app/@modal/(.)fountains/[id]/page.tsx` (+ `.test.tsx`)

**Interfaces:**
- Consumes: `submitRating`/`submitCondition`/`submitNote` (Task 11), `signInWithReturn` (Task 5), `conditionStatusLabel` (Task 10), `Viewer`/`getViewer` (Task 6), `DimensionSummary` type.
- Produces: `ContributeSection({ fountainId, dimensions, isAuthenticated }: { fountainId: string; dimensions: DimensionSummary[]; isAuthenticated: boolean })`; `FountainDetail` gains `isAuthenticated: boolean`.

Forms use `useTransition` + local state; disable while pending; render success/error via `role="status"`/`aria-live="polite"`. All client components.

- [ ] **Step 1: Write failing tests** — one per form + ContributeSection. Key assertions:
  - `RatingForm.test.tsx`: Submit disabled until ≥1 star set; on submit calls `submitRating(fountainId, [{rating_type_id, stars}])` with only set dimensions; success shows confirmation; error shows message. Mock `../../app/actions/contribute` and `next/navigation` (`useRouter` → `{ refresh: vi.fn() }`).
  - `ConditionForm.test.tsx`: "I checked — it's working" calls `submitCondition(fid, "working")`; "Report a problem" reveals the 7 labels (via `conditionStatusLabel`); selecting + submit calls with that status.
  - `NoteForm.test.tsx`: empty rejected client-side (no action call); counter updates; success shows neutral "Your note was saved."
  - `ContributeSection.test.tsx`: `isAuthenticated=false` renders the "Sign in to contribute" form (binds `signInWithReturn` to `/fountains/${id}`) and NO forms; `isAuthenticated=true` renders the three forms.

Example `RatingForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { submitRating, refresh } = vi.hoisted(() => ({ submitRating: vi.fn(), refresh: vi.fn() }));
vi.mock("../../app/actions/contribute", () => ({ submitRating }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RatingForm } from "./RatingForm";

const dims = [
  { rating_type_id: 1, name: "Clarity", average_rating: null, vote_count: 0 },
  { rating_type_id: 2, name: "Taste", average_rating: null, vote_count: 0 },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("disables submit until a star is set, then posts only set dimensions", async () => {
  submitRating.mockResolvedValue({ ok: true });
  render(<RatingForm fountainId="fid" dimensions={dims} />);
  const submit = screen.getByRole("button", { name: /submit rating/i });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /clarity: 4 stars/i }));
  expect(submit).not.toBeDisabled();
  fireEvent.click(submit);
  await waitFor(() =>
    expect(submitRating).toHaveBeenCalledWith("fid", [{ rating_type_id: 1, stars: 4 }]),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run components/fountain/RatingForm.test.tsx`

- [ ] **Step 3a: Shared error-copy module** — `web/components/fountain/contributeError.ts`:

```ts
import type { ContributeError } from "../../app/actions/contribute";

export function errorText(e: ContributeError): string {
  switch (e) {
    case "unauthenticated":
      return "Your session expired — please sign in again.";
    case "not_found":
      return "This fountain is no longer available.";
    case "validation":
      return "Please check your input and try again.";
    default:
      return "Couldn't save — please try again.";
  }
}
```

- [ ] **Step 3b: `RatingForm.tsx`** — uses **native radio inputs** (a real radio group per dimension: same `name`, so Arrow/Space keyboard nav and group semantics come for free), visually styled as stars. The input carries the accessible name (`aria-label`) and is `sr-only`; the `<label htmlFor>` is the visible clickable star.

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@fountainrank/api-client";
import { submitRating } from "../../app/actions/contribute";
import { errorText } from "./contributeError";

type Dimension = components["schemas"]["DimensionSummary"];

export function RatingForm({ fountainId, dimensions }: { fountainId: string; dimensions: Dimension[] }) {
  const router = useRouter();
  const [stars, setStars] = useState<Record<number, number>>({});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const chosen = Object.entries(stars).filter(([, s]) => s > 0);

  function submit() {
    const ratings = chosen.map(([id, s]) => ({ rating_type_id: Number(id), stars: s }));
    start(async () => {
      const res = await submitRating(fountainId, ratings);
      if (res.ok) {
        setMsg({ tone: "ok", text: "Thanks — your rating was saved." });
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">Rate it</h3>
      {dimensions.map((d) => (
        <fieldset key={d.rating_type_id} className="flex items-center justify-between py-1">
          <legend className="text-sm">{d.name}</legend>
          <span className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const inputId = `dim-${d.rating_type_id}-star-${n}`;
              return (
                <span key={n} className="inline-flex">
                  <input
                    type="radio"
                    id={inputId}
                    name={`dim-${d.rating_type_id}`}
                    value={n}
                    checked={stars[d.rating_type_id] === n}
                    aria-label={`${d.name}: ${n} star${n > 1 ? "s" : ""}`}
                    onChange={() => setStars((s) => ({ ...s, [d.rating_type_id]: n }))}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={inputId}
                    aria-hidden="true"
                    className={`cursor-pointer text-lg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#0A357E] ${
                      stars[d.rating_type_id] >= n ? "text-[#F2C200]" : "text-slate-300"
                    }`}
                  >
                    ★
                  </label>
                </span>
              );
            })}
          </span>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={pending || chosen.length === 0}
        onClick={submit}
        className="mt-2 rounded-full bg-[#0A357E] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Submit rating
      </button>
      {msg && (
        <p role="status" aria-live="polite" className={msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3c: `ConditionForm.tsx`** — primary verify button + a "Report a problem" disclosure (`aria-expanded`) with a labeled `<select>` of the seven problem statuses (default = first), then Submit.

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@fountainrank/api-client";
import { submitCondition } from "../../app/actions/contribute";
import { conditionStatusLabel } from "../../lib/map/format";
import { errorText } from "./contributeError";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];
const PROBLEMS: ConditionStatus[] = [
  "broken",
  "low_pressure",
  "dirty",
  "bad_taste",
  "blocked",
  "seasonal_unavailable",
  "hours_limited",
];

export function ConditionForm({ fountainId }: { fountainId: string }) {
  const router = useRouter();
  const [showProblems, setShowProblems] = useState(false);
  const [problem, setProblem] = useState<ConditionStatus>(PROBLEMS[0]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function report(status: ConditionStatus) {
    start(async () => {
      const res = await submitCondition(fountainId, status);
      if (res.ok) {
        setMsg({ tone: "ok", text: "Thanks — your report was saved." });
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">Is it working?</h3>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => report("working")}
          className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          I checked — it&rsquo;s working
        </button>
        <button
          type="button"
          aria-expanded={showProblems}
          onClick={() => setShowProblems((v) => !v)}
          className="text-sm text-[#0C44A0] underline"
        >
          Report a problem
        </button>
      </div>
      {showProblems && (
        <div className="mt-2 flex items-center gap-2">
          <label className="sr-only" htmlFor="problem-select">
            Problem type
          </label>
          <select
            id="problem-select"
            value={problem}
            onChange={(e) => setProblem(e.target.value as ConditionStatus)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {PROBLEMS.map((p) => (
              <option key={p} value={p}>
                {conditionStatusLabel(p)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() => report(problem)}
            className="rounded-full bg-[#0A357E] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}
      {msg && (
        <p role="status" aria-live="polite" className={msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3d: `NoteForm.tsx`** — textarea (1–1000, counter), client-guards empty/whitespace before calling the action, neutral success copy.

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitNote } from "../../app/actions/contribute";
import { errorText } from "./contributeError";

export function NoteForm({ fountainId }: { fountainId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const trimmed = body.trim();

  function submit() {
    if (trimmed.length < 1 || trimmed.length > 1000) {
      setMsg({ tone: "err", text: "Please enter 1–1000 characters." });
      return;
    }
    start(async () => {
      const res = await submitNote(fountainId, trimmed);
      if (res.ok) {
        setMsg({ tone: "ok", text: "Your note was saved." });
        setBody("");
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">Your note</h3>
      <textarea
        value={body}
        maxLength={1000}
        rows={3}
        aria-label="Your note"
        onChange={(e) => setBody(e.target.value)}
        className="mt-1 w-full break-words rounded border border-slate-300 p-2 text-sm"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{body.length}/1000</span>
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-full bg-[#0A357E] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save note
        </button>
      </div>
      <p className="text-xs text-slate-400">Submitting replaces any note you left here before.</p>
      {msg && (
        <p role="status" aria-live="polite" className={msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
```

Concrete test pointers (mirror the `RatingForm` test in Step 1; mock `../../app/actions/contribute` and `next/navigation`'s `useRouter` → `{ refresh: vi.fn() }`):
- `ConditionForm.test.tsx`: clicking "I checked — it's working" calls `submitCondition("fid", "working")`; clicking "Report a problem" sets the disclosure (`aria-expanded=true`) and renders the 7 option labels (e.g. `screen.getByRole("option", { name: /broken \/ not working/i })`); changing the select + clicking Submit calls `submitCondition("fid", "low_pressure")`; an `{ ok:false, error:"server" }` result shows "Couldn't save — please try again."
- `NoteForm.test.tsx`: typing updates the `N/1000` counter; clicking Save with only whitespace does NOT call `submitNote` and shows the 1–1000 message; a successful save calls `submitNote("fid", "hello")`, shows "Your note was saved.", clears the textarea, and calls `router.refresh()`.

- [ ] **Step 4: Implement `ContributeSection.tsx`:**

```tsx
"use client";
import type { components } from "@fountainrank/api-client";
import { signInWithReturn } from "../../app/actions/auth";
import { RatingForm } from "./RatingForm";
import { ConditionForm } from "./ConditionForm";
import { NoteForm } from "./NoteForm";

type Dimension = components["schemas"]["DimensionSummary"];

export function ContributeSection({
  fountainId,
  dimensions,
  isAuthenticated,
}: {
  fountainId: string;
  dimensions: Dimension[];
  isAuthenticated: boolean;
}) {
  return (
    <section className="border-t border-slate-100 pt-4">
      <h2 className="text-sm font-bold text-[#0A357E]">Contribute</h2>
      {!isAuthenticated ? (
        <form action={signInWithReturn.bind(null, `/fountains/${fountainId}`)} className="mt-2">
          <p className="text-sm text-slate-600">Sign in to rate this fountain, report its status, or leave a note.</p>
          <button type="submit" className="mt-2 rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]">
            Sign in to contribute
          </button>
        </form>
      ) : (
        <div className="mt-2 space-y-4">
          <RatingForm fountainId={fountainId} dimensions={dimensions} />
          <ConditionForm fountainId={fountainId} />
          <NoteForm fountainId={fountainId} />
        </div>
      )}
    </section>
  );
}
```

(`returnTo` is the static `/fountains/${fountainId}`, so no `usePathname` is needed here.)

- [ ] **Step 5: Wire into `FountainDetail.tsx`** — add `isAuthenticated: boolean` to its props and render `<ContributeSection fountainId={detail.id} dimensions={detail.dimensions} isAuthenticated={isAuthenticated} />` after `NotesList`/before or after the actions row. Update `FountainDetail.test.tsx` to pass `isAuthenticated` (add a case asserting the signed-out prompt appears when false and the rating form heading appears when true; mock the contribute actions/`next/navigation`).

- [ ] **Step 6: Thread `isAuthenticated` through the routes** — in `web/app/fountains/[id]/page.tsx` and `web/app/@modal/(.)fountains/[id]/page.tsx`: add `getViewer` to the existing `Promise.all`, compute `const isAuthenticated = viewer.state === "authed";` and pass to `<FountainDetail … isAuthenticated={isAuthenticated} />`. Extend both route tests to mock `getViewer` and assert `isAuthenticated` is passed (both branches).

```ts
// in each route, alongside getFountainDetailServer/getFountainNotesServer:
const [{ data, status }, notesRes, viewer] = await Promise.all([
  getFountainDetailServer(id, requestId),
  getFountainNotesServer(id, requestId),
  getViewer(requestId),
]);
const isAuthenticated = viewer.state === "authed";
// ... pass isAuthenticated to <FountainDetail .../>
```

- [ ] **Step 7: Run all affected tests, verify pass.**

Run: `pnpm --filter web exec vitest run components/fountain app/fountains app/@modal`
Expected: PASS.

- [ ] **Step 8: Format + commit**

```bash
pnpm --filter web exec prettier --write web/components/fountain web/app/fountains/[id]/page.tsx web/app/@modal/(.)fountains/[id]/page.tsx
git add web/components/fountain web/app/fountains web/app/@modal
git commit -m "feat(web): Contribute section (rate/verify-report/note) wired into fountain detail + routes (slice 6b-1)"
```

---

## Task 13: Deploy wiring + smoke runbook

**Files:**
- Modify: `infra/k8s/backend.yaml`, `.github/workflows/deploy.yml`
- Modify: `docs/setup/README.md` (or add a short runbook note) for the post-deploy authenticated-write smoke + the `ADMIN_SUBJECTS` GitHub Actions variable.

**Interfaces:** `ADMIN_SUBJECTS` flows GitHub Actions `vars.ADMIN_SUBJECTS` → `deploy.yml` env + export list → `envsubst` → `backend.yaml` container env. (Subjects are opaque ids, not secrets → a `vars.` variable like `GOOGLE_DELEGATED_USER`.)

- [ ] **Step 1:** In `.github/workflows/deploy.yml`, in the env block that defines `GOOGLE_DELEGATED_USER`/`FROM_EMAIL`/`LOGTO_APP_ID` (around the render step), add:

```yaml
          ADMIN_SUBJECTS: ${{ vars.ADMIN_SUBJECTS }}
```

and add `ADMIN_SUBJECTS` to that step's `export NAMESPACE ENVIRONMENT IMAGE_TAG REGISTRY DOMAIN GOOGLE_DELEGATED_USER FROM_EMAIL LOGTO_APP_ID` line.

- [ ] **Step 2:** In `infra/k8s/backend.yaml`, add to the backend container `env:` (after `FROM_EMAIL`):

```yaml
            # Logto subjects granted admin (request-time reconciliation, slice 6b-1).
            # Opaque ids, not secrets — from the ADMIN_SUBJECTS GitHub Actions variable.
            - name: ADMIN_SUBJECTS
              value: "${ADMIN_SUBJECTS}"
```

- [ ] **Step 3:** Document in `docs/setup/README.md`: create the GitHub Actions **variable** `ADMIN_SUBJECTS` (owner's Logto subject id(s), comma-separated; obtain from the Logto admin console) in the deploy environment; and a reproducible **post-deploy authenticated-write smoke** procedure (sign in on the deployed site, submit a rating/note on a fountain, confirm success) that must not log tokens or note bodies. (No secret values committed.)

- [ ] **Step 4: Commit**

```bash
git add infra/k8s/backend.yaml .github/workflows/deploy.yml docs/setup/README.md
git commit -m "ci(backend): deliver ADMIN_SUBJECTS to backend deployment + post-deploy write smoke runbook (slice 6b-1)"
```

---

## Final: full local mirror + PR

- [ ] **Step 1: Run the full mirror.**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check`
Expected: backend + workspace-js + web build + mobile all green. (If the pnpm store goes dirty after any WSL/Codex run: `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`.)

- [ ] **Step 2: Open the PR** off a `feat/web-auth-ui-and-write-actions` branch; get CI green; run **Codex Loop B** (PR review) until `VERDICT: APPROVED`; address every PR comment; squash-merge. **Implementation is complete at merge.**
- [ ] **Step 3 (separate, intentional release — not an automatic post-merge step):** when deliberately releasing, trigger the existing CI deploy workflow `gh workflow run deploy.yml --ref main` (deployment runs **in CI**, never from a local machine / `kubectl`), watch it, then run the post-deploy authenticated-write smoke (Task 13). The `ADMIN_SUBJECTS` GitHub Actions variable must exist before this deploy for the admin menu to appear.

---

## Self-Review

**Spec coverage:** §1 scope → Tasks 1–13. §4 admin authority → Tasks 2–3. §5 header/auth/getViewer → Tasks 6–8. §6 /admin → Task 9. §7 contribute forms → Tasks 10–12. §8 return path → Tasks 4–5. §9 server actions/CSRF/refresh → Tasks 11–12. §12 style guide → Task 1. §13 tests → folded into each task. §14 deploy/next.config → Tasks 11 (origins) + 13 (env). §15 sequencing → task order matches.

**Placeholder scan:** all steps carry real, runnable code — Task 12 includes full `RatingForm`, `ConditionForm`, `NoteForm`, and the shared `contributeError` module; Task 11's test uses a real `beforeEach`. No shims or "analogous" prose remain.

**Type consistency:** `Viewer` (Task 6) is consumed unchanged in Tasks 7/9/12; `ActionResult`/`ContributeError` (Task 11) consumed in Task 12; `submitRating/Condition/Note` signatures match between Task 11 (produces) and Task 12 (consumes); `safeReturnPath` (Task 4) consumed in Tasks 5/(callback); `getAuthedApiClientForAction` (Task 11) consumed by the actions; `conditionStatusLabel` (Task 10) consumed by `ConditionForm`.
