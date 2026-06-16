#!/usr/bin/env bash
# MadSan production compose — the ONLY supported entry point for prod VM stack.
#
# Brings up: madsan-db, madsan-api, madsan-worker, madsan-scheduler, madsan-frontend,
# caddy (--profile proxy), optional madsan-ais-ingest (--profile ais when AISSTREAM_API_KEY set).
#
# Usage (from repo root or madsan/):
#   ./madsan/scripts/compose_prod.sh --profile proxy up -d
#   ./madsan/scripts/compose_prod.sh --profile proxy --profile ais pull
#   IMAGE_TAG=v42 ./madsan/scripts/compose_prod.sh --profile proxy up -d --remove-orphans
#
# DO NOT run root mining-map compose with COMPOSE_PROJECT_NAME=madsan:
#   WRONG: COMPOSE_PROJECT_NAME=madsan docker compose -f docker-compose.prod.yml up -d
#   WRONG: cd /opt/madsan && docker compose up -d --build   (uses repo-root legacy stack)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MADSAN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="$MADSAN_ROOT/deploy"
ENV_FILE="$DEPLOY_DIR/.env"

if [[ ! -f "$DEPLOY_DIR/docker-compose.yml" ]] || [[ ! -f "$DEPLOY_DIR/docker-compose.prod.yml" ]]; then
  echo "ERROR: MadSan deploy compose not found under $DEPLOY_DIR" >&2
  exit 1
fi

# Reject accidental root/mining-map compose file arguments.
for arg in "$@"; do
  case "$arg" in
    docker-compose.yml|docker-compose.prod.yml|./docker-compose.yml|./docker-compose.prod.yml)
      echo "ERROR: Refusing repo-root mining-map compose for MadSan prod." >&2
      echo "  Use: $0 --profile proxy up -d" >&2
      echo "  See: madsan/deploy/DEPLOY.md" >&2
      exit 1
      ;;
    -f)
      echo "ERROR: Do not pass -f to compose_prod.sh (paths are fixed to madsan/deploy)." >&2
      exit 1
      ;;
  esac
done

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

cd "$DEPLOY_DIR"

COMPOSE=(docker compose -p madsan -f docker-compose.yml -f docker-compose.prod.yml)

ARGS=("$@")
if [[ -n "${AISSTREAM_API_KEY:-}" ]]; then
  ais_profile_set=false
  i=0
  while (( i < ${#ARGS[@]} )); do
    if [[ "${ARGS[i]}" == "--profile" ]] && [[ "${ARGS[i+1]:-}" == "ais" ]]; then
      ais_profile_set=true
      break
    fi
    ((i++)) || true
  done
  if [[ "$ais_profile_set" == "false" ]]; then
    ARGS=(--profile ais "${ARGS[@]}")
  fi
fi

exec "${COMPOSE[@]}" "${ARGS[@]}"
