# Security Review Remediation — Implementation Plan

**Goal:** Resolve every actionable item in `temp/security-review-2026-06-20.md`, clearly
separating repository-enforced controls from owner-only credential and workstation actions.

**Security assessment:** `temp/security-review-2026-06-20.md` (updated 2026-07-13, snapshot
`339f6916ee266214e27af9f9bcbfc4c0cbdde1ee`). The assessment is the requirements source for
this plan; no new product behavior is introduced.

**Delivery strategy:** Use small, ordered PRs. Each PR runs its relevant local checks, then the
full CI mirror before push where the host supports it, and must pass hosted CI plus the repository
review gate. Infrastructure changes remain declarative; no local Terraform apply, Kubernetes
apply, secret mutation, or database write is part of this plan.

On this Windows/WSL host, backend checks are locally authoritative. Component-render/full JS
tests, mobile React-Compiler lint, and `expo-doctor` are CI-authoritative; reports must name those
local gaps rather than describing an unrun local check as green.

## Global constraints

- Never copy credential values, private keys, tokens, `.env` contents, full database URLs, or
  other secrets into commands, logs, documentation, commits, or review artifacts.
- Do not delete another instance's `.env` until its replacement loading mechanism is verified.
- Do not revoke an Apple key without first establishing that it was registered or used.
- Do not dismiss scanner alerts or add `.trivyignore` entries merely to make a gate green. Every
  exception needs an exposure analysis, owner, concrete justification, and revisit condition.
- Trivy gates initially target fixed high/critical findings. Unfixed findings remain visible in
  SARIF and are tracked rather than silently ignored.
- NetworkPolicies must not be enabled until the target CNI's enforcement is confirmed and every
  required flow is enumerated. A deny policy without verified egress dependencies can break auth,
  email, database, object storage, DNS, and health checks.
- Pinning actions or images requires resolving the exact upstream release to an immutable SHA or
  digest from authoritative metadata. Never invent hashes.
- The two moderate JS advisories retain their existing narrow suppressions until compatible
  upstream dependency chains contain fixed versions; do not force incompatible overrides.

## Workstream 0 — Owner-only incident closure

This workstream is deliberately not automated from the repository.

- [ ] In Google Cloud, identify the exposed service-account key by key ID/fingerprint and confirm
  it is disabled or deleted. Record only the retired identifier and rotation date.
- [ ] Confirm the `production` GitHub Environment contains the replacement service-account JSON
  and identify a successful deployment performed after the secret update.
- [ ] Confirm whether `AuthKey_KDB8D3BHZ2.p8` was ever registered or used. Revoke it only if it
  was live.
- [ ] Inventory other development instances for in-checkout `.env` files without printing or
  transmitting values. Move secrets to the approved platform store or a path outside the public
  checkout, verify loading, then remove the old copies.
- [ ] Add a secret-free handoff entry containing dates, retired credential identifiers, deployment
  run ID, and the workstation migration disposition. Never include key material.

**Acceptance:** an operator can verify rotation, replacement deployment, Apple-key disposition,
and workstation cleanup from identifiers and dates alone, while repository and shell history
contain no secret values.

Finding 1 (the exposed domain-wide-delegated Google credential) is a hard completion blocker. It
cannot be downgraded to an accepted open risk in a repository artifact; completion requires
positive evidence that the exposed key is disabled/deleted and the replacement was deployed.

## Workstream 1 — Bound contribution inputs

Deliver this before expanding rate gates so invalid oversized/duplicate payloads are rejected
without acquiring locks or touching the database.

- [ ] Add a documented normalized maximum for `AddFountainRequest.comments`. Strip surrounding
  whitespace and convert an empty string to `None`, matching placement-note behavior.
- [ ] Add explicit fixed schema-ceiling constants to add-fountain ratings/observations, standalone
  ratings, and standalone attribute observations. Pydantic enforces these static ceilings; any
  validation against current active database cardinality is an additional handler-level check,
  not a dynamic schema bound.
- [ ] Reject duplicate rating-dimension IDs and duplicate attribute-type IDs in the Pydantic
  request model before database work. Preserve partial submissions.
