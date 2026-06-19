# infra

Infrastructure-as-code for FountainRank. **Applies happen only in CI** (Phase 0f);
locally everything here is read-only / dry-run (see `claude_help/kubernetes-infra.md`).

- **`terraform/`** — single-file DO config (DOKS, Managed Postgres + PostGIS + a
  separate Logto DB, Spaces photos/pmtiles + CDN, LB + LE SAN cert, DNS A records,
  registry), assigned to the `FountainRank` project. See `terraform/README.md`.
- **`k8s/`** — raw YAML templated with `envsubst` (substituted in CI). The deploy
  **`kubectl apply` set** is `namespace.yaml`, `backend.yaml`, `web.yaml`, `logto.yaml`,
  `ingress.yaml`. The rest are **not** applied directly:
  - `secrets.yaml` + `registry-secret.yaml` — 📄 reference only (document the key
    contract). CI creates these secrets **imperatively** from GitHub Environment secrets +
    the Terraform DB outputs. Required keys in `fountainrank-secrets`: `database-url` (app),
    `logto-db-url` (Logto), and (email) `google-service-account-json` +
    `logto-email-webhook-token`. E.g.
    `kubectl create secret generic fountainrank-secrets -n "$NAMESPACE" --from-literal=database-url="$DATABASE_URL" --from-literal=logto-db-url="$LOGTO_DB_URL" --dry-run=client -o yaml | kubectl apply -f -`
    and `doctl registry kubernetes-manifest fountainrank --name regcred --namespace "$NAMESPACE" | kubectl apply -f -`
    (the Secret name `regcred` must match `imagePullSecrets`). Applying the committed
    placeholders would overwrite real secrets with empties.
  - `ingress-nginx.yaml` — 📄 documents the **Helm** install command (NodePort 30080/30443
    + `controller.config.*`); ingress-nginx is Helm-installed, not `kubectl apply`-ed.

## envsubst variables

| Variable | Example | Source |
|---|---|---|
| `${NAMESPACE}` | `fountainrank` | deploy workflow |
| `${ENVIRONMENT}` | `production` | deploy workflow |
| `${IMAGE_TAG}` | git SHA | build job |
| `${REGISTRY}` | `registry.digitalocean.com/fountainrank` | `DO_REGISTRY` |
| `${DOMAIN}` | `fountainrank.com` | deploy workflow |
| `${GOOGLE_DELEGATED_USER}` | `noreply@fountainrank.com` | `GOOGLE_DELEGATED_USER` var (email) |
| `${FROM_EMAIL}` | `noreply@fountainrank.com` | `FROM_EMAIL` var (email) |

## Deploy flow (CI, Phase 0f)

`doctl auth` → `doctl kubernetes cluster kubeconfig save <cluster>` →
`helm upgrade --install ingress-nginx … (NodePort 30080/30443)` → create secrets
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
