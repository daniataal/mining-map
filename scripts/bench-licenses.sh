#!/usr/bin/env bash
# Benchmark GET /licenses (same path the UI uses). Compare row counts vs time.
# Usage:
#   ./scripts/bench-licenses.sh
#   ./scripts/bench-licenses.sh http://127.0.0.1:8000
# From repo root with docker compose:
#   docker compose up -d db backend && ./scripts/bench-licenses.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE="${1:-http://localhost:8000}"
BASE="${BASE%/}"

echo "== mining rows in Postgres (docker compose service: db) =="
if docker compose ps -q db 2>/dev/null | grep -q .; then
  docker compose exec -T db psql -U postgres -d mining_db -c \
    "SELECT COUNT(*) AS mining_licenses FROM licenses WHERE COALESCE(sector,'mining') = 'mining';"
  docker compose exec -T db psql -U postgres -d mining_db -c \
    "SELECT record_origin, COUNT(*) FROM licenses WHERE COALESCE(sector,'mining') = 'mining' GROUP BY 1 ORDER BY 2 DESC LIMIT 8;"
else
  echo "(No local 'db' container — start stack from repo root or set counts manually.)"
fi

echo ""
echo "== Timing ${BASE}/licenses?prefer_open_data=true&sector=mining (max 300s) =="
rm -f /tmp/bench-licenses.json
curl -sS -o /tmp/bench-licenses.json -w "http_code=%{http_code} size_bytes=%{size_download} time_total_sec=%{time_total}\n" \
  --max-time 300 "${BASE}/licenses?prefer_open_data=true&sector=mining" || true
if [[ -f /tmp/bench-licenses.json ]]; then
  wc -c /tmp/bench-licenses.json | awk '{print "saved_bytes:", $1}'
fi
