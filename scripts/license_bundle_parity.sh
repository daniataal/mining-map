#!/usr/bin/env bash
# Compare Go vs Python license bundle row counts (no bbox) for Historic sidebar parity.
# Usage: BASE_URL=http://127.0.0.1:8080 ./scripts/license_bundle_parity.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
LIMIT="${LIMIT:-15000}"
PREFER_OPEN="${PREFER_OPEN:-true}"

if [[ "${SMOKE_SKIP_IF_DOWN:-}" == "1" ]]; then
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/oil-live/health" 2>/dev/null || echo "000")
  if [[ "$code" != "200" ]]; then
    echo "SKIP: stack not reachable at $BASE_URL (SMOKE_SKIP_IF_DOWN=1, health=$code)"
    exit 0
  fi
fi

count_rows() {
  python3 -c "
import json, sys
d = json.load(sys.stdin)
if isinstance(d, list):
    print(len(d))
elif isinstance(d, dict) and 'clusters' in d:
    print(len(d.get('clusters', [])))
else:
    print(0)
"
}

fail=0
for sector in mining oil_and_gas; do
  qs="sector=${sector}&prefer_open_data=${PREFER_OPEN}&limit=${LIMIT}"
  go_json=$(curl -sS "$BASE_URL/api/oil-live/licenses?${qs}")
  py_json=$(curl -sS "$BASE_URL/licenses?${qs}")

  go_count=$(echo "$go_json" | count_rows)
  py_count=$(echo "$py_json" | count_rows)

  echo "sector=${sector}  Go rows: $go_count  Python rows: $py_count"

  if [[ "$go_count" != "$py_count" ]]; then
    echo "WARN: row counts differ for sector=${sector}" >&2
    fail=1
  fi
done

if [[ "$fail" -eq 0 ]]; then
  echo "PASS: bundle row counts match for mining and oil_and_gas"
  exit 0
fi

echo "Investigate Go ListLicenses / licensemap.QueryPoints before removing Python fallback" >&2
exit 1
