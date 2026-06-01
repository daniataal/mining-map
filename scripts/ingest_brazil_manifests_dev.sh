#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export BRAZIL_MANIFEST_CSV_DIR="${BRAZIL_MANIFEST_CSV_DIR:-$ROOT/data/brazil_trade_manifests}"
export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-mining_db}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-password}"

echo "Brazil manifest ingest from $BRAZIL_MANIFEST_CSV_DIR"
PYTHONPATH="$ROOT" python3 -c "
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
