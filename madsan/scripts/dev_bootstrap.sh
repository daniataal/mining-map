#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable}"
export MADSAN_RAW_DIR="${MADSAN_RAW_DIR:-$ROOT/raw}"

echo "==> Starting madsan-db"
docker compose -f "$ROOT/deploy/docker-compose.yml" up -d madsan-db

echo "==> Waiting for Postgres"
for i in $(seq 1 30); do
  if docker compose -f "$ROOT/deploy/docker-compose.yml" exec -T madsan-db pg_isready -U postgres -d madsan_db >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> Running migrations"
(cd "$ROOT/backend" && DATABASE_URL="$DATABASE_URL" go run ./cmd/migrate)

echo "==> Linking bunker supplier seed"
mkdir -p "$MADSAN_RAW_DIR"
ln -sf "$ROOT/../data/bunker_fuel_suppliers_seed.json" "$MADSAN_RAW_DIR/bunker_fuel_suppliers_seed.json"

echo "==> Enqueue bunker seed ingest job"
docker compose -f "$ROOT/deploy/docker-compose.yml" exec -T madsan-db psql -U postgres -d madsan_db -c \
  "INSERT INTO ingestion_jobs (job_type, source_slug, status, payload, scheduled_at)
   VALUES ('bunker_seed', 'bunker_fuel_suppliers', 'pending', '{}'::jsonb, now());" 2>/dev/null || \
psql "$DATABASE_URL" -c \
  "INSERT INTO ingestion_jobs (job_type, source_slug, status, payload, scheduled_at)
   VALUES ('bunker_seed', 'bunker_fuel_suppliers', 'pending', '{}'::jsonb, now());"

echo "Bootstrap complete. Run:"
echo "  export DATABASE_URL='$DATABASE_URL'"
echo "  cd $ROOT/backend && go run ./cmd/worker   # process ingest"
echo "  cd $ROOT/backend && go run ./cmd/api        # API on :8080"
echo "  cd $ROOT/frontend && npm run dev            # UI on :3000"
