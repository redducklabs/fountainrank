# Handoff — photos-Spaces trap fixed + SEO #53 shipped (2026-07-20)

Both jobs from `handoffs/2026-07-20-photos-gate-fix-and-seo-53-handoff.md` are **done, merged, and
(for the web change) live in prod**. `main` is at `782e44f` (this handoff is uncommitted — bundle it
into the next session's first PR, the established pattern). Nothing is blocking.

## What shipped this session

### Job 1 — photos-Spaces destroy trap (#262, merged + APPLIED)
- **Verified the trap was ACTIVE** (not latent): a full `terraform plan` on `main` showed
  `digitalocean_spaces_bucket.photos[0]` **`will be destroyed`** (`Plan: 0 add, 2 change, 1 destroy`).
  The bucket **was in state** and the current apply Spaces key **can read it** (refresh succeeded) —
  so the fix was the `moved`-block path (no import, no new key).
- **Fix (#262):** removed the `count` gate; adopted `.photos[0] → .photos` via a `moved` block; added
  `lifecycle { prevent_destroy = true }`; retired `var.manage_photos_spaces` + its `terraform.yml`
  input/`TF_VAR`; simplified `project_resources`; **pinned DOKS to the live `1.34.8-do.2`** (removed
  the "latest patch" version data source that had drifted to `do.3`).
- **Applied via CI 2026-07-20:** the `moved` migration ran clean (`0 destroyed`), and a fresh full
  plan now reports **"No changes."** → a full `terraform apply` is once again a **safe no-op**; the
  "scoped `-target` only" guardrail is no longer needed. Codex `VERDICT: APPROVED` (no findings).

### Job 2 — SEO #53 (#263, merged + DEPLOYED + verified live)
- **`ItemList` JSON-LD** (`web/lib/seo/jsonld.ts` `itemListStructuredData`) emitted alongside the
  breadcrumb on place pages: city/region pages list their fountains (`/fountains/{id}`), country pages
  list child regions/cities. Summary-page format (URL-only — fountains have no public name). Gated on
  `indexable` on **all three** templates (the country breadcrumb was un-gated before; #263 fixed that).
- **Sibling internal links** (`web/components/place/RelatedPlaces.tsx`): a `<nav>` below the fountain
  list — nested city → other cities in region; two-level city → other cities in country; region →
  other regions in country. Top `RELATED_PLACES_CAP` (12), current excluded, not gated on indexability.
- Full local CI mirror green (tsc/eslint/prettier/vitest/`next build`); CI green; Codex `APPROVED`
  (round 2, after addressing 2 `[MINOR]`). **Deployed via `deploy.yml` 2026-07-20** (owner-approved);
  **verified live**: `/drinking-fountains/us` emits `ItemList`+`BreadcrumbList`; `/…/us/california`
  emits `ItemList` + an "Other regions in US" nav.
- `docs/style-guide.md` documents both new elements.

### Housekeeping (in #262)
- Committed the two prior handoffs + the 5 Play-Store screenshot JPEGs.

## Remaining / carried-forward (all LOWER urgency — none blocking)
- **#61 (task, pending) — mobile version-scheme fragility.** You MUST bump `mobile/app.config.ts`
  `defaultAppVersion` for every store release (a plain dispatch resolves to the config value).
  Consider reconciling to one scheme (tag-only or auto-bump). Docs: `mobile/README.md`,
  `docs/setup/07-mobile-store-readiness.md`.
- **iOS `1.0.1` is LIVE on the App Store** (owner released it 2026-07-20). Both stores are now
  published at `1.0.1` (Android auto-published to Play prod; iOS TestFlight → App Store, owner-released).
  The next iOS/Android store release MUST bump `mobile/app.config.ts` `defaultAppVersion` past `1.0.1`.
- **Optional SEO levers (not started):** ISR/careful caching for the `force-dynamic` place pages (the
  homepage `unstable_cache` 1h is the model) + sitemap at crawl scale; OpenGraph images; hreflang; a
  NEW backend "nearby by distance" endpoint for **geo** siblings (the #263 siblings are
  same-region/country only, using existing endpoints). Track place-page cohort impressions→clicks via
  the `seo` skill (GSC `fountainrank`, GA4 property `543842314`) — read `claude_help/seo.md` first.
- **Suggested infra follow-up:** `digitalocean_spaces_bucket.basemap` (the ~127 GB planet) is
  unconditional but has **no** `prevent_destroy` — add the same guard photos now has (defensive).

## State snapshot
- `main` @ `782e44f`. Prod **deployed** with #261 (thumbnail fix) + #263 (SEO). #262 is infra-only,
  already applied. No backend code changed since the 2026-07-19 deploy.
- Terraform state is clean: photos migrated to `.photos` (unindexed) + `prevent_destroy`; DOKS pinned.
- No load running; 79/80 countries loaded (fo/gg/im/je/nc/xk are the trivial exceptions).

## Process (unchanged)
- Branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** → **squash-merge**.
  Codex via MCP in bypass mode (`sandbox: danger-full-access`, `approval-policy: never`), cwd
  `/mnt/d/repos/fountainrank`; read `claude_help/codex-review-process.md`.
- **IaC applies CI-only, plan-first, read the WHOLE blast radius.** Deploy is a manual `deploy.yml`
  dispatch (merge to main does NOT deploy). No AI attribution, no time estimates.

## Reference index
- Prior pick-up doc: `handoffs/2026-07-20-photos-gate-fix-and-seo-53-handoff.md` (this supersedes it).
- Codex reviews (gitignored): `temp/codex-reviews/pr-262-review-1.md`, `pr-263-review-{1,2}.md`.
