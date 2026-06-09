#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable}"
cd "$ROOT/backend"
exec go run ./cmd/scheduler
