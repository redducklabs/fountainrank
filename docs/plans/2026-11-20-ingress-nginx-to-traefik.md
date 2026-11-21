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
nodePorts of every `NodePort` Service to `0.0.0.0/0` on the cluster's
`k8s-public-access-<cluster-id>` firewall; that is why 30080/30443 are public today. The Traefik
Service opts out with `kubernetes.digitalocean.com/firewall-managed: "false"`, so 31080/31443 get
no public rule and are reachable only over the VPC. The DO LB still reaches them: it connects to
the nodes from a private VPC address (ingress-nginx logs the LB health check from `10.124.0.x`),
and the DOKS-managed `k8s-<cluster-id>-worker` firewall allows all TCP from RFC 1918 sources.
`deploy.yml` enforces this with `scripts/ci/traefik_guards.py nodeports-not-public`, which reads
every Cloud Firewall applied to the nodes (by the `k8s:<cluster-id>` tag or by droplet ID) and
fails if any lets a non-RFC 1918 source reach 31080/31443, if no firewall applies at all, or if a
firewall failed or never finishes applying (it re-reads while `status` isn't `succeeded` or
`pending_changes` is non-empty):

1. **Before the install**, so Traefik with VPC trust is never installed or upgraded behind a
   public NodePort (for example a stale or hand-made rule).
2. **After the install**, together with a check that the live Service carries the annotation. If
   either fails, the step first withdraws the trust (`helm upgrade --reuse-values` with empty
   `trustedIPs`, so Traefik overwrites `X-Forwarded-*` itself and only the client IP degrades to
   the LB/node address), then fails the deploy.

The annotation is the primary control; the firewall read is the backstop (the cloud-controller
reconciles asynchronously, so a rule it adds later would be caught by the next deploy's
pre-install check). No Terraform firewall change is needed.

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
  deploy time and fails closed: `scripts/ci/traefik_guards.py` accepts only a strict IPv4 network
  inside an RFC 1918 block. From LB traffic, the app sees the same leftmost `X-Forwarded-For`
  (the client, as appended by the DO LB) and the same `X-Forwarded-Proto`. Difference:
  `X-Real-IP` is the LB/node address under Traefik, not the client. Nothing in the repo reads
  `X-Real-IP` (Logto uses `X-Forwarded-For` via `TRUST_PROXY_HEADER`).

  The VPC trust is sound only because the NodePorts are **VPC-only** (see *NodePort
  firewalling*). The Service keeps `externalTrafficPolicy: Cluster`, under which kube-proxy /
  Cilium may SNAT a caller to a node IP; a public caller would then look like a trusted VPC
  address and could forge `X-Forwarded-*`. With the public path closed, every caller that can
  reach the NodePort is already inside the trusted range, so `Local` would not narrow the trust.
  It would only make the single Traefik replica drop LB traffic on nodes without the pod and open
  a gap on every rollout (the LB needs three failed checks to drop a node). **Residual:** the
  region's default VPC is shared with other droplets in the account, and they are trusted too.
  Narrowing to the LB's own address isn't possible (the DO API doesn't expose its private IP). A
  dedicated cluster VPC would shrink the boundary but means recreating the cluster.
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
- **Access logs.** JSON to stdout with request headers dropped and **query strings dropped** from
  `RequestPath` (`accessLog.fields.queryParameters.defaultMode: drop`, Traefik >= v3.7.3). Query
  strings carry secrets such as the OAuth `code` on the `/callback` redirects, which
  `web/app/callback/route.ts` deliberately never logs. (ingress-nginx's access log still records
  them until Phase C removes it.)
- **HTTP/2.** Traefik negotiates h2 via ALPN on `websecure`. It's Go's HTTP/2 stack, not NGINX's,
  so the CVEs above don't apply.

## Verification

**After Phase A deploy (no live traffic on Traefik):**

- `kubectl -n traefik get deploy,svc,pods`: 1/1 ready, Service `NodePort` 80:31080, 443:31443.
- Traefik logs: the Ingress NGINX provider is loaded, with no errors about `fountainrank/*`
  Ingresses. Confirm the rendered args carry the VPC CIDR in
  `--entryPoints.web.forwardedHeaders.trustedIPs`.
- `kubectl get ingress -A -o wide`: the ADDRESS column is unchanged (still ingress-nginx's).
- NodePorts are VPC-only: the deploy's *Check ... (before install)* and *Verify ... (after
  install)* steps passed; `kubectl -n traefik get svc traefik -o yaml` shows
  `kubernetes.digitalocean.com/firewall-managed: "false"` and `externalTrafficPolicy: Cluster`;
  `doctl compute firewall list` shows no 31080/31443 rule on `k8s-public-access-<cluster-id>`. From outside DO, `curl -m 5 -k
  https://<node-public-ip>:31443/healthz` and `curl -m 5 http://<node-public-ip>:31080/healthz`
  time out (while `:30443` still answers, until Phase C).
- Access logs: after a request to `/callback?code=x&state=y` (or any query), Traefik's
  `RequestPath` shows `/callback` with no query string.
- From a pod in the cluster: `curl -sk https://traefik.traefik.svc/healthz` returns 200, and
  `curl -sk -H 'Host: fountainrank.com' https://traefik.traefik.svc/` returns 200.
  `curl -s -H 'Host: api.fountainrank.com' http://traefik.traefik.svc/` returns a 308 to https.
  `curl -sk -H 'Host: fountainrank.com' https://traefik.traefik.svc/tiles/planet.json` returns
  200. A 13 MB POST to `api.` returns 413.

**After Phase B apply:** the LB shows all nodes healthy (this also proves the LB reaches the
VPC-only NodePort 31443; if it doesn't, roll back B). `/readyz` and home return 200. Traefik
access logs show `ClientHost` = the LB's private VPC address (`10.124.0.x`, the immediate peer;
it is never the browser) and `RequestScheme` https. The forwarded client address is checked
where it is consumed: sign in through `auth.` and confirm the Logto Console audit log records
your public IP (Logto reads `X-Forwarded-For` via `TRUST_PROXY_HEADER`), not a `10.124.0.x`
address. Sign-in works, and the issuer is https. `http://` redirects with 308.

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
