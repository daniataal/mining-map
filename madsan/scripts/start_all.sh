#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable}"

DEPLOY_ENV="$ROOT/deploy/.env"
if [[ -f "$DEPLOY_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV"
  set +a
fi

echo "==> madsan-db"
docker compose -f "$ROOT/deploy/docker-compose.yml" up -d madsan-db

echo "==> API :8088"
"$ROOT/scripts/start_api.sh" &
sleep 2

echo "==> Worker (ingestion)"
export MADSAN_RAW_DIR="${MADSAN_RAW_DIR:-$ROOT/raw}"
(cd "$ROOT/backend" && DATABASE_URL="$DATABASE_URL" MADSAN_RAW_DIR="$MADSAN_RAW_DIR" go run ./cmd/worker) &
sleep 1

echo "==> Scheduler"
(cd "$ROOT/backend" && DATABASE_URL="$DATABASE_URL" go run ./cmd/scheduler) &
sleep 1

echo "==> Frontend :3000 (run in foreground)"
cd "$ROOT/frontend" && npm run dev
