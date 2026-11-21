# Replace ingress-nginx with Traefik

## Why

ingress-nginx is retired and gets no more patches. The NGINX HTTP/2 RCEs (CVE-2026-123633,
CVE-2026-123007) are mitigated for now by `use-http2=false` (#317), but nothing else will ever be
fixed. We move to **Traefik v3.7.19** (Helm chart `traefik/traefik` **42.4.1**) and use its
**Kubernetes Ingress NGINX provider**, which reads our existing `ingressClassName: nginx`
Ingress objects and translates their `nginx.ingress.kubernetes.io/*` annotations. The Ingress
manifests in `infra/k8s/` don't change.

## Topology

```
client --TLS (LE cert)--> DO LB :443 --re-encrypted HTTPS--> node NodePort --> controller --> Service
client --HTTP----------> DO LB :80  --HTTP----------------> node NodePort --> controller (308 -> https)
```

| | ingress-nginx (today) | Traefik |
|---|---|---|
| Namespace / release | `ingress-nginx` / `ingress-nginx` | `traefik` / `traefik` |
| HTTP NodePort | 30080 | 31080 (`web` entryPoint, container 8000) |
| HTTPS NodePort | 30443 | 31443 (`websecure`, container 8443) |
| Backend cert (LB -> controller) | self-signed "Fake Certificate" | self-signed Traefik default cert |
| Values | `--set` flags in `deploy.yml` | `infra/helm/traefik-values.yaml` (+ trust CIDR from CI) |

The DO LB doesn't verify backend certificates, so a self-signed cert on the re-encrypted hop works
the same way it does today. TLS 1.2+ is enforced on that hop by the `default` TLSOption.

NodePort firewalling: Terraform manages no firewall. The DOKS cloud-controller-manager opens the
nodePorts of every `NodePort` Service on the cluster's public-access firewall, so 31080/31443
open the same way 30080/30443 did. No Terraform firewall change is needed.

## Phases

Each phase is its own PR. Deploy runs only on `workflow_dispatch` / `v*.*.*` tags, and Terraform
applies only via `terraform.yml`.

**Phase A: install Traefik alongside ingress-nginx (no traffic change).**
`deploy.yml` installs Traefik after ingress-nginx. The LB still forwards to 30080/30443, so
Traefik gets no LB traffic. Traefik doesn't write Ingress status (`publishService` off), creates
no IngressClass, and has the standard Ingress provider turned off.

**Phase B: flip the LB (Terraform).** The LB forwarding rules and health check move to
31080/31443. Merge only after Phase A is deployed and verified.

**Phase C: remove ingress-nginx.** The Traefik provider serves an Ingress only when its class
names an IngressClass object whose controller is `k8s.io/ingress-nginx`. That `nginx`
IngressClass belongs to the ingress-nginx release, so a plain `helm uninstall` would delete it
and Traefik would drop every route. `deploy.yml` hands the object over with no gap:

1. Annotate the live object `helm.sh/resource-policy=keep`.
2. `helm upgrade` the release with `controller.ingressClassResource.enabled=false`. Helm skips
   deleting a live object marked keep.
3. `kubectl apply` the repo-owned `infra/k8s/ingressclass-nginx.yaml`.
4. `helm uninstall` the release.

Merge only after Phase B has carried production traffic cleanly.

## Behavior mapping and differences

- **Forwarded headers / client IP.** Today: `use-forwarded-headers=true`,
  `compute-full-forwarded-for=true`, `use-proxy-protocol=false`, and no `proxy-real-ip-cidr`.
  That means ingress-nginx trusts `X-Forwarded-*` from **any** source, including direct hits on
  the publicly reachable NodePorts. Traefik trusts them only from the **cluster VPC CIDR**
  (`ports.{web,websecure}.forwardedHeaders.trustedIPs`). CI resolves the CIDR with `doctl` at
  deploy time and fails closed. From LB traffic, the app sees the same leftmost
  `X-Forwarded-For` (the client, as appended by the DO LB) and the same `X-Forwarded-Proto`.
  Direct NodePort hits can no longer spoof it. Difference: `X-Real-IP` is the LB/node address
  under Traefik, not the client. Nothing in the repo reads `X-Real-IP` (Logto uses
  `X-Forwarded-For` via `TRUST_PROXY_HEADER`).
- **`ssl-redirect` / `force-ssl-redirect`.** Non-TLS routers get a RedirectScheme to https with
  `ForcePermanentRedirect`, matching ingress-nginx's 308. HTTP from the LB lands on `web`, so it
  redirects. HTTPS lands on `websecure`, so it doesn't.
- **`proxy-body-size`.** The provider enforces it **only** through the Buffering middleware, and
  only when request buffering is on. We set `proxyRequestBuffering: true`, which also matches
  nginx's default `proxy_request_buffering on`. Explicit 25m/12m are honored. The provider
  default is 1 MiB, the same as nginx's. Bodies above 16 KiB spill to the `/tmp` emptyDir.
- **`use-regex` / `rewrite-target` (basemap tiles).** Regex is applied host-wide, as in nginx
  (`hostsWithUseRegex`). Paths become `PathRegexp("(?i)^<path>")`: case-insensitive and
  anchored, like nginx `~*`. `/tiles(/|$)(.*)` is `ImplementationSpecific`, so
  `strictValidatePathType` (kept true) doesn't reject it.
- **Hostless `/healthz` rule.** It's served for any Host on both entryPoints, so the LB health
  check works unchanged on the new port.
- **Timeouts / retries.** The provider defaults mirror nginx: 60s connect/read/send, and
  `proxy-next-upstream "error timeout"` with 3 tries.
- **HTTP/2.** Traefik negotiates h2 via ALPN on `websecure`. It's Go's HTTP/2 stack, not NGINX's,
  so the CVEs above don't apply.

## Verification

**After Phase A deploy (no live traffic on Traefik):**

- `kubectl -n traefik get deploy,svc,pods`: 1/1 ready, Service `NodePort` 80:31080, 443:31443.
- Traefik logs: the Ingress NGINX provider is loaded, with no errors about `fountainrank/*`
  Ingresses. Confirm the rendered args carry the VPC CIDR in
  `--entryPoints.web.forwardedHeaders.trustedIPs`.
- `kubectl get ingress -A -o wide`: the ADDRESS column is unchanged (still ingress-nginx's).
- From a pod in the cluster: `curl -sk https://traefik.traefik.svc/healthz` returns 200, and
  `curl -sk -H 'Host: fountainrank.com' https://traefik.traefik.svc/` returns 200.
  `curl -s -H 'Host: api.fountainrank.com' http://traefik.traefik.svc/` returns a 308 to https.
  `curl -sk -H 'Host: fountainrank.com' https://traefik.traefik.svc/tiles/planet.json` returns
  200. A 13 MB POST to `api.` returns 413.

**After Phase B apply:** the LB shows all nodes healthy. `/readyz` and home return 200. Traefik
access logs show real client IPs (`ClientHost` / `X-Forwarded-For`) and `RequestScheme` https.
Sign-in through `auth.` works, and the issuer is https. `http://` redirects with 308.

## Rollback

- **A:** revert the PR and redeploy. Then `helm uninstall traefik -n traefik` via a CI change
  (the release is inert while the LB doesn't target it).
- **B:** revert the Terraform change and run `terraform.yml` apply. ingress-nginx is still
  running, so traffic goes straight back to 30080/30443.
- **C:** revert the PR and redeploy. That reinstalls ingress-nginx (the Phase B state), and the
  Phase B revert can then point the LB back. The live `nginx` IngressClass still carries the old
  release's Helm ownership metadata, so the reinstall should adopt it. If Helm refuses
  ("invalid ownership metadata"), reinstall with
  `--set controller.ingressClassResource.enabled=false`. Don't delete the IngressClass: Traefik
  would drop every route.
