#!/usr/bin/env bash
# MadSan V2 — timestamped Postgres backup (never docker compose down -v)
#
# Default: madsan_db via compose service madsan-db (host localhost:5433)
# Legacy:  LEGACY=1 or --legacy → mining_db in container mining-db (host :5434)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MADSAN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$MADSAN_ROOT/deploy/docker-compose.yml"
# Standalone checkout (/opt/madsan): backups under repo root.
# Monorepo nested layout: set MADSAN_BACKUP_DIR to parent repo backups/ if needed.
BACKUP_DIR="${MADSAN_BACKUP_DIR:-${MADSAN_ROOT}/backups}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)

LEGACY="${LEGACY:-0}"
for arg in "$@"; do
  if [[ "$arg" == "--legacy" ]]; then
    LEGACY=1
  fi
done

if [[ "$LEGACY" == "1" ]]; then
  DB_NAME="mining_db"
  CONTAINER="${MADSAN_LEGACY_DB_CONTAINER:-mining-db}"
  OUT="${BACKUP_DIR}/mining_legacy_pre_${STAMP}.dump"
  TMP="/tmp/madsan_legacy_${STAMP}.dump"
  echo "Backing up legacy ${DB_NAME} (${CONTAINER}) to ${OUT}"
  docker exec "$CONTAINER" pg_dump -U postgres -d "$DB_NAME" -Fc -f "$TMP"
  docker cp "${CONTAINER}:${TMP}" "$OUT"
  docker exec "$CONTAINER" rm -f "$TMP"
else
  DB_NAME="madsan_db"
  OUT="${BACKUP_DIR}/madsan_v2_pre_${STAMP}.dump"
  echo "Backing up ${DB_NAME} (compose madsan-db, localhost:5433) to ${OUT}"
  docker compose -f "$COMPOSE_FILE" exec -T madsan-db \
    pg_dump -U postgres -d "$DB_NAME" -Fc -f "/tmp/madsan_${STAMP}.dump"
  CID="$(docker compose -f "$COMPOSE_FILE" ps -q madsan-db)"
  docker cp "${CID}:/tmp/madsan_${STAMP}.dump" "$OUT"
  docker compose -f "$COMPOSE_FILE" exec -T madsan-db rm -f "/tmp/madsan_${STAMP}.dump"
fi

echo "OK: $(ls -lh "$OUT")"
