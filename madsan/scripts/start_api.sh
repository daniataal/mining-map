#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable}"
export MADSAN_API_ADDR="${MADSAN_API_ADDR:-:8088}"
export MADSAN_RUN_MIGRATIONS="${MADSAN_RUN_MIGRATIONS:-false}"

if lsof -ti :8088 >/dev/null 2>&1; then
  echo "Stopping existing process on :8088"
  lsof -ti :8088 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

cd "$ROOT/backend"
go build -o /tmp/madsan-api ./cmd/api
exec env DATABASE_URL="$DATABASE_URL" MADSAN_API_ADDR="$MADSAN_API_ADDR" MADSAN_RUN_MIGRATIONS="$MADSAN_RUN_MIGRATIONS" /tmp/madsan-api
