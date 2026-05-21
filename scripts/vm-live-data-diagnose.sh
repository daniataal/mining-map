#!/usr/bin/env bash
# Live Data / oil-live VM diagnostic — run on production host (default /opt/mining-map).
#
# Usage:
#   cd /opt/mining-map && ./scripts/vm-live-data-diagnose.sh
#   ./scripts/vm-live-data-diagnose.sh --dry-run          # skip graph-sync POST
#   MINING_MAP_ROOT=/other/path ./scripts/vm-live-data-diagnose.sh
#
# Checks compose services, health/sync-status (8095 / 8000 / 8080), backend.env secrets,
# OIL_INTEL_INTERNAL_KEY parity, optional graph-sync (600s), and Postgres row counts.

set -euo pipefail

ROOT="${MINING_MAP_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

COMPOSE_FILE="${MINING_MAP_COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")
if [[ -n "${MINING_MAP_SUDO:-}" ]]; then
  COMPOSE=(sudo docker compose -f "$COMPOSE_FILE")
fi

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

ENV_FILE="${MINING_MAP_ENV_FILE:-backend.env}"
PASS=0
FAIL=0
WARN=0

pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*"; FAIL=$((FAIL + 1)); }
warn() { echo "WARN: $*"; WARN=$((WARN + 1)); }

section() { echo ""; echo "=== $* ==="; }

curl_json() {
  local url="$1"
  local out="$2"
  local code
  code=$(curl -sS -o "$out" -w "%{http_code}" --connect-timeout 8 --max-time 30 "$url" 2>/dev/null || echo "000")
  echo "$code"
}

container_env() {
  local svc="$1"
  local key="$2"
  "${COMPOSE[@]}" exec -T "$svc" printenv "$key" 2>/dev/null | tr -d '\r' || true
}

section "Compose services ($COMPOSE_FILE)"
if "${COMPOSE[@]}" ps --status running 2>/dev/null | grep -qE 'backend|oil-live-intel'; then
  "${COMPOSE[@]}" ps backend oil-live-intel oil-live-graph-sync-worker maritime-worker caddy frontend 2>/dev/null || \
    "${COMPOSE[@]}" ps 2>/dev/null || true
else
  warn "docker compose ps failed or no running services — is the stack up?"
fi

for svc in backend oil-live-intel; do
  if "${COMPOSE[@]}" ps --status running "$svc" 2>/dev/null | grep -q "$svc"; then
    pass "$svc container running"
  else
    fail "$svc container not running"
  fi
done

if "${COMPOSE[@]}" ps --status running oil-live-graph-sync-worker 2>/dev/null | grep -q oil-live-graph-sync-worker; then
  pass "oil-live-graph-sync-worker running"
else
  warn "oil-live-graph-sync-worker not running (graph-sync only via admin POST or deploy hook)"
fi

if "${COMPOSE[@]}" ps --status running eia-historic-sync-worker 2>/dev/null | grep -q eia-historic-sync-worker; then
  pass "eia-historic-sync-worker running"
else
  warn "eia-historic-sync-worker not running (EIA impa ingest from data/eia_downloads)"
fi

if "${COMPOSE[@]}" ps --status running uk-trade-manifest-sync-worker 2>/dev/null | grep -q uk-trade-manifest-sync-worker; then
  pass "uk-trade-manifest-sync-worker running"
else
  warn "uk-trade-manifest-sync-worker not running (UK CSV → trade_manifest_rows)"
fi

eia_dir="${ROOT}/data/eia_downloads"
if [ -d "$eia_dir" ] && ls "$eia_dir"/impa*.xls "$eia_dir"/impa*.xlsx 2>/dev/null | head -1 | grep -q impa; then
  pass "data/eia_downloads has impa files ($(ls "$eia_dir"/impa* 2>/dev/null | wc -l | tr -d ' ') files)"
else
  warn "data/eia_downloads missing or no impa*.xls(x) — Historic tab stays empty"
fi

