#!/usr/bin/env bash
# Legacy mining-map production compose — NOT MadSan.
#
# Usage (from repo root):
#   ./scripts/mining_map_compose.sh -f docker-compose.prod.yml up -d
#   ./scripts/mining_map_compose.sh -f docker-compose.prod.yml -f docker-compose.prod.app.yml --profile ingest up -d
#
# Forces project name "mining-map" even when COMPOSE_PROJECT_NAME=madsan is exported.
# MadSan prod: ./madsan/scripts/compose_prod.sh --profile proxy up -d
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

exec docker compose -p mining-map "$@"
