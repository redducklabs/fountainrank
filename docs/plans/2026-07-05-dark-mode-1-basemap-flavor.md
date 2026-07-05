# Dark Mode — Plan 1: Dark Basemap Flavor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a `style.dark.json` Protomaps basemap flavor (with its already-uploaded dark sprite) to the DO Spaces/CDN so the web and mobile clients can switch to a dark basemap at runtime in later PRs.

**Architecture:** Purely additive change to the existing `.github/workflows/basemap-upload.yml`. The vector tiles (`planet.pmtiles`) and glyphs are flavor-agnostic and untouched; only a second **style JSON** is generated (`namedFlavor("dark")`) and uploaded next to the existing `style.light.json`. The dark **sprite** (`sprites/v4/dark.{json,png}`) is already synced to the CDN by the workflow's existing recursive sprite upload, so no sprite generation is needed. The change is verified by dispatching the workflow (which skips the ~127 GB planet transfer when the source is unchanged) and asserting the dark style + sprite are live and well-formed.

**Tech Stack:** GitHub Actions (`workflow_dispatch`), `@protomaps/basemaps@5.7.2` (Node style generator, already pinned), AWS CLI → DigitalOcean Spaces, `doctl` CDN flush, `python3` for JSON assertions.

**Reference spec:** `docs/specs/2026-07-05-dark-mode-design.md` §7 (Codex-APPROVED).

## Global Constraints

- Public open-source repo — **never commit secrets or `.env`**; the workflow reads `SPACES_*` / `DIGITALOCEAN_ACCESS_TOKEN` from the `production` GitHub environment only.
- **IaC / infra is CI-only** — this workflow is the sanctioned path; never run `aws s3 cp`/`doctl` against production by hand. Dispatch via `gh workflow run`.
- **Conventional Commits**; **no AI attribution** in commits/PRs; **no time estimates** anywhere.
- Keep the change **additive** — do not alter the light style, the planet stream/skip logic, the sprite upload, or `basemap-janitor.yml` (it reaps droplets/SSH keys only, not Spaces objects).
- Pinned generator version stays `@protomaps/basemaps@5.7.2` and `ASSETS_REF=028c18f713baecad011301ff7a69acc39bcc2ae7` (both flavors must match the pinned assets).
- Branch → PR → CI green + Codex `VERDICT: APPROVED` + all PR comments addressed → **squash-merge**.

---

### Task 1: Add the dark style flavor to `basemap-upload.yml`

Generate + upload `style.dark.json` in the same step that already generates the light style (one `npm install`), extend the CDN purge to the dark objects, and add a validation step that fetches the dark style + sprite from the CDN and asserts their invariants.

**Files:**
- Modify: `.github/workflows/basemap-upload.yml` (style-generation step ~189-228; CDN purge ~354-367; append a validation step after the smoke ~411)

**Interfaces:**
- Consumes: existing job env `CDN_HOST`, `SITE_HOST`, `BUCKET`, `ENDPOINT`, `UPLOAD_ASSETS`; the already-uploaded `sprites/v4/dark.{json,png}` (from the recursive sprite sync at lines 180-185).
- Produces: `https://${CDN_HOST}/style.dark.json` on the CDN — the object later PRs' `styleUrlFor("dark")` derives and requests. Its `sprite` is `https://${CDN_HOST}/sprites/v4/dark`; `glyphs` and `sources.protomaps.url` are byte-identical to `style.light.json`.

- [ ] **Step 1: Extend the style step to also generate + upload `style.dark.json`**

Rename the step `Generate and upload Light style JSON` → `Generate and upload Light + Dark style JSON` and, after the existing `aws s3 cp style.light.json …` upload, add a dark generation + upload block that reuses the same `npm install`. The dark block is identical to the light block except `sprite` ends in `/sprites/v4/dark` and the flavor is `namedFlavor("dark")`.

Replace the tail of the existing step (from the `aws s3 cp style.light.json …` upload through `echo "style.light.json uploaded."`) with:

