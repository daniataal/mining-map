#!/usr/bin/env bash
# Dev helper: ingest Brazil open CSVs from data/brazil_trade_manifests into trade_manifest_rows.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export BRAZIL_MANIFEST_CSV_DIR="${BRAZIL_MANIFEST_CSV_DIR:-$ROOT/data/brazil_trade_manifests}"
export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-mining_db}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-password}"

echo "Brazil manifest ingest from $BRAZIL_MANIFEST_CSV_DIR"

_run_py() {
  python3 -c "
from backend.services.trade_manifest_ingest import sync_brazil_open_trade_rows
import psycopg2, os, json
conn = psycopg2.connect(
    host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
    dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
    password=os.environ['DB_PASSWORD'],
)
try:
    print(json.dumps(sync_brazil_open_trade_rows(conn), default=str))
    conn.commit()
finally:
    conn.close()
"
}

if command -v docker >/dev/null 2>&1 && docker compose ps -q oil-live-graph-sync-worker 2>/dev/null | grep -q .; then
  echo "Running Brazil manifest ingest via oil-live-graph-sync-worker…"
  docker compose exec -T oil-live-graph-sync-worker python -c "
from services.trade_manifest_ingest import sync_brazil_open_trade_rows
import psycopg2, os, json
conn = psycopg2.connect(
    host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
    dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
    password=os.environ['DB_PASSWORD'],
)
try:
    print(json.dumps(sync_brazil_open_trade_rows(conn), default=str))
    conn.commit()
finally:
    conn.close()
"
elif command -v docker >/dev/null 2>&1 && docker compose ps -q backend 2>/dev/null | grep -q .; then
  echo "Running Brazil manifest ingest via backend container…"
  docker compose exec -T \
    -e BRAZIL_MANIFEST_CSV_DIR=/data/brazil_trade_manifests \
    -v "$BRAZIL_MANIFEST_CSV_DIR:/data/brazil_trade_manifests:ro" \
    backend python -c "
from services.trade_manifest_ingest import sync_brazil_open_trade_rows
import psycopg2, os, json
conn = psycopg2.connect(
    host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
    dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
    password=os.environ['DB_PASSWORD'],
)
try:
    print(json.dumps(sync_brazil_open_trade_rows(conn), default=str))
    conn.commit()
finally:
    conn.close()
"
else
  echo "Running Brazil manifest ingest locally (requires psycopg2 + backend on PYTHONPATH)…"
  PYTHONPATH="$ROOT" _run_py
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
echo "Verify: curl -s \"$BASE_URL/api/oil-live/trade-manifests?bol_tier=customs_open&limit=5\""
