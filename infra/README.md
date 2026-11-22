# infra

Infrastructure-as-code for FountainRank. **Applies happen only in CI** (Phase 0f);
locally everything here is read-only / dry-run (see `claude_help/kubernetes-infra.md`).

- **`terraform/`** — single-file DO config (DOKS, Managed Postgres + PostGIS + a
  separate Logto DB, Spaces photos/pmtiles + CDN, LB + LE SAN cert, DNS A records,
  registry), assigned to the `FountainRank` project. See `terraform/README.md`.
- **`k8s/`** — raw YAML templated with `envsubst` (substituted in CI). The deploy
  **`kubectl apply` set** is `namespace.yaml`, `backend.yaml`, `account-deletion-cleanup.yaml`,
  `web.yaml`, `logto.yaml`, `ingress.yaml`. The rest are **not** applied directly:
  - `secrets.yaml` + `registry-secret.yaml` — 📄 reference only (document the key
    contract). CI creates these secrets **imperatively** from GitHub Environment secrets +
    the Terraform DB outputs. Required keys in `fountainrank-secrets`: `database-url` (app),
    `logto-db-url` (Logto), (email) `google-service-account-json` +
    `logto-email-webhook-token`, and (account deletion) `logto-management-app-id` +
    `logto-management-app-secret`. E.g.
    `kubectl create secret generic fountainrank-secrets -n "$NAMESPACE" --from-literal=database-url="$DATABASE_URL" --from-literal=logto-db-url="$LOGTO_DB_URL" --dry-run=client -o yaml | kubectl apply -f -`
    and `doctl registry kubernetes-manifest fountainrank --name regcred --namespace "$NAMESPACE" | kubectl apply -f -`
    (the Secret name `regcred` must match `imagePullSecrets`). Applying the committed
    placeholders would overwrite real secrets with empties.
  - `ingressclass-nginx.yaml` — the repo-owned `nginx` IngressClass (controller
    `k8s.io/ingress-nginx`) that Traefik's Ingress NGINX provider keys on. Applied by its own deploy
    step, not the envsubst apply loop.
- **`helm/traefik-values.yaml`**: Helm values for **Traefik**, the ingress controller
  (chart `traefik/traefik` 42.4.1, namespace `traefik`, NodePort 31080/31443; it replaced the
  retired ingress-nginx). It reads the `nginx`-class Ingresses through its Ingress NGINX provider.
  CI injects the forwarded-header trust CIDR (the cluster VPC) at deploy time; the NodePorts are
  VPC-only (`firewall-managed: "false"`). `scripts/ci/install-traefik.sh` does the install and
  checks the node firewalls (`scripts/ci/traefik_guards.py`) before and after it. Migration phases:
  `docs/plans/2026-11-20-ingress-nginx-to-traefik.md`.

  `node-image-cleanup.yaml` is a **DaemonSet** that removes stale `${REGISTRY}/` images from
  each node every 6h (kubelet image GC only starts at 85% disk; the DO disk alert fires at
  70%). It runs `infra/node-image-cleanup/host-cleanup.sh`, which the deploy workflow ships
  as the `node-image-cleanup-scripts` ConfigMap (built from files, not `envsubst`-ed). It
  never removes an image any container on the node uses, or one pulled within the last hour.

  `account-deletion-cleanup.yaml` is an hourly **CronJob** on the backend image that drains the
  `deleted_accounts` / `storage_cleanup` pending ledgers left by `DELETE /api/v1/me`. It exits
  non-zero while any row still fails, so a persistent failure shows up as a Failed Job.

## envsubst variables

| Variable | Example | Source |
|---|---|---|
| `${NAMESPACE}` | `fountainrank` | deploy workflow |
| `${ENVIRONMENT}` | `production` | deploy workflow |
| `${IMAGE_TAG}` | git SHA | build job |
| `${REGISTRY}` | `registry.digitalocean.com/fountainrank` | `DO_REGISTRY` |
| `${DOMAIN}` | `fountainrank.com` | deploy workflow |
| `${NODE_IMAGE_CLEANUP_SHA}` | sha256 hex | deploy workflow (hash of every file in `infra/node-image-cleanup/`) |
| `${GOOGLE_DELEGATED_USER}` | `noreply@fountainrank.com` | `GOOGLE_DELEGATED_USER` var (email) |
| `${FROM_EMAIL}` | `noreply@fountainrank.com` | `FROM_EMAIL` var (email) |
| `${LOGTO_MANAGEMENT_RESOURCE}` | `https://default.logto.app/api` | optional `LOGTO_MANAGEMENT_RESOURCE` var |
| `${LOGTO_MANAGEMENT_API_BASE_URL}` | `https://auth.fountainrank.com/api` | optional `LOGTO_MANAGEMENT_API_BASE_URL` var |

## Deploy flow (CI, Phase 0f)

`doctl auth` → `doctl kubernetes cluster kubeconfig save <cluster>` →
`scripts/ci/install-traefik.sh` (resolve the cluster VPC CIDR → check the NodePorts are
VPC-only → `helm upgrade --install traefik … (NodePort 31080/31443)` → re-check) → remove any
leftover ingress-nginx release, keeping the `nginx` IngressClass → create secrets
imperatively (`fountainrank-secrets`, `regcred`) → `envsubst < manifest | kubectl apply -f -`
for the apply set → `kubectl rollout status`. Migrations run via `kubectl exec` into the
backend pod (`alembic upgrade head`).

## Local validation (read-only — never apply)

```bash
# Terraform
cd terraform && terraform fmt -check && terraform init -backend=false && terraform validate
# k8s manifests — placeholder check + kubeconform (NOT kubectl dry-run, which hits the cluster)
cd k8s && export NAMESPACE=fountainrank ENVIRONMENT=production IMAGE_TAG=test \
  REGISTRY=registry.digitalocean.com/fountainrank DOMAIN=fountainrank.com \
  GOOGLE_DELEGATED_USER=noreply@fountainrank.com FROM_EMAIL=noreply@fountainrank.com
for f in *.yaml; do
  r="$(envsubst < "$f")"
  echo "$r" | grep -q '\${' && echo "UNSUBSTITUTED in $f"
  echo "$r" | kubeconform -strict -summary -kubernetes-version 1.34.0 -
done
```