- [ ] Determine and record whether an admin edit path can write `comments` (the current
  `AdminFountainUpdate`/admin router appear to do so). If confirmed, apply the same bound and
  normalization there; do not leave the path unbounded or silently skip the determination.
- [ ] Add focused schema/API tests for boundaries, normalization, duplicate IDs, and 422 responses.
- [ ] Regenerate the tracked OpenAPI document and TypeScript schema and verify the generated diff.

**Verification:** backend lint/format/tests and Alembic drift check; API-client generation and
type-check; relevant web/mobile type-checks. Run the full local mirror before push, disclosing
host-only gaps exactly as `claude_help/local-dev.md` requires.

## Workstream 2 — Durable contribution-write rate limiting

- [ ] Write a focused design spec before implementation. Define which endpoints share budgets,
  per-minute/per-day thresholds, retry semantics, cleanup/retention, and whether `/me/sync` has a
  separate lower-cost budget. Include authenticated account-farm limits and clarify that ingress
  per-IP defense is complementary, not authoritative.
- [ ] Use a durable attempt ledger with a migration and transaction-scoped per-user advisory lock;
  do not infer attempts only from successful domain rows. Failed validated attempts must consume
  burst budget where abuse would otherwise be cheap.
- [ ] Acquire the authoritative gate before expensive/database-mutating work and map rejection to
  HTTP 429 with `Retry-After` and a stable non-sensitive reason code.
- [ ] Apply gates to fountain creation, ratings, attribute observations, condition reports, notes,
  and `/me/sync`. Keep existing photo and content-report budgets independent.
- [ ] Add structured rate-limit logs with user ID, endpoint/budget kind, count, and retry window;
  never log request bodies or identity tokens.
- [ ] Add boundary, retry-header, rollback, cross-pod/durable, and true-concurrency tests against
  the real PostGIS test service, proving the Postgres advisory lock prevents parallel
  over-admission. Do not use SQLite or an in-memory substitute for lock correctness.
- [ ] Add an ingress/controller-level per-IP policy only after establishing a trusted-proxy CIDR
  for the DO LB/node network. The current NodePort topology uses `use-forwarded-headers=true`,
  `compute-full-forwarded-for=true`, and no PROXY protocol; without a narrow
  `proxy-real-ip-cidr`, client-supplied `X-Forwarded-For` is not a safe rate-limit identity. Test
  both real client propagation and that direct client headers cannot spoof the gate key.

**Verification:** migration upgrade/downgrade/upgrade, named constraints/indexes, `alembic check`,
full backend suite including concurrency tests, rendered ingress validation, and the full CI mirror.

## Workstream 3 — Kubernetes workload hardening

- [ ] Apply the existing basemap/account-cleanup pod security pattern to backend, web, and healthz:
  pod-level non-root UID/GID where image contracts permit, `RuntimeDefault` seccomp, container
  `allowPrivilegeEscalation: false`, dropped capabilities, and read-only root filesystems with
  explicit writable `emptyDir` mounts where required.
- [ ] Set `automountServiceAccountToken: false` for backend, web, Logto, healthz, basemap, and jobs
  that do not call the Kubernetes API.
- [ ] Inspect the pinned Logto image's declared user and runtime write paths. Apply only controls
  verified against that contract; add explicit writable mounts rather than making the root
  filesystem writable wholesale.
- [ ] Add tests/static assertions covering all workload security contexts and token automounting.
- [ ] Confirm DigitalOcean's current DOKS CNI supports NetworkPolicy enforcement before adding
  policy resources.
- [ ] Document the required flow matrix: ingress-controller to web/backend/Logto/healthz; workload
  DNS; backend to managed Postgres, Logto/JWKS/userinfo/management, Gmail, geocoding, and Spaces;
  web to backend/Logto as actually performed server-side; Logto to Postgres and configured
  connectors; basemap traffic; and job-specific flows.
- [ ] Add namespace default-deny ingress/egress and least-privilege allow policies from the verified
  matrix. Use namespace/pod selectors for in-cluster traffic and the narrowest maintainable
  external CIDR/port rules; document any hostname-destination limitation and its compensating
  control.

