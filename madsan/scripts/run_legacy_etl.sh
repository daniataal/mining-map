#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable}"

echo "==> Ensure legacy mining-db is up (port 5434 for host ETL)"
docker compose -f "$REPO/docker-compose.yml" -f "$ROOT/deploy/legacy-db-bridge.yml" up -d db

echo "==> Waiting for mining-db"
for i in $(seq 1 20); do
  docker exec mining-db pg_isready -U postgres -d mining_db >/dev/null 2>&1 && break
  sleep 2
done

export LEGACY_DATABASE_URL="${LEGACY_DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5434/mining_db}"

VENV="$ROOT/etl/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q psycopg2-binary
fi

echo "==> Enqueue legacy ETL jobs (set ETL_TABLES=oil_vessels to limit scope)"
"$VENV/bin/python" "$ROOT/etl/archive/legacy_import.py"

echo "==> Process jobs (run worker in another terminal, or):"
echo "  cd $ROOT/backend && DATABASE_URL='$DATABASE_URL' go run ./cmd/worker"
