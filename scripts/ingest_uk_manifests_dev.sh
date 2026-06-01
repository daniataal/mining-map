#!/usr/bin/env bash
# Dev helper: ingest UK open CSVs from data/uk_trade_manifests into trade_manifest_rows.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export UK_MANIFEST_CSV_DIR="${UK_MANIFEST_CSV_DIR:-$ROOT/data/uk_trade_manifests}"
export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-mining_db}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-password}"

if command -v docker >/dev/null 2>&1 && docker compose ps -q uk-trade-manifest-sync-worker 2>/dev/null | grep -q .; then
  echo "Running UK manifest ingest via uk-trade-manifest-sync-worker…"
  docker compose exec -T uk-trade-manifest-sync-worker python -c "
from uk_trade_manifest_sync_worker import run_once
import json
print(json.dumps(run_once(), default=str))
"
elif command -v docker >/dev/null 2>&1 && docker compose ps -q backend 2>/dev/null | grep -q .; then
  echo "Running UK manifest ingest via backend container…"
  docker compose exec -T backend python uk_trade_manifest_sync_worker.py 2>&1 | head -3 || true
  docker compose exec -T backend python -c "
from uk_trade_manifest_sync_worker import run_once
import json
print(json.dumps(run_once(), default=str))
"
else
  echo "Running UK manifest ingest locally (requires psycopg2 + backend on PYTHONPATH)…"
  PYTHONPATH="$ROOT" python3 -c "
from backend.uk_trade_manifest_sync_worker import run_once
import json
print(json.dumps(run_once(), default=str))
"
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
echo "Verify: curl -s \"$BASE_URL/api/oil-live/trade-manifests?bol_tier=customs_open&limit=3\""