```yaml
          aws s3 cp style.light.json \
            "${BUCKET}/style.light.json" \
            --acl public-read \
            --content-type "application/json" \
            --endpoint-url "$ENDPOINT"

          echo "style.light.json uploaded."

          # Dark flavor — same generator + pinned deps; only the flavor + sprite path differ.
          # The dark sprite (sprites/v4/dark.{json,png}) is already synced by the recursive
          # sprite upload above, so only the style JSON is produced here.
          node - > style.dark.json <<'EOF'
          const { layers, namedFlavor } = require("@protomaps/basemaps");

          const CDN_HOST = process.env.CDN_HOST;
          const SITE_HOST = process.env.SITE_HOST;

          const style = {
            version: 8,
            glyphs: `https://${CDN_HOST}/fonts/{fontstack}/{range}.pbf`,
            sprite: `https://${CDN_HOST}/sprites/v4/dark`,
            sources: {
              protomaps: {
                type: "vector",
                url: `https://${SITE_HOST}/tiles/planet.json`,
                attribution:
                  '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
              },
            },
            layers: layers("protomaps", namedFlavor("dark"), { lang: "en" }),
          };

          process.stdout.write(JSON.stringify(style, null, 2));
          EOF

          aws s3 cp style.dark.json \
            "${BUCKET}/style.dark.json" \
            --acl public-read \
            --content-type "application/json" \
            --endpoint-url "$ENDPOINT"

          echo "style.dark.json uploaded."
```

- [ ] **Step 2: Extend the CDN purge to the dark objects**

In the `Purge CDN for refreshed assets` step, replace the `doctl compute cdn flush` file list so it also flushes the dark style + dark sprite:

```yaml
            doctl compute cdn flush "$CDN_ID" --files /style.light.json,/style.dark.json,/sprites/v4/light.json,/sprites/v4/light.png,/sprites/v4/dark.json,/sprites/v4/dark.png && break
```

- [ ] **Step 3: Append a dark-flavor validation step after the smoke test**

Add a new step immediately after `Smoke test — origin size + CDN range` (no `if:` guard — the dark style persists on the CDN, so validate it on every run). It fetches the dark style + sprite from the CDN and asserts the invariants:

```yaml
      - name: Validate dark basemap flavor
        run: |
          set -o pipefail
          echo "Fetching light + dark styles; asserting parity + dark sprite…"
          curl -sf -m 30 "https://${CDN_HOST}/style.light.json" -o style.light.check.json \
            || { echo "::error::style.light.json not reachable on CDN"; exit 1; }
          curl -sf -m 30 "https://${CDN_HOST}/style.dark.json" -o style.dark.check.json \
            || { echo "::error::style.dark.json not reachable on CDN"; exit 1; }
          python3 - <<'PY'
          import json
          light = json.load(open("style.light.check.json"))
          dark = json.load(open("style.dark.check.json"))
          assert dark.get("sprite", "").endswith("/sprites/v4/dark"), f"dark sprite ref: {dark.get('sprite')!r}"
          assert light.get("sprite", "").endswith("/sprites/v4/light"), f"light sprite ref: {light.get('sprite')!r}"
          # spec §7: glyphs + source must be byte-identical between flavors — compare exactly, not by suffix.
          assert dark["glyphs"] == light["glyphs"], f"glyphs differ: {dark['glyphs']!r} vs {light['glyphs']!r}"
          assert dark["sources"]["protomaps"]["url"] == light["sources"]["protomaps"]["url"], \
              "protomaps source url differs between flavors"
          assert isinstance(dark.get("layers"), list) and dark["layers"], "no dark layers"
          print(f"dark style OK ({len(dark['layers'])} layers); glyphs + source match light")
          PY
          for f in dark.json dark.png; do
            st=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "https://${CDN_HOST}/sprites/v4/${f}")
            [ "$st" = "200" ] || { echo "::error::sprites/v4/${f} -> ${st} (expected 200)"; exit 1; }
          done
          echo "Dark flavor validation PASSED."
```

- [ ] **Step 4: Lint the workflow**

Run: `actionlint .github/workflows/basemap-upload.yml`
Expected: no errors. (If `actionlint` is not installed, use the repo's pinned version — the binary under `temp/actionlint`, or `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12` — not `@latest`, to keep lint reproducible.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/basemap-upload.yml
git commit -m "ci(basemap): generate + publish dark style flavor (#18)"
```

---

### Task 2: Publish the dark style + verify it is live

