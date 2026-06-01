#!/usr/bin/env bash
# Automated Phase 1 engineering gates (product rows 1-9 still need manual browser pass).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"

echo "=== Phase 1 sign-off (automated) ==="

cd oil-live-intel
go test ./internal/api/... ./internal/services/licensemap/... ./internal/services/opportunity/... ./internal/services/ais/... ./internal/seed/...
cd "$ROOT/mining-viz"
npm run build

cd "$ROOT"
chmod +x scripts/platform_map_smoke.sh scripts/license_bundle_parity.sh scripts/license_map_parity.sh
BASE_URL="$BASE_URL" ./scripts/platform_map_smoke.sh
BASE_URL="$BASE_URL" ./scripts/license_bundle_parity.sh
BASE_URL="$BASE_URL" ./scripts/license_map_parity.sh

code="$(curl -s -o /dev/null -w '%{http_code}' \
  "$BASE_URL/api/oil-live/licenses/country-summary?min_lat=-60&max_lat=60&min_lng=-180&max_lng=180&limit=5")"
if [[ "$code" != "200" ]]; then
  echo "FAIL: country-summary HTTP $code (rebuild oil-live-intel if 405)"
  exit 1
fi
echo "OK: country-summary HTTP 200"

if command -v jq >/dev/null 2>&1; then
  curl -sf "$BASE_URL/api/oil-live/sync-status" | jq -e '.trade_manifest_row_count != null' >/dev/null
  curl -sf "$BASE_URL/api/oil-live/sync-status" | jq -e '.manifest_by_tier != null' >/dev/null
  echo "OK: sync-status manifest_by_tier present"
  curl -sf "$BASE_URL/api/oil-live/sync-status" | jq -e '(.watch_zone_observations_24h | type) == "array"' >/dev/null
  echo "OK: sync-status watch_zone_observations_24h present"
  n=$(curl -sf "$BASE_URL/api/oil-live/scenarios/hormuz_disruption_v1/digest" | jq '(.top_corridors | length) // 0')
  if [[ "${PHASE1_REQUIRE_HORMUZ_CORRIDORS:-}" == "1" && "$n" -lt 1 ]]; then
    echo "FAIL: hormuz top_corridors empty — run ./scripts/seed_hormuz_crisis_demo.sh"
    exit 1
  fi
  if [[ "$n" -ge 1 ]]; then
    echo "OK: hormuz digest top_corridors count=$n"
  else
    echo "WARN: hormuz top_corridors empty (dev: ./scripts/seed_hormuz_crisis_demo.sh)"
  fi
fi

if [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
  "$ROOT/backend/.venv/bin/python" -m pytest "$ROOT/backend/tests/test_trade_manifest_ingest.py" -q
  echo "OK: trade manifest ingest tests"
fi

echo "=== Automated Phase 1 gates passed ==="
echo "Manual: docs/PHASE1_BROWSER_CHECKLIST.md on $BASE_URL"