uk_dir="${ROOT}/data/uk_trade_manifests"
if [ -d "$uk_dir" ] && ls "$uk_dir"/*.csv 2>/dev/null | head -1 | grep -q '\.csv'; then
  pass "data/uk_trade_manifests has CSV ($(ls "$uk_dir"/*.csv 2>/dev/null | wc -l | tr -d ' ') files)"
else
  warn "data/uk_trade_manifests missing CSV — trade_manifest_rows UK ingest sparse"
fi

section "HTTP probes"
mkdir -p /tmp
for label_url in \
  "oil-live-intel:8095|http://127.0.0.1:8095/api/oil-live/health" \
  "oil-live-intel:8095|http://127.0.0.1:8095/api/oil-live/sync-status" \
  "backend:8000|http://127.0.0.1:8000/api/health" \
  "caddy:8080|http://127.0.0.1:8080/api/oil-live/health" \
  "caddy:8080|http://127.0.0.1:8080/api/oil-live/sync-status"; do
  label="${label_url%%|*}"
  url="${label_url#*|}"
  out="/tmp/mining-diag-$(echo "$label" | tr '/:' '_').json"
  code=$(curl_json "$url" "$out")
  if [[ "$code" == "200" ]] && [[ -s "$out" ]]; then
    pass "$label → HTTP $code"
    if [[ "$url" == *sync-status* ]]; then
      if command -v jq >/dev/null 2>&1; then
        jq -c '{terminal_count,port_call_count,cargo_record_count,last_graph_sync_at}' "$out" 2>/dev/null || cat "$out"
      else
        grep -E 'terminal_count|last_graph_sync' "$out" || true
      fi
    fi
  else
    fail "$label → HTTP ${code:-err} (empty or unreachable)"
  fi
done

# Backend :8000 does not serve /api/oil-live — browser must use :8080 (Caddy) or :5173 (frontend).
code_8000_oil=$(curl_json "http://127.0.0.1:8000/api/oil-live/health" /tmp/mining-diag-8000-oil.json)
if [[ "$code_8000_oil" != "200" ]]; then
  warn "backend:8000 does not proxy /api/oil-live (expected) — open UI at :8080 or :5173, not :8000 alone"
fi

section "backend.env ($ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  fail "$ENV_FILE missing"
else
  pass "$ENV_FILE present"
  for key in ADMIN_TOKEN OIL_INTEL_INTERNAL_KEY OIL_GRAPH_SYNC_ENABLED OIL_INTEL_API_URL AISSTREAM_API_KEY COMTRADE_API_KEY EIA_API_KEY OIL_LIVE_DISABLE_DEMO_SEED EIA_DOWNLOADS_DIR UK_MANIFEST_CSV_DIR STORAGE_SKIP_LIVE_OVERPASS; do
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
      val=$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2-)
      if [[ -n "$val" ]]; then
        echo "  ${key}=SET (len ${#val})"
      else
        echo "  ${key}=empty"
      fi
    else
      echo "  ${key}=not in file (compose defaults may apply)"
    fi
  done
  if grep -qE '^OIL_GRAPH_SYNC_ENABLED=(0|false|no|off)' "$ENV_FILE" 2>/dev/null; then
    warn "backend.env sets OIL_GRAPH_SYNC_ENABLED=false — docker-compose.prod.yml overrides to true on backend service"
  fi
fi

section "OIL_INTEL_INTERNAL_KEY parity (backend vs oil-live-intel)"
KEY_BACKEND=$(container_env backend OIL_INTEL_INTERNAL_KEY)
KEY_INTEL=$(container_env oil-live-intel OIL_INTEL_INTERNAL_KEY)
if [[ -z "$KEY_BACKEND" || -z "$KEY_INTEL" ]]; then
  fail "could not read OIL_INTEL_INTERNAL_KEY from one or both containers"
elif [[ "$KEY_BACKEND" == "$KEY_INTEL" ]]; then
  pass "OIL_INTEL_INTERNAL_KEY matches"
else
  fail "OIL_INTEL_INTERNAL_KEY mismatch (synthetic BOL rebuild will fail)"
fi

GRAPH_ENABLED=$(container_env backend OIL_GRAPH_SYNC_ENABLED)
if [[ -z "$GRAPH_ENABLED" || "$GRAPH_ENABLED" =~ ^(1|true|yes|on)$ ]]; then
  pass "backend OIL_GRAPH_SYNC_ENABLED=${GRAPH_ENABLED:-true}"
else
  fail "backend OIL_GRAPH_SYNC_ENABLED=$GRAPH_ENABLED"
fi

INTEL_URL=$(container_env backend OIL_INTEL_API_URL)
if [[ "$INTEL_URL" == *oil-live-intel* ]]; then
  pass "backend OIL_INTEL_API_URL=$INTEL_URL"
else
  warn "backend OIL_INTEL_API_URL=${INTEL_URL:-unset}"
fi

section "Postgres counts"
if "${COMPOSE[@]}" ps --status running db 2>/dev/null | grep -q db; then
  "${COMPOSE[@]}" exec -T db psql -U postgres -d mining_db -t -A -c \
    "SELECT 'oil_terminals', COUNT(*)::text FROM oil_terminals
     UNION ALL SELECT 'oil_companies', COUNT(*)::text FROM oil_companies
     UNION ALL SELECT 'meridian_cargo_records', COUNT(*)::text FROM meridian_cargo_records
     UNION ALL SELECT 'oil_port_calls', COUNT(*)::text FROM oil_port_calls
     UNION ALL SELECT 'eia_historic_imports', COUNT(*)::text FROM eia_historic_imports
     UNION ALL SELECT 'oil_trade_flows', COUNT(*)::text FROM oil_trade_flows
     UNION ALL SELECT 'trade_manifest_rows', COUNT(*)::text FROM trade_manifest_rows
     UNION ALL SELECT 'commodity_trade_flows', COUNT(*)::text FROM commodity_trade_flows;" 2>/dev/null | while IFS='|' read -r tbl cnt; do
    echo "  $tbl = $cnt"
  done || fail "psql query failed (migrations not applied?)"
  TERM_COUNT=$("${COMPOSE[@]}" exec -T db psql -U postgres -d mining_db -t -A -c "SELECT COUNT(*) FROM oil_terminals;" 2>/dev/null | tr -d '[:space:]' || echo "0")
  if [[ "${TERM_COUNT:-0}" -gt 100 ]]; then
    pass "oil_terminals count=$TERM_COUNT"
  elif [[ "${TERM_COUNT:-0}" -gt 0 ]]; then
    warn "oil_terminals count=$TERM_COUNT (sparse — run graph-sync)"
  else
    fail "oil_terminals count=0"
  fi
else
  fail "db container not running"
  TERM_COUNT=0
fi

GS_JSON=/tmp/gs.json
if [[ "$DRY_RUN" == 1 ]]; then
  section "Graph-sync (skipped — dry-run)"
  warn "Re-run without --dry-run to POST /api/admin/oil-live/graph-sync (up to 600s)"
else
  section "Graph-sync POST (600s timeout)"
  ADMIN_TOKEN=""
  if [[ -f "$ENV_FILE" ]]; then
    ADMIN_TOKEN=$(grep -E '^ADMIN_TOKEN=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r"'"'"' ')
  fi
  if [[ -z "$ADMIN_TOKEN" ]]; then
    fail "ADMIN_TOKEN not set in $ENV_FILE — cannot run graph-sync"
  elif ! "${COMPOSE[@]}" ps --status running backend 2>/dev/null | grep -q backend; then
    fail "backend not running — cannot run graph-sync"
  else
    echo "  POST http://127.0.0.1:8000/api/admin/oil-live/graph-sync (this may take several minutes)…"
    GS_CODE=$(curl -sS --max-time 600 -o "$GS_JSON" -w "%{http_code}" \
      -X POST "http://127.0.0.1:8000/api/admin/oil-live/graph-sync" \
      -H "X-Admin-Token: ${ADMIN_TOKEN}" \
      -H "Content-Type: application/json" 2>/dev/null || echo "000")
    echo "  graph-sync HTTP $GS_CODE → $GS_JSON"
    if [[ "$GS_CODE" == "403" ]]; then
      fail "graph-sync Forbidden — wrong X-Admin-Token (use ADMIN_TOKEN from backend.env, not a guess)"
    elif [[ "$GS_CODE" == "000" ]]; then
      fail "graph-sync timed out or connection failed — retry with curl --max-time 600"
    elif [[ "$GS_CODE" != "200" ]]; then
      fail "graph-sync HTTP $GS_CODE"
      head -c 500 "$GS_JSON" 2>/dev/null || true
      echo ""
    else
      pass "graph-sync HTTP 200"
      if command -v jq >/dev/null 2>&1; then
        jq '{status,reason,steps: {storage_terminals: .steps.storage_terminals, synthetic_bol: .synthetic_bol}}' "$GS_JSON" 2>/dev/null || true
        GS_STATUS=$(jq -r '.status // empty' "$GS_JSON" 2>/dev/null || true)
        ST_STATUS=$(jq -r '.steps.storage_terminals.status // empty' "$GS_JSON" 2>/dev/null || true)
        if [[ "$GS_STATUS" == "skipped" ]]; then
          fail "graph-sync skipped: $(jq -r '.reason // .message // "unknown"' "$GS_JSON")"
        elif [[ "$ST_STATUS" == "error" ]]; then
          fail "storage_terminals step error: $(jq -r '.steps.storage_terminals.error // empty' "$GS_JSON")"
        fi
      else
        grep -E '"status"|storage_terminals|terminals_imported' "$GS_JSON" | head -20 || true
      fi
    fi
    # Re-check sync-status after sync
    code=$(curl_json "http://127.0.0.1:8095/api/oil-live/sync-status" /tmp/mining-diag-sync-after.json)
    if [[ "$code" == "200" ]] && command -v jq >/dev/null 2>&1; then
      jq -c '{terminal_count,cargo_record_count,last_graph_sync_at}' /tmp/mining-diag-sync-after.json
    fi
    TERM_COUNT=$("${COMPOSE[@]}" exec -T db psql -U postgres -d mining_db -t -A -c "SELECT COUNT(*) FROM oil_terminals;" 2>/dev/null | tr -d '[:space:]' || echo "$TERM_COUNT")
  fi
fi

section "UI hints"
echo "  • Open app at http://<host>:8080 (Caddy) or :5173 (frontend) — not backend :8000 alone."
echo "  • If terminal_count > 0 but map empty: fly map to Persian Gulf / US Gulf (default view may be over ocean)."
echo "  • If terminal_count still 0: fix graph-sync / Overpass (STORAGE_SKIP_LIVE_OVERPASS=true) / oil-live-intel migrations."
echo "  • Worker logs: ${COMPOSE[*]} logs oil-live-graph-sync-worker --tail 80"
echo "  • EIA rsync from laptop: VM_HOST=user@host ./scripts/rsync-eia-downloads-to-vm.sh"
echo "  • Large VM RAM tuning: docker compose -f docker-compose.prod.yml -f docker-compose.prod.large-vm.yml up -d"

section "Summary"
echo "PASS=$PASS FAIL=$FAIL WARN=$WARN"
if [[ "$FAIL" -gt 0 ]]; then
  echo "OVERALL: FAIL — see FAIL lines above"
  exit 1
fi
if [[ "${TERM_COUNT:-0}" -gt 100 ]]; then
  echo "OVERALL: PASS — DB has terminals; if UI empty, check browser URL (:8080/:5173) and map viewport."
  exit 0
fi
echo "OVERALL: WARN — stack up but data sparse; run graph-sync or check worker logs."
exit 2