**Verification:** render every manifest using non-secret placeholder values, validate with the
project-pinned kubeconform schema set, run policy/static checks, and inspect the complete rendered
diff. Deployment and live connectivity smoke tests occur only through CI.

## Workstream 4 — DOKS security upgrades

- [ ] Confirm from current DigitalOcean documentation whether the configured maintenance policy
  covers automatic Kubernetes patch upgrades and what disruption behavior applies to the
  single-node/small-cluster topology.
- [ ] Prefer `auto_upgrade = true` with a required explicit maintenance policy in Terraform if the
  workload and capacity analysis is safe. If it is not safe, write an owner-visible manual patch runbook and
  a scheduled CI check that fails or opens an issue when the configured/live version leaves the
  supported patched set.
- [ ] Add Terraform validation or tests that prevent silently returning to `auto_upgrade = false`
  without the accepted-risk control.

**Verification:** `terraform fmt -check`, `terraform init -backend=false`, `terraform validate`,
and a CI-generated Terraform plan whose entire blast radius is reviewed before any separately
authorized apply. The DOKS resource must show an in-place update and the complete plan must show
`0 to destroy`; any replacement/ForceNew result (including an incidental `node_size` change) stops
the work for explicit maintenance planning. Never apply locally.

## Workstream 5 — Trivy enforcement and alert triage

- [ ] Export the current open Trivy alerts through `gh` after verifying authentication. Classify
  each as actionable, fixed upstream, unfixed, intentional architecture, duplicate, or stale.
- [ ] Fix actionable fixed-version alerts first, including vulnerable build/runtime packages and
  base images, and rebuild scans to prove removal.
- [ ] Record precise GitHub dismissal reasons only for confirmed intentional/stale alerts, with a
  revisit condition. Do not bulk-dismiss by rule or severity.
- [ ] Treat triage as a hard precondition to enabling the filesystem misconfiguration gate: every
  currently detected high/critical misconfiguration must first be fixed or covered by a landed,
  narrowly justified exception with a revisit condition.
- [ ] In `security-audit.yml`, split `trivy-fs` into a PR-gating table pass and an `if: always()`
  SARIF pass. Gate fixed high/critical filesystem vulnerabilities and, only after the precondition
  above is satisfied, misconfigurations. This is the PR-time Trivy gate.
- [ ] In `deploy.yml`, convert/add backend and web image table scans with `exit-code: "1"` inside
  the existing `build-push` job, while retaining `if: always()` SARIF uploads. The `deploy` job
  already has `needs: build-push`; a failed image table scan therefore blocks manifest application.
  Build/push may occur before scanning because the registry image is the scan source.
- [ ] Keep the scheduled/push `security-audit.yml` image scans gating for ongoing detection, but
  explicitly recognize that its `image-scan` job skips pull requests. Image-vulnerability
  prevention is therefore a deploy-time gate; PR-time image scanning is not claimed.
- [ ] Add workflow tests/actionlint and assert that a synthetic fixed high/critical result produces
  a non-zero gate while SARIF upload still runs.

**Verification:** YAML parse, actionlint, local Trivy with the workflow's pinned version when
available, and hosted `security-audit.yml`. A successful run must mean the new fixed
high/critical gates passed, not merely that SARIF uploaded.

## Workstream 6 — Immutable supply-chain inputs

- [ ] Inventory every `uses:` reference and prioritize deploy, Terraform, mobile release, imports,
  and other secret-handling workflows.
- [ ] Resolve each existing action release tag to its full commit SHA using the upstream repository
  and retain the release tag in a comment. Verify Dependabot remains configured for GitHub Actions.
- [ ] Pin remaining first-party and third-party actions, then pin Dockerfile and Kubernetes image
  inputs by digest while retaining readable version tags/comments.
- [ ] Ensure the image-update path remains automated and reviewable; validate architecture support
  for every digest used by local/CI/runtime platforms.
