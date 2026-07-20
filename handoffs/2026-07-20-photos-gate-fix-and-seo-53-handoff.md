# Handoff — fix the photos-Spaces destroy trap (§2c) + ship SEO #53 (2026-07-20)

Pick-up doc for a fresh session. Two independent jobs remain from the 2026-07-19 handoff:

1. **[PRIORITY] Fix the photos-Spaces count-gate silent-destroy trap** (`§2c` of the prior handoff).
   The owner's directive: **"we can't delete photos, at the very least."** Photo upload is **LIVE in
   production** — this is real user data at risk.
2. **SEO #53** — `ItemList` structured data + sideways internal links on place pages (web-only).

`main` is at `90bd19e`. Supersedes `handoffs/2026-07-19-releases-and-fixes-shipped-handoff.md` for
"what's next" (that doc keeps the "what shipped" record). **RE-VERIFY prod state, don't trust this doc.**

Both jobs are separate PRs through the full gate (CI green + Codex `VERDICT: APPROVED` + every PR comment
addressed → squash-merge). They're in different areas (infra vs web) and don't depend on each other.

---

## Job 1 — [PRIORITY] Photos-Spaces destroy trap (§2c)

### Why this matters (verified this session, not assumed)
- **Photo upload is LIVE in prod.** The `production` GitHub environment has all five `SPACES_*` secrets
  set (`SPACES_BUCKET` since 2026-07-05; also `SPACES_ENDPOINT/REGION/ACCESS_KEY/SECRET_KEY`). The
  backend gates the whole photo feature on `Settings.photos_enabled()` (`backend/app/config.py:281`),
  which is true when those are set. The feature is fully built: upload/presign/moderation/owner+admin
  hard-delete/thumbnails (`backend/app/routers/photos.py`, `admin.py`). **So real user photos almost
  certainly exist in the live `fountainrank-photos` bucket.**
- **The Terraform config is a latent destroy trap.** `digitalocean_spaces_bucket.photos`
  (`infra/terraform/main.tf:360`) is **count-gated**: `count = var.manage_photos_spaces ? 1 : 0`, and
  `var.manage_photos_spaces` defaults **false** (`main.tf:123`). This is the **exact footgun the basemap
  bucket already fell into once** (a routine default-false apply planned to DESTROY the live basemap;
  fixed 2026-07-04 by removing the gate + `moved` blocks — see `main.tf:288-309`).

### ⚠️ MUST VERIFY FIRST — a contradiction to resolve before touching anything
The prior handoff §2c claimed "a full `terraform apply` plans `photos[0]` **to DESTROY**." That is only
possible **if the bucket is in Terraform state**. But the `manage_photos_spaces` var comment
(`main.tf:124-129`) says the TF apply key "is TF-state-scoped and **403s on bucket create**" — i.e. the
live bucket was almost certainly created **outside Terraform and is NOT in state** (count=0 → TF tracks
nothing). If it's not in state, a full apply is a **no-op** for photos today (nothing to destroy) — the
prior handoff's literal claim would be imprecise, and the danger is **latent** (materializes the moment
someone brings the bucket under the count-gate), not active.

**These two readings imply different fixes. Do NOT guess — verify (all read-only):**
1. **Is the bucket in TF state?** Run the Terraform workflow in **plan** mode scoped to photos, or read
   `terraform state list`. A full `terraform plan` that shows `photos[0]` to destroy ⇒ in state; a plan
   that shows nothing for photos ⇒ not in state. (Local Terraform is read-only per project rules; state
   list needs the remote backend + creds, so do this via CI — `gh workflow run terraform.yml -f
   action=plan -f target=digitalocean_spaces_bucket.photos`, then read the plan in the run log.)
2. **Does the live bucket exist and hold objects?** Confirm `fountainrank-photos` exists in DO Spaces
   and is non-empty (DO console, or an S3-API `ListObjects` with the Spaces key). Confirms the data at
   risk is real. **Do this `ListObjects`/`HeadBucket` with the CURRENT apply Spaces key** — a success
   also proves that key can read the bucket (the capability the import needs), settling the `main.tf`
   "403s on create" question in one shot.

### The fix (mirror the basemap reconciliation), branched on step-1 finding
End state either way: **`digitalocean_spaces_bucket.photos` becomes UNCONDITIONAL (count gate removed),
under management, with `lifecycle { prevent_destroy = true }`, and a full `terraform apply` is a clean
no-op** for it. Retire the `manage_photos_spaces` variable and its `terraform.yml` input/`TF_VAR` wiring
(`.github/workflows/terraform.yml:15-19, 64`) once unconditional.

