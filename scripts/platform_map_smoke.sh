#!/usr/bin/env bash
# Platform map routing smoke — run against Caddy :8080 (or BASE_URL).
# Usage: BASE_URL=http://127.0.0.1:8080 ./scripts/platform_map_smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
BBOX="min_lat=-10&max_lat=10&min_lng=-10&max_lng=10"

if [[ "${SMOKE_SKIP_IF_DOWN:-}" == "1" ]]; then
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/oil-live/health" 2>/dev/null || echo "000")
  if [[ "$code" != "200" ]]; then
    echo "SKIP: stack not reachable at $BASE_URL (SMOKE_SKIP_IF_DOWN=1, health=$code)"
    exit 0
  fi
fi

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

curl_json() {
  local url="$1"
  local code
  code=$(curl -sS -o /tmp/platform_smoke_body.json -w "%{http_code}" "$url") || fail "curl $url"
  echo "$code"
}

echo "=== Platform map smoke (BASE_URL=$BASE_URL) ==="

code=$(curl_json "$BASE_URL/api/oil-live/sync-status")
[[ "$code" == "200" ]] || fail "sync-status HTTP $code"
grep -q terminal_count /tmp/platform_smoke_body.json || fail "sync-status missing terminal_count"
if grep -q graph_sync_steps /tmp/platform_smoke_body.json; then
  ok "sync-status includes graph_sync_steps field"
else
  ok "sync-status (graph_sync_steps optional when no steps recorded yet)"
fi

code=$(curl_json "$BASE_URL/api/oil-live/licenses/map?$BBOX&zoom=4&limit=50")
[[ "$code" == "200" ]] || fail "licenses/map HTTP $code"
grep -q '"mode":"clusters"' /tmp/platform_smoke_body.json || fail "licenses/map not cluster mode"

code=$(curl_json "$BASE_URL/api/oil-live/licenses?$BBOX&zoom=9&limit=50&map=1")
[[ "$code" == "200" ]] || fail "licenses point mode HTTP $code"

code=$(curl_json "$BASE_URL/api/maritime/vessels?limit=5")
[[ "$code" == "200" ]] || fail "maritime/vessels HTTP $code"

code=$(curl_json "$BASE_URL/api/petroleum/osm-layers")
[[ "$code" == "200" ]] || fail "petroleum osm catalog HTTP $code"

code=$(curl_json "$BASE_URL/api/oil-live/scenarios")
[[ "$code" == "200" ]] || fail "scenarios HTTP $code"
grep -q '"scenarios"' /tmp/platform_smoke_body.json || fail "scenarios missing scenarios array"

code=$(curl_json "$BASE_URL/api/oil-live/scenarios/hormuz_disruption_v1/digest")
[[ "$code" == "200" ]] || fail "scenario digest HTTP $code"
grep -q '"top_corridors"' /tmp/platform_smoke_body.json || fail "scenario digest missing top_corridors"
ok "scenario digest includes top_corridors"

code=$(curl_json "$BASE_URL/api/oil-live/corridors/delta?window_days=30&limit=5")
[[ "$code" == "200" ]] || fail "corridors/delta HTTP $code"

code=$(curl_json "$BASE_URL/api/oil-live/search?q=test&limit=3")
if [[ "$code" == "200" ]]; then
  ok "search HTTP 200 (Elasticsearch up)"
elif [[ "$code" == "503" ]]; then
  ok "search HTTP 503 (Elasticsearch down — PG fallback expected in UI)"
else
  fail "search unexpected HTTP $code"
fi

echo "=== All platform map smoke checks passed ==="