- [ ] Add a repository check that rejects unpinned external action references and third-party
  production image inputs. Exempt same-repository local actions/reusable workflows by `./` path,
  and exempt first-party `${REGISTRY}/fountainrank-*:${IMAGE_TAG}` Kubernetes images because their
  immutable digest is created during the deploy build. Do not exempt external reusable workflows.

**Verification:** actionlint, workflow YAML parse, pin-check test, container builds for supported
architectures, and hosted CI/security workflows.

## Workstream 7 — Deferred moderate dependency advisories

- [ ] Keep the existing `postcss` and Expo-tooling `uuid` suppressions unchanged while their
  documented runtime exposure remains accurate.
- [ ] On each compatible Next/Expo update, run the bounded audit and inspect dependency paths.
- [ ] Remove each suppression in the same change that moves the lockfile to a patched transitive
  version; run web build and the CI-only Expo/mobile gates before claiming resolution.

## Ordered PR breakdown

Every unit below is independently reviewable and mergeable. A later unit may be replanned after
evidence from an earlier unit; unrelated units are not bundled to reduce PR count.

1. **PR A — Input bounds:** Workstream 1 only, including tests and generated API-client artifacts.
2. **PR B — Rate-limit design:** the focused Workstream 2 design spec and its approved detailed
   implementation plan; no runtime changes.
3. **PR C — Durable write ledger:** migration/model, shared gate primitives, PostGIS concurrency
   tests, and retention/cleanup behavior; no endpoint wiring.
4. **PR D — Contribution endpoint gates:** fountain/rating/attribute/condition/note wiring,
   structured logs, 429 contract tests, and generated clients.
5. **PR E — Profile-sync gate:** `/me/sync` budget and tests, kept separate because its idempotent
   auth/profile behavior and cost profile differ from contribution writes.
6. **PR F — Trusted client IP and ingress gate:** establish the DO-LB trusted proxy boundary, then
   add/test ingress per-IP defense. This depends on evidence from the deployed topology and is not
   coupled to the application ledger PRs.
7. **PR G — Core pod hardening:** backend/web/healthz security contexts, token automount controls,
   writable mounts, static assertions, and rendered-manifest validation.
8. **PR H — Logto and remaining workload hardening:** verify the pinned image user/write contract,
   then harden Logto and audit basemap/jobs for token automount. This is separate from core apps so
   the third-party runtime contract is explicit.
9. **PR I — NetworkPolicy design evidence:** CNI enforcement confirmation plus the complete flow
   matrix and rollout/rollback validation plan; no default-deny resource yet.
10. **PR J — NetworkPolicy rollout:** default-deny and least-privilege allow policies only after PR I
    is approved. This is the last Kubernetes-hardening PR and deploys through CI with live smokes.
11. **PR K — DOKS upgrade control:** Workstream 4 only, with the `0 to destroy` plan acceptance gate.
12. **PR L — Trivy backlog remediation:** actionable package/image fixes and justified scanner
    dispositions. This must land before gating any detector that is currently red.
13. **PR M — Trivy gates:** Workstream 5 workflow changes after PR L satisfies the preconditions.
14. **PR N — Secret-handling action pins:** deploy/Terraform/release/import workflows first.
15. **PR O — Remaining action/image pins and enforcement:** remaining external action SHAs,
    third-party image digests, update automation, and the repository pin-check.

Workstream 0 proceeds out of band and records only secret-free evidence. Workstream 7 is performed
only when a compatible upstream dependency update exists, in its own dependency-update PR(s).

## Completion and evidence

- [ ] Update `temp/security-review-2026-06-20.md` only as a working artifact after evidence exists;
  do not mark operational findings resolved from repository changes alone.
- [ ] Maintain a secret-free handoff linking each finding to its PR, CI run, scanner disposition,
  and any owner-only verification.
- [ ] Re-query Dependabot, code-scanning, and secret-scanning state after the final repository PR.
- [ ] Completion requires: the Google key rotation/deployment positively verified; other owner-only
  items verified or explicitly accepted as open risk; all
  repository workstreams merged through CI/review; fixed high/critical Trivy gates green; relevant
  live deployment smoke tests green; and remaining moderate advisories documented with current
  exposure and revisit conditions.
