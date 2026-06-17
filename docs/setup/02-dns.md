# 02 — DNS & email deliverability (`fountainrank.com`)

Sets up the domain records that make TLS certificate issuance, the `auth`
subdomain (Logto), and **email deliverability** work. DNS and especially DMARC
propagation are slow, so do this early.

**Unblocks:** LB Let's Encrypt cert issuance, the Logto `auth.` endpoint, and
deliverable auth email (magic link / verification).

---

## Prerequisites

- You control the `fountainrank.com` domain (registrar login).
- Decision: **where do the nameservers point?**
  - **Option A (recommended):** delegate the domain's nameservers to
    **DigitalOcean** (`ns1/ns2/ns3.digitalocean.com`). Then Terraform manages
    the A records for you and there's one source of truth.
  - **Option B:** keep DNS at your current registrar/provider. Then **you** add
    the A records by hand and Terraform does *not* manage DNS.

> Tell me which option you choose — it changes the Terraform config (whether we
> include `digitalocean_record` resources or not).

---

## Step 1 — Decide nameservers

- **Option A:** at your registrar, set the domain's nameservers to DO's
  (`ns1.digitalocean.com`, `ns2.digitalocean.com`, `ns3.digitalocean.com`),
  then add the domain under DO → **Networking → Domains**. Terraform will create
  the records.
- **Option B:** leave nameservers as-is; you'll create the records in Step 2
  manually.

## Step 2 — A records (the four hostnames)

The app is served behind one DigitalOcean Load Balancer. All four hostnames
point at the **same LB IP** (you'll have this IP only *after* the LB is created
by Terraform in 0e — so this step is "plan now, fill the IP in later").

| Host | Purpose |
|---|---|
| `fountainrank.com` (apex / `@`) | web app |
| `www.fountainrank.com` | web app (redirect/canonical) |
| `api.fountainrank.com` | FastAPI backend |
| `auth.fountainrank.com` | **Logto** OIDC endpoint |

- **Option A:** Terraform creates these once the LB IP is known. Nothing to do
  by hand.
- **Option B:** after I tell you the LB IP, add four **A records** (or apex
  `ALIAS`/`ANAME` + three `A`/`CNAME`) pointing at it.

> The LB-managed Let's Encrypt SAN certificate covers all four names, so the
> records must resolve before the cert will issue.

## Step 3 — Email deliverability records (SPF, DKIM, DMARC)

Required so Logto's auth email (sent via the Gmail API — see
`03-google-cloud.md`) lands in inboxes and the domain can't be spoofed. These
are **TXT/CNAME records on `fountainrank.com`** and are independent of the LB.

1. **SPF** — a single TXT record at the apex authorizing Google to send:

   ```text
   v=spf1 include:_spf.google.com ~all
   ```

   (If you already have an SPF record, **merge** — do not add a second SPF TXT;
   multiple SPF records break SPF.)

2. **DKIM** — generated in the **Google Workspace Admin console** (Apps → Google
   Workspace → Gmail → **Authenticate email**). It gives you a host like
   `google._domainkey` and a long TXT value. Add exactly what the console shows,
   then click **Start authentication** in Workspace.

3. **DMARC** — a TXT record at `_dmarc.fountainrank.com`. Start in monitor mode
   so nothing breaks, then tighten once aligned:

   ```text
   v=DMARC1; p=none; rua=mailto:dmarc-reports@fountainrank.com; fo=1
   ```

   Move `p=none` → `p=quarantine` → `p=reject` after you've confirmed SPF+DKIM
   pass for your real mail (check the `rua` aggregate reports).

> **Verify** with a mail test (e.g. send to a checker, or use the Workspace
> "Authenticate email" status) — all three of SPF, DKIM, DMARC should pass
> before relying on magic-link email in Phase 2.

---

## Outputs to record

| Value | Becomes | Destination |
|---|---|---|
| Nameserver choice (A or B) | TF DNS on/off | tell me |
| Sending address (e.g. `noreply@fountainrank.com`) | `FROM_EMAIL` | GitHub Env **variable** + `03` |
| DKIM selector + status | deliverability | confirm to me when passing |
| DMARC policy stage (`none`/`quarantine`/`reject`) | deliverability | confirm to me |

**Hand me:** the nameserver option and the chosen `FROM_EMAIL`. None of these
are secrets.

---

## Security / correctness notes

- **One SPF record only.** Multiple SPF TXT records = SPF permerror.
- Keep DMARC at `p=none` until reports confirm alignment; jumping straight to
  `reject` can silently drop legitimate mail.
- DNS/DMARC changes can take up to 24–48h to fully propagate — start early.