- **If the bucket is NOT in state (expected):** adopt the live bucket into an unconditional resource via
  a Terraform **`import {}` block** (Terraform 1.15.6 in CI supports it — runs during `apply`, fits the
  CI-only apply rule; no local state ops). Then `prevent_destroy = true`. **Key situation (owner input
  2026-07-20): the current apply Spaces key SHOULD already have the permissions needed to read/adopt the
  bucket — no new key procurement is expected, so this is NOT a blocker.** ⚠️ But the in-repo var comment
  (`main.tf:126-127`) still says that key "403s on bucket create," which contradicts that. Reconcile
  during planning: an adopting **import** only needs bucket **read (HeadBucket)**, not create, so a
  read-capable-but-not-create-capable key is enough here — **confirm the current key can actually read
  the bucket** (a plan/import dry-run in CI) before relying on it, and if it genuinely can't, only then
  wire a suitably-scoped key. Do not block the work on procuring a new key up front.
- **If the bucket IS in state:** remove the count gate and add a `moved` block
  `digitalocean_spaces_bucket.photos[0] → digitalocean_spaces_bucket.photos` (verbatim basemap pattern,
  `main.tf:298-309`) + `prevent_destroy = true`. No import, no new key.

### Companion fix — bundle into the same infra PR (also a full-apply footgun)
- **DOKS version auto-drift** (§2c bullet 2): `kubernetes_version_prefix = "1.34."` (`main.tf:141`)
  auto-selects the latest patch, so a full apply plans a node roll (`1.34.8-do.2 → do.3`). Pin the exact
  version so a full apply is clean. This shares the goal "make a full `terraform apply` a safe no-op,"
  so it belongs with the photos fix.

### Guardrails for this job (do not skip)
- **IaC applies are CI-only, plan-first, read the WHOLE blast radius.** Local Terraform is read-only
  (`init/validate/fmt/plan`); NEVER run `apply/import/state/destroy` locally.
- **Until the fix lands, only ever dispatch SCOPED `-target` applies** (`terraform.yml` has the `-target`
  input, added in #259) — a full apply is the dangerous path. There is **no auto-apply** (merging to
  `main` does not deploy/apply), so the bucket is not in imminent danger from a routine event; the risk
  is a human dispatching a full apply. Keep that guardrail loud until unconditional + `prevent_destroy`
  makes it moot.
- `prevent_destroy = true` is the belt-and-suspenders: even a mistaken future plan-to-destroy becomes a
  loud apply-time **error**, not a silent data loss.

### Files (Job 1)
`infra/terraform/main.tf` (photos resource `:360`, `manage_photos_spaces` var `:122`, DOKS version
prefix `:141`, basemap `moved`-block precedent `:298`), `.github/workflows/terraform.yml` (dispatch
inputs `:8-24`, photos `TF_VAR` `:64`, `-target` handling `:77-92`), `infra/terraform/README.md`.

---

## Job 2 — SEO #53: ItemList schema + sideways internal links (web-only)

