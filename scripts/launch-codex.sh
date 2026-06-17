#!/usr/bin/env bash
# Launch Codex for FountainRank with the local Postgres connection exported.
# Usage: ./scripts/launch-codex.sh [codex args...]
set -euo pipefail

# Local dev Postgres (see docker-compose.yml, added in plan 0d). Override as needed.
export CODEX_POSTGRES_URL="${CODEX_POSTGRES_URL:-postgresql://fountainrank:fountainrank_dev@localhost:5436/fountainrank}"

# cd to repo root (this script lives in scripts/)
cd "$(dirname "$0")/.."

exec codex "$@"
