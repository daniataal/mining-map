#!/usr/bin/env bash
# Start full MadSan V2 stack in Docker (db, api, worker, scheduler, frontend).
# Usage:
#   ./madsan/scripts/compose_up.sh           # default stack
#   ./madsan/scripts/compose_up.sh --proxy  # include Caddy on :9080
#   ./madsan/scripts/compose_up.sh --ais    # include live AIS ingest (auto if AISSTREAM_API_KEY set)
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
  case "$arg" in
    --proxy)
      PROFILES+=(--profile proxy)
      export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:9080}"
      ;;
    --ais)
      PROFILES+=(--profile ais)
      ;;
    *)
      ARGS+=("$arg")
      ;;
  esac
done

# Auto-start live AIS ingest when key is in deploy/.env (override with explicit service list).
if [[ -n "${AISSTREAM_API_KEY:-}" ]] && [[ " ${PROFILES[*]:-} " != *" ais "* ]]; then
  PROFILES+=(--profile ais)
fi

if [[ ${#ARGS[@]} -eq 0 ]]; then
  ARGS=(madsan-db madsan-api madsan-worker madsan-scheduler madsan-frontend)
  if [[ " ${PROFILES[*]:-} " == *" ais "* ]]; then
    ARGS+=(madsan-ais-ingest)
  fi
fi

PROFILE_ARGS=()
if ((${#PROFILES[@]} > 0)); then
  PROFILE_ARGS=("${PROFILES[@]}")
fi

echo "==> MadSan compose: ${ARGS[*]} ${PROFILE_ARGS[*]:-}"
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --build "${ARGS[@]}"

echo ""
echo "Endpoints (host):"
echo "  API:      http://localhost:8088/health"
echo "  Frontend: http://localhost:3001"
echo "  Postgres: localhost:5433/madsan_db"
if [[ " ${PROFILE_ARGS[*]:-} " == *" proxy "* ]]; then
  echo "  Caddy:    http://localhost:9080  (set NEXT_PUBLIC_API_URL=http://localhost:9080)"
fi
echo ""
echo "Logs: docker compose -f $COMPOSE_FILE logs -f madsan-api"
