#!/usr/bin/env bash
# Compare Go vs Python license cluster counts on the same bbox (MAD-42 parity).
# For no-bbox bundle rows (Historic sidebar), use scripts/license_bundle_parity.sh.
# Usage: BASE_URL=http://127.0.0.1:8080 ./scripts/license_map_parity.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
MIN_LAT="${MIN_LAT:--35}"
MAX_LAT="${MAX_LAT:-35}"
MIN_LNG="${MIN_LNG:--20}"
MAX_LNG="${MAX_LNG:-55}"
ZOOM="${ZOOM:-4}"
LIMIT="${LIMIT:-120}"

qs="min_lat=$MIN_LAT&max_lat=$MAX_LAT&min_lng=$MIN_LNG&max_lng=$MAX_LNG&zoom=$ZOOM&limit=$LIMIT"

go_json=$(curl -sS "$BASE_URL/api/oil-live/licenses/map?$qs")
py_json=$(curl -sS "$BASE_URL/licenses?$qs&map=1")

go_count=$(echo "$go_json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('clusters',[])))")
py_count=$(echo "$py_json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('clusters',[])) if isinstance(d,dict) else len(d))")

echo "Go clusters:     $go_count"
echo "Python clusters: $py_count"

if [[ "$go_count" == "$py_count" ]]; then
  echo "PASS: cluster counts match"
  exit 0
fi

echo "WARN: cluster counts differ (investigate before removing Python fallback)" >&2
exit 1