The last owner-approved SEO recommendation (prior handoff §2a; task #53 still pending). Fully unblocked.
Two parts:

### Part 1 — `ItemList` structured data (net-new)
The place templates currently emit **only `BreadcrumbList`** (confirmed: `page.tsx` in
`drinking-fountains/`, `[country]/`, `[country]/[place]/`, `[country]/[place]/[city]/`, and
`fountains/[id]/` all call `jsonLdScript({... "@type": "BreadcrumbList" ...})`). Add an `ItemList`
alongside, gated on `indexable` exactly like the breadcrumb:
- **City / region pages** (they list fountains): `ItemList` of the listed fountains, each `ListItem` →
  `/fountains/{id}` (consider `Place` per item). Data is already fetched (`FountainList`).
- **Country page** (lists child cities/regions, not fountains): `ItemList` of the child places.
- Emit via `web/lib/seo/jsonld.ts` `jsonLdScript` (`:1`), gated on `indexable`.
  - **Nuance found this session:** `[country]/[place]/page.tsx:163-164` already gates its ENTIRE
    structured-JSON block on `fountains.indexable` (`const structuredJson = fountains.indexable ?
    jsonLdScript(breadcrumb(...)) : …`). Follow that same gate for the new `ItemList` (don't emit schema
    on below-thin-content-gate pages).

### Part 2 — sibling / nearby internal links (pages link only UP + DOWN today)
- **City page → "Other cities in {region}"** via `getRegionCitiesServer` (`web/lib/places.ts:113`),
  exclude the current city.
- **Region page → "Other regions in {country}"** via `getCountryRegionsServer`
  (`web/lib/places.ts:97`).
- **Geo "nearby by distance" needs a NEW backend endpoint** (none exists) — treat as **optional/later**.
  The same-region/country siblings above use existing endpoints and are the main win.

### Notes / guardrails (Job 2)
- **Web-only** (unless the optional geo-nearby is pursued). Full CI + Codex gate.
- Adds fetches to place pages — the 4 GB DB has headroom now (resized #256). Place pages are
  `force-dynamic` (no caching yet — see §2d optional lever below); the homepage stats model caching with
  `unstable_cache` 1h if crawl-scale load becomes a concern.
- **New UI note:** the sibling-links block is a new UI element — check/update `docs/style-guide.md` per
  the project rule before/while adding it.
- Any new/changed JSON-LD shape should get a page-test assertion (render/component tests like
  `fountains/[id]/page.test.tsx` already assert `@type`); those render suites are **CI-only** truth
  (`workspace-js`) though several ran locally this session.

### Files (Job 2)
`web/app/drinking-fountains/[country]/page.tsx`, `.../[country]/[place]/page.tsx`,
`.../[country]/[place]/[city]/page.tsx`; `web/lib/seo/jsonld.ts`; `web/lib/places.ts`
(`getRegionCitiesServer`, `getCountryRegionsServer`, path helpers); the matching `*.test.tsx`;
`docs/style-guide.md`.

---

## Suggested sequencing
- **Job 1 verification first** — it's all read-only and resolves the data-loss risk picture (and tells
  you which fix path / whether a new Spaces key is needed). Do this before anything else.
- **Job 2 is fully unblocked** — can run in parallel with Job 1. (Owner confirmed the current Spaces key
  should already have the permissions the import needs, so Job 1 has no expected key-procurement
  dependency — just confirm the key reads the bucket during planning.)
- Land each as its own PR (infra vs web; separate Codex reviews). Job 1's permanent fix (import +
  unconditional + `prevent_destroy`, retire the gate, pin DOKS version) merges once the key question is
  resolved.

## Lower-urgency / carried-forward (don't lose these)
- **§2c bullet 3 — mobile version-scheme fragility** (unrelated to infra; separate item): you MUST bump
  `mobile/app.config.ts` `defaultAppVersion` for every store release (a plain dispatch resolves to the
  config value). Consider reconciling to a single scheme (tag-only, or auto-bump). Documented in
  `mobile/README.md` + `docs/setup/07-mobile-store-readiness.md`.
- **§2b — owner manual action:** once iOS `1.0.1` finishes processing in TestFlight, the owner promotes
  it TestFlight → App Store review (CI can't do this).
- **§2d optional SEO levers:** ISR/careful caching for `force-dynamic` place pages + sitemap at crawl
  scale (homepage `unstable_cache` 1h is the model); OpenGraph images; hreflang. Track place-page cohort
  impressions→clicks via the `seo` skill (GSC site `fountainrank`, GA4 property `543842314`) — read
  `claude_help/seo.md` first.

## Process / guardrails (unchanged)
- All work: branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** →
  **squash-merge**. Codex via the MCP server in bypass mode (`sandbox: danger-full-access`,
  `approval-policy: never`), cwd `/mnt/d/repos/fountainrank`; read `claude_help/codex-review-process.md`.
- Backend verifies locally via isolated `UV_PROJECT_ENVIRONMENT` + `./run.ps1 check -Backend`; web
  `tsc`/ESLint/Prettier/`next build` + pure-logic vitest locally; component-render + full JS suites and
  mobile `expo-doctor`/React-Compiler lint are **CI-only**.
- **No AI attribution** in commits/PRs; **no time estimates**. **IaC applies CI-only, plan-first, read
  the WHOLE blast radius.** DB inspection is read-only.
- **Commit BOTH uncommitted handoffs** (`2026-07-19-…` and this one) with the first PR of the next
  session (established uncommitted-handoff pattern). Also **keep** the 5 untracked Play-Store screenshot
  JPEGs under `mobile/assets/store/screenshots/play-store/` (owner confirmed 2026-07-20) — commit them
  too.

## Open tasks (TaskCreate IDs)
- **#53 (pending)** — SEO ItemList + sideways internal links (Job 2).
- **NEW (file these):** photos-Spaces gate reconcile + DOKS version pin (Job 1); mobile version-scheme
  reconcile (lower urgency).
- Everything else from the 2026-07-19 handoff (#49–#58) is done.

## Reference index
- Prior handoff (what shipped this cycle): `handoffs/2026-07-19-releases-and-fixes-shipped-handoff.md`.
- Infra: `claude_help/kubernetes-infra.md`, `infra/terraform/README.md`.
- SEO ops: `claude_help/seo.md`; product SEO playbook `docs/runbooks/seo.md`.
- Codex reviews (gitignored): `temp/codex-reviews/`.
