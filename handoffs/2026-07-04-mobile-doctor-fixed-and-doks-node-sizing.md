# mobile-doctor FIXED (#163 merged) + DOKS disk alert → node right-sizing recommendation (2026-07-04)

Self-contained handoff. This session (1) finished the pickup task — **PR #163, which now makes
`mobile-doctor` green on `main` and all future PRs** — and (2) investigated the DigitalOcean
**disk-utilization alert** on a production DOKS node and produced a right-sizing recommendation
(nothing applied to infra — that is the owner's call; see §2).

`main` HEAD: `118823e build(mobile): adopt Expo SDK 56 patch releases + dedupe expo-constants to fix mobile-doctor (#163)`.

---

## 1. #163 — DONE (merged, `mobile-doctor` now green everywhere)

**The handoff's premise was partly wrong.** The prior runbook assumed all three red checks
(`mobile-doctor`, `workspace-js`, `pnpm-audit`) shared one root cause — CI's pnpm
`minimumReleaseAge` (24h) gate — and would all go green once the gate lifted at `2026-07-04
08:52:15Z`. Only **two** did. After I re-ran CI past the gate:

- `workspace-js` ✅ and `pnpm-audit` ✅ (these WERE just the release-age gate).
- `mobile-doctor` ❌ **still failed** — a genuine, different bug: a **duplicate native module**.

**Root cause of the remaining failure.** The SDK-56.0.14 bump set `expo-constants` to the
coordinated `~56.0.20` (required by `expo@56.0.14`, which declares `expo-constants ~56.0.20`), but
`expo-asset@56.0.18` kept an **older `56.0.19`** resolution — its own `~56.0.19` range still
matched, so pnpm didn't re-resolve that subtree, leaving **two copies** of `expo-constants`.
`expo-doctor`'s "no duplicate native modules" check failed on the two copies. (Classic
coordinated-set trap — memory `fountainrank-hoisted-linker-masks-expo-doctor-duplicates`. Local
hoisted linker would have shown a false 21/21; CI's isolated linker is the truth.)

**The fix (commit rolled into the squash).** `expo-asset@56.0.18` is the newest 56.x and its
`~56.0.19` range already accepts `56.0.20`, so I added a **scoped pnpm override** and regenerated
the lockfile:

```yaml
# pnpm-workspace.yaml (COMMITTED form — packages + overrides + allowBuilds only)
overrides:
  'expo-asset>expo-constants': '56.0.20'
```

- Override lives in `pnpm-workspace.yaml` `overrides:` (pnpm 11 **ignores** `pnpm.overrides` in
  `package.json` — it warns and drops it).
- Regenerated `pnpm-lock.yaml` **removes** `expo-constants@56.0.19` (and a pre-existing
  `@expo/env@2.3.0` dup the re-resolve also healed); **adds zero new package identities**, so the
  `minimumReleaseAge` gate stays green (verified: `pnpm install --frozen-lockfile` re-checked all
  **1071** entries locally, and again on CI).
- The scope selector `parent>child` only pins expo-asset's edge, not every `expo-constants` edge.

**⚠️ pnpm-workspace.yaml is skip-worktree** (memory: local-only `nodeLinker: hoisted` +
`minimumReleaseAgeExclude`). I committed ONLY `packages`+`overrides`+`allowBuilds` (no local
leakage) via the un-skip → write clean → commit → restore local → re-skip dance. If you edit that
file, remember it's `git update-index --skip-worktree`.

**Gates cleared:** CI green on `main` (`backend`, `workspace-js`, `mobile-doctor` 1m9s, CodeQL,
audits) · Codex `VERDICT: APPROVED` (`temp/codex-reviews/pr-163-review-1.md`; Codex independently
ran `expo-doctor` 21/21 and `frozen-lockfile` on 1071 entries) · only PR comment was the owner's
own status note.

**Consequence:** the "documented `mobile-doctor` override" used to merge the SEO slices is **no
longer needed** — `mobile-doctor` is green on `main`.

**Next Expo SDK bump:** revisit/remove the override (it pins `56.0.20`); `expo install --fix` for
the coordinated set, then check if the override is still needed.

---

## 2. DOKS disk alert — investigation + right-sizing recommendation (NOTHING APPLIED)

**Alert:** "Disk Utilization Percent 71.22% > 70% for 5m" on droplet **578682509**
(`64.23.184.50`).

**What it is:** a **worker node** (`worker-pool-3c75eg`) of **`fountainrank-production-cluster`**
(sfo3) — an **`s-2vcpu-2gb`** node (2 GB RAM, 2 vCPU, **60 GB disk**). Pool `worker-pool`:
**2 nodes, autoscale 1→3**, Terraform-managed (`terraform:default-node-pool`).

### Findings (all read-only; no cluster mutations)

- **Not a data-growth problem.** **No PVCs** in the cluster — Postgres/PostGIS is a **DO Managed
  Database** (`digitalocean_database_cluster.postgres`), external to the nodes. The node holds only
  stateless pods, so nothing is durably growing on disk.
- **`DiskPressure: False`** — kubelet is not near its image-GC/eviction threshold (~85%). The DO
  70% alert is an **early warning, not a crisis**; kubelet GCs images before 100%.
- **Image accumulation is the disk driver.** node1 has **48 stale `fountainrank-web` deploy tags
  (~12 GB)** cached (every web redeploy from the recent SEO-slice burst landed there). Image cache
  ≈ 12.5 GB of the node fs; the rest is OS + containerd overlay + logs.
- **The real constraint is RAM, not disk.** Memory **requests/limits**:
  - node1 `worker-pool-3c75eg`: **91% req / 133% lim (overcommitted)** — runs `fountainrank-backend`,
    `fountainrank-web`, `logto`.
  - node2 `worker-pool-3c7pru`: **86% req / 88% lim** — runs `basemap-tiles`, `healthz`,
    `ingress-nginx-controller`.
  Both ~2 GB nodes are ~90% memory-committed. There is **no headroom to rebalance**; the cluster is
  simply under-provisioned. (`kubectl top` unavailable — metrics-server not installed — so these are
  reservation %s, not live usage, but reservations are already the scheduling ceiling.)
- **Workload is lopsided** onto node1 (all 3 app pods + all their image history), which is why node1
  trips the disk alert first.

### Recommendation (owner decision — a cost/headroom tradeoff)

The disk alert is the **visible symptom of an under-provisioned cluster; RAM is the tighter
constraint.** Bumping the node **plan** fixes both disk headroom and the ~90% RAM pressure in one
move. DO ties node disk to the droplet plan (no independent disk resize for DOKS), and image
accumulation self-limits at kubelet's GC threshold — so "just add disk" isn't a lever and isn't
urgent; right-sizing the plan is the clean durable fix.

| Plan | RAM | vCPU | Disk | $/node/mo | 2-node total |
|------|-----|------|------|-----------|--------------|
| `s-2vcpu-2gb` (current) | 2 GB | 2 | 60 GB | $18 | $36 |
| **`s-2vcpu-4gb` (recommended)** | **4 GB** | 2 | **80 GB** | **$24** | **$48 (+$12/mo)** |
| `s-4vcpu-8gb` (growth headroom) | 8 GB | 4 | 160 GB | $48 | $96 (+$60/mo) |

**Recommended: `s-2vcpu-4gb`** — doubles RAM (relieves the 90% pressure), +33% disk (node1's
~43 GB used would sit at ~54% of 80 GB). `s-4vcpu-8gb` if you want more runway for growth.

**Not an emergency** — no action needed overnight (DiskPressure False; kubelet self-GCs). Do this
deliberately at low traffic; DOKS does a **rolling node replacement** (pods reschedule, brief
disruption).

### Exact change + apply procedure (via CI — never by hand)

`node_size` is a Terraform variable with **no override** anywhere (cluster uses the default). One
line in `infra/terraform/main.tf`:

```hcl
variable "node_size" {
  ...
  default = "s-2vcpu-4gb"   # was "s-2vcpu-2gb"
}
```

1. Branch → edit the default (or set `TF_VAR_node_size`) → PR. `terraform.yml` runs **plan** on PRs
   touching `infra/terraform/**` (expect: node pool replaced/resized).
2. Codex review + squash-merge.
3. **Apply via CI:** dispatch `terraform.yml` (`workflow_dispatch`, input `apply`; gated on the
   `production` environment). **Do NOT `terraform apply` locally** (IaC is read-only locally).

**Optional follow-ups (secondary):** pod anti-affinity / topology-spread so app pods aren't all on
one node; install metrics-server so `kubectl top` works and HPA is possible. Not required for the
alert.

---

## 3. Still outstanding (unchanged from prior handoff)

- **Resubmit the sitemap in GSC + Bing** (owner-local; now includes the fountains chunk).
- **Slice 1e** — coverage report/gate (spec §4.2/§7); backend-heavy, no new public routes.
- **#128 GA4** — owner-local (add GA4 property id to the SEO registry; `seo_health_check` until ok).
- Dependabot **#151** (frontend-js) & **#138** (backend-python). (A fresh Dependabot run kicked off
  after the #163 merge — routine.)

## 4. Env gotchas (carried forward — still true)

Backend tests need an isolated Windows UV env; web full suite unreliable locally (CI `workspace-js`
is authority); api-client regen is two manual steps; Codex review is bypass-mode with
`cwd=/mnt/d/repos/fountainrank` + repo-relative paths; deploy = `gh workflow run deploy.yml --ref
main` (manual). See `handoffs/2026-07-04-seo-slice5-shipped-handoff.md` §5 for the full detail.