Dispatch the workflow so the new step generates and uploads `style.dark.json`. With no `pmtiles_url` and the source unchanged, the ~127 GB planet transfer is **skipped** (`SKIP_STREAM=true`), but the asset/style steps still run because they are gated on `UPLOAD_ASSETS`, not on the stream. This is a production asset change — run it with the owner's awareness.

**Files:** none (execution + verification only).

**Interfaces:**
- Consumes: Task 1's workflow change on this branch.
- Produces: a live `https://fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com/style.dark.json` — the precondition later PRs (web/mobile dark basemap) depend on.

- [ ] **Step 1: Dispatch the workflow on this branch**

Run (assets on, planet transfer auto-skipped when unchanged):

```bash
gh workflow run basemap-upload.yml --ref feat/18-dark-mode -f upload_assets=true
```

- [ ] **Step 2: Watch the run to completion**

Run (filter to the just-dispatched run on this branch — not merely the newest run globally, which could be a schedule or another owner's dispatch):

```bash
sleep 8  # let the dispatched run register
RID=$(gh run list --workflow=basemap-upload.yml --branch feat/18-dark-mode --event workflow_dispatch \
       --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --exit-status --interval 30
```

Expected: the run succeeds, including the new `Validate dark basemap flavor` step ("Dark flavor validation PASSED."). If it dispatched the planet stream unexpectedly, that is fine (it still uploads assets) but confirm the source was genuinely current.

- [ ] **Step 3: Independently verify the dark style + sprite are served**

Run (fail-fast — every fetch must succeed or the check exits non-zero):

```bash
set -e
CDN=fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com
curl -fsS -m 30 "https://$CDN/style.dark.json" -o /tmp/style.dark.json
python -c "import json;d=json.load(open('/tmp/style.dark.json'));assert d['sprite'].endswith('/sprites/v4/dark'),d['sprite'];print('sprite=',d['sprite'],'layers=',len(d['layers']))"
curl -fsS -o /dev/null -m 30 "https://$CDN/sprites/v4/dark.json"
curl -fsS -o /dev/null -m 30 "https://$CDN/sprites/v4/dark.png"
echo "dark style + sprite verified (all 200)"
```

Expected: the `python` line prints `sprite= https://…/sprites/v4/dark` and a non-zero layer count, and the script ends with `dark style + sprite verified (all 200)` (any 404/500 makes `curl -fsS` fail and `set -e` aborts).

- [ ] **Step 4: Open the PR**

The workflow-file change is the whole PR. Open it, get CI green, run the Codex PR-review loop to `VERDICT: APPROVED`, address any comments, then squash-merge.

```bash
gh pr create --fill --base main --head feat/18-dark-mode
```

---

## Self-Review

**Spec coverage (§7):** ✅ generate + upload `style.dark.json` with `namedFlavor("dark")` + `sprite: /sprites/v4/dark` (Task 1 Step 1); ✅ dark sprite already on CDN via recursive sync (no generation) — asserted, not regenerated (Task 1 Step 3, Task 2 Step 3); ✅ CDN purge extended to dark objects (Task 1 Step 2); ✅ smoke/validation extended to fetch the dark style + assert `sprite`/`glyphs`/source + fetch dark sprite json/png 200 (Task 1 Step 3); ✅ `BASEMAP_STYLE_VER` cache-bust unaffected (clients still request `style.<flavor>.json?v=N`); ✅ janitor explicitly untouched.

**Deferred by design (not in this plan):** the runtime **deploy-time availability probe** (spec §7 rollout gate) moves to **Plan 2 (web)** — that is the PR that makes the dark basemap actually *requestable*, so gating the web deploy on `style.dark.json` availability belongs with it and avoids a chicken-and-egg where a merged probe fails before this workflow has run. Dark **pin assets** also move to their consuming client PRs (web = Plan 2, mobile = Plan 3), where they are visually tuned against the real dark map (see the note in the handoff below).

**Placeholder scan:** none — all YAML and commands are concrete.

**Type/name consistency:** object keys/paths (`style.dark.json`, `sprites/v4/dark.{json,png}`, `/sprites/v4/dark`) are used identically in the generator, purge, validation, and verification steps.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-07-05-dark-mode-1-basemap-flavor.md`. This plan must pass a Codex review loop (`VERDICT: APPROVED`) before implementation, per `claude_help/codex-review-process.md`.
