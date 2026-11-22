# Replace ingress-nginx with Traefik

## Why

ingress-nginx is retired and gets no more patches. The NGINX HTTP/2 RCEs (CVE-2026-123633,
CVE-2026-123007) are mitigated for now by `use-http2=false` (#317), but nothing else will ever be
fixed. We move to **Traefik v3.7.19** (Helm chart `traefik/traefik` **42.4.1**) and use its
**Kubernetes Ingress NGINX provider**, which reads our existing `ingressClassName: nginx`
Ingress objects and translates their `nginx.ingress.kubernetes.io/*` annotations. The Ingress
manifests in `infra/k8s/` don't change.

## Topology

Today (ingress-nginx):

```
client --TLS (LE cert)--> DO LB :443 --re-encrypted HTTPS--> node :30443 --> ingress-nginx --> Service
client --HTTP----------> DO LB :80  --HTTP----------------> node :30080 --> ingress-nginx (308 -> https)
```

After Phase B (Traefik):

```
client --TLS (LE cert)--> DO LB :443 --HTTP, X-Forwarded-Proto: https--> node :31080 (web) --> Traefik --> Service
client --HTTP----------> DO LB :80  --HTTP, X-Forwarded-Proto: http---> node :31080 (web) --> Traefik (308 -> https)
DO LB health check -----------------------HTTPS /healthz-------------> node :31443 (websecure) --> Traefik --> healthz
```

| | ingress-nginx (today) | Traefik |
|---|---|---|
| Namespace / release | `ingress-nginx` / `ingress-nginx` | `traefik` / `traefik` |
| HTTP NodePort | 30080 | 31080 (`web` entryPoint, container 8000): all app traffic |
| HTTPS NodePort | 30443 | 31443 (`websecure`, container 8443): the LB health check only |
| LB 443 -> controller | re-encrypted HTTPS, self-signed "Fake Certificate" | plain HTTP inside the VPC |
| Values | `--set` flags in `deploy.yml` | `infra/helm/traefik-values.yaml` (+ trust CIDR from CI) |

**Why 443 is not re-encrypted to Traefik.** Traefik's Ingress NGINX provider gives every Ingress
hostname its own TLS option (`getOrCreateServer` in `pkg/provider/kubernetes/ingress-nginx/build.go`,
v3.7.19: `TLSOptionName = hostname`), and Traefik's SNI check answers **421 Misdirected Request**
when the TLS option the connection's SNI selects differs from the one for the request's Host. A
connection with no SNI, or an SNI other than the Host, therefore gets 421 on every host route
(seen on therapy-link's Phase A probe). ingress-nginx never checked SNI, so nothing shows whether
the DO LB sends an SNI matching the Host on its re-encrypted backend connection, and if it doesn't,
a re-encrypted cutover is a total outage. Forwarding 443 to `web` over plain HTTP has no SNI to
check. The hop stays inside the VPC, as the 80 -> 30080 hop always has. The re-encrypted hop it
replaces gave no authentication either (the LB never verified the self-signed certificate).

The LB health check stays HTTPS (on 31443): over plain HTTP the hostless `/healthz` rule inherits
the Ingress's `force-ssl-redirect` and the probe sends no `X-Forwarded-Proto`, so it would get a
308. The probe's Host is a node address that matches no app host, so its router uses the `default`
TLS option and the SNI check passes whatever SNI the LB sends. TLS 1.2+ is enforced there by the
`default` TLSOption.

NodePort firewalling: Terraform manages no firewall. The DOKS cloud-controller-manager opens the
nodePorts of every `NodePort` Service to `0.0.0.0/0` on the cluster's
`k8s-public-access-<cluster-id>` firewall; that is why 30080/30443 are public today. The Traefik
Service opts out with `kubernetes.digitalocean.com/firewall-managed: "false"`, so 31080/31443 get
no public rule and are reachable only over the VPC. The DO LB still reaches them: it connects to
the nodes from a private VPC address (ingress-nginx logs the LB health check from `10.124.0.x`),
and the DOKS-managed `k8s-<cluster-id>-worker` firewall allows all TCP from RFC 1918 sources.
`deploy.yml` installs Traefik through one script, `scripts/ci/install-traefik.sh`, so every
failure path is handled in one place. It resolves and validates the VPC range, then runs
`scripts/ci/traefik_guards.py nodeports-not-public`, which reads with `doctl`:

- the cluster's nodes (node-pool list) and each node droplet's real tags (droplet list),
- every Cloud Firewall, keeping those applied to a node through ANY of its tags or its droplet ID.

It fails if any node has no firewall at all (an unfirewalled droplet accepts everything), if any
applied inbound TCP rule covering 31080/31443 allows a source other than an RFC 1918 IPv4 range
(resource selectors such as droplet IDs, tags or load balancers can't be proven VPC-only, so they
count as public, as do IPv6 and unparseable addresses), or if a firewall failed or never finishes
applying (it re-reads while `status` isn't `succeeded` or `pending_changes` is non-empty). The
script runs it:

1. **Before the install**, so Traefik with VPC trust is never installed or upgraded behind a
   public NodePort (for example a stale or hand-made rule).
2. **After the install**, together with a check that the live Service carries the annotation.

**Any** failure in the script (chart fetch, VPC lookup, either check, the Helm install itself)
withdraws the trust from whatever Traefik is running, then fails the deploy. It judges the
result on every layer that runs or can recreate a Traefik pod: contained only when the
Deployment's controller has observed its latest spec and that spec won't create a trusted pod
(clean template, or scaled to 0), no ReplicaSet that still wants replicas has a trusted template,
and no existing pod (old, new or terminating) carries a `forwardedHeaders.trustedIPs`/`insecure`
flag. An unreadable API counts as still trusted. It escalates until that holds, polling after
each step:

1. `helm upgrade --reuse-values` with both `trustedIPs` set to `[]`, from the chart the script
   already pulled (no chart-repo round trip). Traefik then overwrites `X-Forwarded-*` itself; only
   the client IP degrades to the LB/node address.
2. Strip the trust flags from the live Deployment (`kubectl replace`), still serving.
3. Scale Traefik to 0: in Phase B and later that is an outage, which beats forgeable forwarded
   headers. If even that fails the log says `COULD NOT CONTAIN` and someone has to act.

A failure in an earlier deploy step leaves Traefik untouched in its last verified state.

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
  `ForcePermanentRedirect`, matching ingress-nginx's 308. After Phase B both LB entry ports land on
  `web`. RedirectScheme takes the scheme from `X-Forwarded-Proto` when it is present
  (`pkg/middlewares/redirect/redirect_scheme.go`, `clientRequestURL`), and `web` trusts that
  header from the VPC, so the LB's `http` (port 80) redirects and its `https` (port 443) passes
  through to the rest of the router's middlewares (buffering, rewrite) unchanged. The apps see the
  LB's `X-Forwarded-Proto: https`, as they do today.
- **`proxy-body-size`.** The provider enforces it **only** through the Buffering middleware, and
  only when request buffering is on. We set `proxyRequestBuffering: true`, which also matches
  nginx's default `proxy_request_buffering on`. Explicit 25m/12m are honored. The provider
  default is 1 MiB, the same as nginx's. Bodies above 16 KiB spill to the `/tmp` emptyDir.
- **`use-regex` / `rewrite-target` (basemap tiles).** Regex is applied host-wide, as in nginx
  (`hostsWithUseRegex`). Paths become `PathRegexp("(?i)^<path>")`: case-insensitive and
  anchored, like nginx `~*`. `/tiles(/|$)(.*)` is `ImplementationSpecific`, so
  `strictValidatePathType` (kept true) doesn't reject it.
- **Hostless `/healthz` rule.** It's served for any Host on both entryPoints. The LB health check
  uses it over HTTPS on 31443 (see *Topology*).
- **Timeouts / retries.** The provider defaults mirror nginx: 60s connect/read/send, and
  `proxy-next-upstream "error timeout"` with 3 tries.
- **Access logs.** JSON to stdout with request headers dropped and **query strings dropped** from
  `RequestPath` (`accessLog.fields.queryParameters.defaultMode: drop`, Traefik >= v3.7.3). Query
  strings carry secrets such as the OAuth `code` on the `/callback` redirects, which
  `web/app/callback/route.ts` deliberately never logs. (ingress-nginx's access log still records
  them until Phase C removes it.)
- **HTTP/2.** Clients negotiate HTTP/2 with the DO LB, not with Traefik; the LB -> Traefik hop is
  HTTP/1.1. Traefik's `websecure` offers h2 via ALPN, which only the health check reaches. Either
  way it's Go's HTTP/2 stack, not NGINX's, so the CVEs above don't apply.

## Verification

**After Phase A deploy (no live traffic on Traefik):**

- `kubectl -n traefik get deploy,svc,pods`: 1/1 ready, Service `NodePort` 80:31080, 443:31443.
- Traefik logs: the Ingress NGINX provider is loaded, with no errors about `fountainrank/*`
  Ingresses. Confirm the rendered args carry the VPC CIDR in
  `--entryPoints.web.forwardedHeaders.trustedIPs`.
- `kubectl get ingress -A -o wide`: the ADDRESS column is unchanged (still ingress-nginx's).
- NodePorts are VPC-only: the deploy log of `install-traefik.sh` shows both firewall checks
  passed (`no public rule for [31080, 31443] on nodes ...`); `kubectl -n traefik get svc traefik -o yaml` shows
  `kubernetes.digitalocean.com/firewall-managed: "false"` and `externalTrafficPolicy: Cluster`;
  `doctl compute firewall list` shows no 31080/31443 rule on `k8s-public-access-<cluster-id>`. From outside DO, `curl -m 5 -k
  https://<node-public-ip>:31443/healthz` and `curl -m 5 http://<node-public-ip>:31080/healthz`
  time out (while `:30443` still answers, until Phase C).
- Access logs: after a request to `/callback?code=x&state=y` (or any query), Traefik's
  `RequestPath` shows `/callback` with no query string.
- From a pod in the cluster: `curl -sk https://traefik.traefik.svc/healthz` returns 200 (the
  hostless rule uses the `default` TLS option, so no SNI is needed). Host routes need an SNI that
  matches the Host, or Traefik answers 421 (see *Topology*), so connect with `--connect-to`:
  `curl -sk --connect-to fountainrank.com:443:traefik.traefik.svc:443 https://fountainrank.com/`
  returns 200, and the same for `https://fountainrank.com/tiles/planet.json`.
  `curl -s -H 'Host: api.fountainrank.com' http://traefik.traefik.svc/` returns a 308 to https (a
  pod address is outside the trusted VPC range, so no `X-Forwarded-Proto` is honoured). A 13 MB
  POST to `https://api.fountainrank.com/` through `--connect-to` returns 413.

**After Phase B apply** (the exact commands are in the Phase B PR description):

- The LB was updated in place (same IP): 80/http and 443/https both forward to **http 31080**, and
  the health check is **https 31443 `/healthz`**. All nodes healthy, which also proves the LB
  reaches the VPC-only NodePorts. If they stay unhealthy, roll back B.
- Traffic reaches Traefik: an unknown Host through the LB gets Traefik's plain-text
  `404 page not found` (ingress-nginx answers an HTML page naming nginx), and a probe path shows up
  in Traefik's access log on a `@kubernetesingressnginx` router with `entryPointName` `web`, and not
  in ingress-nginx's log.
- No host returns 421: home, `www.`, `api.` `/readyz`, `auth.` OIDC discovery (issuer
  `https://auth.fountainrank.com/oidc`), `/tiles/planet.json`.
- `http://` redirects with 308 to `https://`, and `https://` does **not** redirect. The second check
  proves `web` trusts the LB's `X-Forwarded-Proto: https`; without that trust every https request
  would 308 to itself.
- The certificate is the LB's Let's Encrypt certificate, as before.
- 413 over the limits: 13 MiB to `api.` (12m), 26 MiB to the web host (25m).
- Client IP: Traefik's `ClientHost` is the LB's private VPC address (`10.124.0.x`, the immediate
  peer; it is never the browser). The forwarded client address is checked where it is consumed:
  sign in through `auth.` and confirm the Logto Console audit log records your public IP (Logto
  reads `X-Forwarded-For` via `TRUST_PROXY_HEADER`), not a `10.124.0.x` address. Sign-in works.

## Rollback

- **A:** revert the PR and redeploy. Then `helm uninstall traefik -n traefik` via a CI change
  (the release is inert while the LB doesn't target it).
- **B:** revert the Terraform change, merge the revert, and run `terraform.yml` with
  `action=apply` (after its plan shows only the in-place LB update). ingress-nginx is still
  running until Phase C, so traffic goes straight back to 30080 (http) and 30443 (re-encrypted
  https). Confirm the unknown-Host probe is ingress-nginx's HTML 404 again and the Phase B site
  checks pass.
- **C:** revert the PR and redeploy. That reinstalls ingress-nginx (the Phase B state), and the
  Phase B revert can then point the LB back. The live `nginx` IngressClass still carries the old
  release's Helm ownership metadata, so the reinstall should adopt it. If Helm refuses
  ("invalid ownership metadata"), reinstall with
  `--set controller.ingressClassResource.enabled=false`. Don't delete the IngressClass: Traefik
  would drop every route.
