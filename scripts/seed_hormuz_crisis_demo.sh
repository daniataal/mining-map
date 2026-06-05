#!/usr/bin/env bash
# Populate demo MCR corridors for Crisis desk (hormuz_disruption_v1 top_corridors).
# Works when OIL_LIVE_DISABLE_DEMO_SEED=1 — uses SQL, not Go demo seed gate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$ROOT/scripts/sql/seed_hormuz_crisis_demo.sql"

if docker compose ps db 2>/dev/null | grep -qE 'running|Up'; then
  echo "Applying Hormuz crisis demo MCR via db container…"
  docker compose exec -T db psql -U postgres -d mining_db -v ON_ERROR_STOP=1 <"$SQL"
else
  export PGPASSWORD="${DB_PASSWORD:-password}"
  psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}" \
    -d "${DB_NAME:-mining_db}" -v ON_ERROR_STOP=1 -f "$SQL"
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  n=$(curl -s "$BASE_URL/api/oil-live/scenarios/hormuz_disruption_v1/digest" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('top_corridors') or []))")
  echo "top_corridors count: $n"
fi
