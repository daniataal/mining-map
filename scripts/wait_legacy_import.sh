#!/usr/bin/env bash
# Poll a legacy_import ingestion job until terminal state, then run legacy-parity.
# Does NOT restart the worker — read-only wait + parity gate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MADSAN="$ROOT/madsan"
JOB_ID="${1:-${JOB_ID:-53774b3f-7257-4f75-a175-ae4e5e5d5446}}"
POLL_SEC="${POLL_SEC:-15}"
TIMEOUT_SEC="${TIMEOUT_SEC:-0}"

if [[ -f "$MADSAN/deploy/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$MADSAN/deploy/.env"
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable}"
export LEGACY_DATABASE_URL="${LEGACY_DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5434/mining_db?sslmode=disable}"

psql_query() {
  local sql="$1"
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -t -A -c "$sql" | tr -d '[:space:]'
    return
  fi
  local container=""
  for c in deploy-madsan-db-1 madsan-db; do
    if docker ps --format '{{.Names}}' | grep -qx "$c"; then
      container="$c"
      break
    fi
  done
  if [[ -z "$container" ]]; then
    container=$(docker ps --format '{{.Names}}' | grep -E 'madsan-db' | head -1 || true)
  fi
  if [[ -z "$container" ]]; then
    echo "ERROR: no psql and no madsan-db container found" >&2
    exit 2
  fi
  docker exec "$container" psql -U postgres -d madsan_db -t -A -c "$sql" | tr -d '[:space:]'
}

echo "==> wait_legacy_import: job=$JOB_ID poll=${POLL_SEC}s (no worker restart)"
started=$(date +%s)

while true; do
  status=$(psql_query "SELECT status FROM ingestion_jobs WHERE id='${JOB_ID}';")
  if [[ -z "$status" ]]; then
    echo "FAIL: job $JOB_ID not found in ingestion_jobs" >&2
    exit 1
  fi
  echo "    status=$status ($(date -u +%H:%M:%SZ))"
  case "$status" in
    completed|failed|cancelled) break ;;
  esac
  if [[ "$TIMEOUT_SEC" -gt 0 ]]; then
    now=$(date +%s)
    if (( now - started > TIMEOUT_SEC )); then
      echo "FAIL: timeout after ${TIMEOUT_SEC}s (job still $status)" >&2
      exit 1
    fi
  fi
  sleep "$POLL_SEC"
done

if [[ "$status" != "completed" ]]; then
  err=$(psql_query "SELECT COALESCE(error_message,'') FROM ingestion_jobs WHERE id='${JOB_ID}';")
  echo "FAIL: job ended with status=$status error=${err:-none}" >&2
  exit 1
fi

echo "==> legacy-parity (threshold ${MADSAN_PARITY_THRESHOLD_PCT:-5}%)"
cd "$MADSAN/backend"
if go run ./cmd/legacy-parity; then
  echo "PASS: legacy-parity green after job $JOB_ID completed"
  exit 0
else
  echo "FAIL: legacy-parity failed after job $JOB_ID completed" >&2
  exit 1
fi
