#!/usr/bin/env bash
# Stop MadSan stack without removing volumes (never use down -v in production).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
docker compose -f "$ROOT/deploy/docker-compose.yml" --profile proxy down
echo "Stopped. Data volume madsan_postgres_data preserved."
