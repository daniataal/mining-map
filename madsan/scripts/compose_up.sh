#!/usr/bin/env bash
# Start full MadSan V2 stack in Docker (db, api, worker, scheduler, frontend).
# Usage:
#   ./madsan/scripts/compose_up.sh           # default stack
#   ./madsan/scripts/compose_up.sh --proxy # include Caddy on :9080
#   ./madsan/scripts/compose_up.sh madsan-db  # DB only (hybrid dev)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/docker-compose.yml"
ENV_FILE="$ROOT/deploy/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PROFILES=()
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--proxy" ]]; then
    PROFILES+=(--profile proxy)
    export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:9080}"
  else
    ARGS+=("$arg")
  fi
done

if [[ ${#ARGS[@]} -eq 0 ]]; then
  ARGS=(madsan-db madsan-api madsan-worker madsan-scheduler madsan-frontend)
fi

echo "==> MadSan compose: ${ARGS[*]} ${PROFILES[*]:-}"
docker compose -f "$COMPOSE_FILE" "${PROFILES[@]}" up -d --build "${ARGS[@]}"

echo ""
echo "Endpoints (host):"
echo "  API:      http://localhost:8088/health"
echo "  Frontend: http://localhost:3001"
echo "  Postgres: localhost:5433/madsan_db"
if [[ " ${PROFILES[*]} " == *" proxy "* ]]; then
  echo "  Caddy:    http://localhost:9080  (set NEXT_PUBLIC_API_URL=http://localhost:9080)"
fi
echo ""
echo "Logs: docker compose -f $COMPOSE_FILE logs -f madsan-api"
