# SEO Operations

Read this before SEO-agent, Search Console, GA4, Bing Webmaster, or SEO
measurement work for FountainRank. This is an operational spoke for
`docs/runbooks/seo.md`; that runbook remains the product SEO playbook.

## Local seo-agent identity

- seo-agent site name: `fountainrank`
- Active Codex MCP config dir: `/mnt/c/Users/aronw/.config/seo-agent`
- Registry file: `/mnt/c/Users/aronw/.config/seo-agent/sites.yaml`
- Google service account credential file:
  `/mnt/c/Users/aronw/.config/seo-agent/credentials/google-sa.json`
- Google service account email:
  `search-console-service-account@webpage-463304.iam.gserviceaccount.com`
- Google Cloud project ID for this service account: `webpage-463304`
- Google Cloud project number seen by GA4 Data API: `934545254138`
- GA4 property ID for FountainRank: `543842314`

The public GA4 Measurement ID in the web app (`G-BG3PYM6T43`) is not the value
seo-agent uses for reporting. seo-agent needs the numeric GA4 property ID above.

## gcloud project discipline

Do not rely on the active `gcloud` project. This machine is used with multiple
Google Cloud projects, and `gcloud config get-value project` may be empty or point
somewhere unrelated. Use explicit `--project=webpage-463304` for SEO-agent
Google API checks.

Useful read-only checks:

```bash
gcloud auth list
gcloud config get-value project
gcloud services list --enabled --project=webpage-463304 \
  --filter='config.name:(analyticsdata.googleapis.com OR searchconsole.googleapis.com OR analyticsadmin.googleapis.com)' \
  --format='table(config.name,title)'
```

Required APIs on `webpage-463304`:

- Google Search Console API: `searchconsole.googleapis.com`
- Google Analytics Data API: `analyticsdata.googleapis.com`
- Google Analytics Admin API: `analyticsadmin.googleapis.com`

The Data API is the one seo-agent uses for GA4 reporting. Enabling only the
Admin API is not enough.

## Verify provider health

The active Codex MCP process can cache the registry at startup. After changing
`sites.yaml`, prefer the CLI verification below or restart Codex/MCP before
trusting `seo_health_check`.

```bash
SEO_AGENT_CONFIG_DIR=/mnt/c/Users/aronw/.config/seo-agent \
UV_PROJECT_ENVIRONMENT="$HOME/.cache/seo-agent/codex-venv" \
uv run --python 3.13 --directory /mnt/d/repos/seo-agent \
  seo-mcp verify --site fountainrank --json
```

Expected provider state:

- `gsc`: `ok`
- `ga4`: `ok`
- `bing`: `ok`

The current local setup may also print credential permission warnings such as
`group/other-accessible`; those are file-permission hygiene warnings, not
provider failures.

## GA4 troubleshooting notes

If GA4 reports `auth_failed`, distinguish these cases:

- `SERVICE_DISABLED` for `analyticsdata.googleapis.com` means the Google
  Analytics Data API is disabled on `webpage-463304` / project number
  `934545254138`.
- Permission errors after the API is enabled usually mean the service account
  email above does not have access to GA4 property `543842314`.
- A noisy `Regional Access Boundary ... FAILED_PRECONDITION` message can appear
  during Google auth retries even when the GA4 Data API call ultimately succeeds.
  Treat the final seo-agent provider status as authoritative.

Do not print service account private keys, OAuth tokens, Bing API keys, or
`sites.yaml` contents. It is fine to print non-secret identity fields such as
`client_email`, `project_id`, and provider health statuses when needed.
