#!/usr/bin/env bash
# One-shot VM ingest — cron-friendly graph-sync POST or temporary compose ingest profile.
#
# Usage:
#   cd /opt/mining-map && ./scripts/vm-ingest-sync.sh graph-sync
#   ./scripts/vm-ingest-sync.sh compose-ingest --wait 7200
#   ./scripts/vm-ingest-sync.sh license-sync
#   VM_INGEST_SYNC_MODE=curl ./scripts/vm-ingest-sync.sh
#
# Env:
#   MINING_MAP_ROOT          repo root (default: parent of scripts/)
#   MINING_MAP_COMPOSE_FILES space-separated -f flags (see defaults below)
#   MINING_MAP_ENV_FILE      backend.env path
#   VM_INGEST_WAIT_SECONDS   compose-ingest wait before stop (default 7200)
#   VM_INGEST_GRAPH_TIMEOUT  curl max-time for graph-sync (default 600)

set -euo pipefail

ROOT="${MINING_MAP_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

COMPOSE_FILES="${MINING_MAP_COMPOSE_FILES:-docker-compose.prod.yml docker-compose.prod.app.yml}"
COMPOSE=(docker compose)
for f in $COMPOSE_FILES; do
  COMPOSE+=(-f "$f")
done
if [[ -n "${MINING_MAP_SUDO:-}" ]]; then
  COMPOSE=(sudo "${COMPOSE[@]}")
fi

ENV_FILE="${MINING_MAP_ENV_FILE:-backend.env}"
MODE="${VM_INGEST_SYNC_MODE:-graph-sync}"
WAIT_SECONDS="${VM_INGEST_WAIT_SECONDS:-7200}"
GRAPH_TIMEOUT="${VM_INGEST_GRAPH_TIMEOUT:-600}"
GRAPH_SYNC_URL="${VM_GRAPH_SYNC_URL:-http://127.0.0.1:${MINING_MAP_CADDY_PORT:-8080}/api/admin/oil-live/graph-sync}"
LOG_TAG="[vm-ingest-sync]"

INGEST_WORKERS=(
  license-sync-worker
  comtrade-sync-worker
  ted-procurement-worker
  gov-procurement-sync-worker
  oil-live-graph-sync-worker
  uk-trade-manifest-sync-worker
  eia-historic-sync-worker
  oil-live-search-indexer
)

usage() {
  sed -n '2,14p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    graph-sync|curl|compose-ingest|license-sync) MODE="$1"; shift ;;
    --wait)
      WAIT_SECONDS="${2:?--wait requires seconds}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "$LOG_TAG unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

admin_token() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "$LOG_TAG missing $ENV_FILE — cannot POST graph-sync" >&2
    return 1
  fi
  grep -E '^ADMIN_TOKEN=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r"'"'"' '
}

run_graph_sync_curl() {
  local token
  token="$(admin_token)" || exit 1
  if [[ -z "$token" ]]; then
    echo "$LOG_TAG ADMIN_TOKEN empty in $ENV_FILE" >&2
    exit 1
  fi
  local out="/tmp/vm-ingest-graph-sync-$$.json"
  echo "$LOG_TAG POST ${GRAPH_SYNC_URL} (timeout ${GRAPH_TIMEOUT}s)…"
  local code
  code=$(curl -sS --max-time "$GRAPH_TIMEOUT" -o "$out" -w "%{http_code}" \
    -X POST "${GRAPH_SYNC_URL}" \
    -H "X-Admin-Token: ${token}" \
    -H "Content-Type: application/json" 2>/dev/null || echo "000")
  echo "$LOG_TAG graph-sync HTTP $code → $out"
  if [[ "$code" != "200" ]]; then
    head -c 800 "$out" 2>/dev/null || true
    echo ""
    exit 1
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -c '{status,reason,terminal_count: .steps.storage_terminals.terminals_imported}' "$out" 2>/dev/null || true
  fi
}

stop_ingest_workers() {
  echo "$LOG_TAG stopping ingest workers…"
  "${COMPOSE[@]}" stop "${INGEST_WORKERS[@]}" 2>/dev/null || true
}

run_compose_ingest() {
  local workers=("${INGEST_WORKERS[@]}")
  if [[ "$MODE" == "license-sync" ]]; then
    workers=(license-sync-worker)
  fi
  echo "$LOG_TAG starting compose profile ingest (${workers[*]})…"
  "${COMPOSE[@]}" --profile ingest up -d "${workers[@]}"
  echo "$LOG_TAG waiting ${WAIT_SECONDS}s (or until manual stop)…"
  sleep "$WAIT_SECONDS"
  "${COMPOSE[@]}" stop "${workers[@]}"
  echo "$LOG_TAG compose ingest window complete"
}

case "$MODE" in
  graph-sync|curl)
    run_graph_sync_curl
    ;;
  compose-ingest)
    run_compose_ingest
    ;;
  license-sync)
    WAIT_SECONDS="${VM_INGEST_LICENSE_WAIT_SECONDS:-3600}"
    run_compose_ingest
    ;;
  *)
    echo "$LOG_TAG unknown mode: $MODE (use graph-sync, compose-ingest, license-sync)" >&2
    exit 2
    ;;
esac

echo "$LOG_TAG done"
