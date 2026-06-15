#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable}"
export MADSAN_API_ADDR="${MADSAN_API_ADDR:-:8088}"
export MADSAN_RUN_MIGRATIONS="${MADSAN_RUN_MIGRATIONS:-false}"

# Preserve MADSAN_AIS_SYNC from caller (e.g. MADSAN_AIS_SYNC=false) over deploy/.env
__caller_madsan_ais_sync="${MADSAN_AIS_SYNC-}"

DEPLOY_ENV="$ROOT/deploy/.env"
if [[ -f "$DEPLOY_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV"
  set +a
fi

if [[ -n "${__caller_madsan_ais_sync}" ]]; then
  export MADSAN_AIS_SYNC="${__caller_madsan_ais_sync}"
fi

if lsof -ti :8088 >/dev/null 2>&1; then
  echo "Stopping existing process on :8088"
  lsof -ti :8088 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

cd "$ROOT/backend"
go build -o /tmp/madsan-api ./cmd/api
exec /tmp/madsan-api
