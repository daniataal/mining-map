#!/usr/bin/env bash
# MadSan V2 — timestamped Postgres backup (never docker compose down -v)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${ROOT}/backups"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
OUT="${BACKUP_DIR}/madsan_v2_pre_${STAMP}.dump"
CONTAINER="${MADSAN_DB_CONTAINER:-mining-db}"

echo "Backing up mining_db to ${OUT}"
docker exec "$CONTAINER" pg_dump -U postgres -d mining_db -Fc -f "/tmp/madsan_${STAMP}.dump"
docker cp "${CONTAINER}:/tmp/madsan_${STAMP}.dump" "$OUT"
docker exec "$CONTAINER" rm -f "/tmp/madsan_${STAMP}.dump"
echo "OK: $(ls -lh "$OUT")"
