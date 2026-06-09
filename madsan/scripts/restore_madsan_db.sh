#!/usr/bin/env bash
# MadSan V2 — restore drill (dry-run by default; never overwrites madsan_db without FORCE=1)
#
# Default target: madsan_db_restore_test (side database for RTO/RPO drills)
# Production madsan_db requires FORCE=1 and TARGET_DB=madsan_db
#
# Usage:
#   ./restore_madsan_db.sh                          # dry-run, latest dump → restore_test
#   ./restore_madsan_db.sh backups/madsan_v2_pre_*.dump
#   DRY_RUN=0 ./restore_madsan_db.sh                # execute drill restore
#   DRY_RUN=0 FORCE=1 TARGET_DB=madsan_db ./restore_madsan_db.sh  # prod overwrite (danger)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MADSAN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MADSAN_ROOT/.." && pwd)"
COMPOSE_FILE="$MADSAN_ROOT/deploy/docker-compose.yml"
BACKUP_DIR="${REPO_ROOT}/backups"

PROD_DB="madsan_db"
DRY_RUN="${DRY_RUN:-1}"
FORCE="${FORCE:-0}"
TARGET_DB="${TARGET_DB:-madsan_db_restore_test}"

DUMP="${1:-}"

if [[ -z "$DUMP" ]]; then
  shopt -s nullglob
  candidates=("$BACKUP_DIR"/madsan_v2_pre_*.dump)
  shopt -u nullglob
  if ((${#candidates[@]} == 0)); then
    echo "ERROR: no madsan_v2_pre_*.dump in ${BACKUP_DIR}; pass dump path or run backup_db.sh" >&2
    exit 1
  fi
  DUMP="$(ls -t "${candidates[@]}" | head -1)"
fi

if [[ ! -f "$DUMP" ]]; then
  echo "ERROR: dump not found: $DUMP" >&2
  exit 1
fi

if [[ "$TARGET_DB" == "$PROD_DB" && "$FORCE" != "1" ]]; then
  echo "ERROR: refusing to restore into ${PROD_DB} without FORCE=1" >&2
  echo "Use TARGET_DB=${PROD_DB} FORCE=1 DRY_RUN=0 only for real disaster recovery." >&2
  exit 1
fi

compose_exec() {
  docker compose -f "$COMPOSE_FILE" exec -T madsan-db "$@"
}

plan() {
  echo "MadSan V2 restore drill"
  echo "  dump:       $DUMP ($(ls -lh "$DUMP" | awk '{print $5}'))"
  echo "  target_db:  $TARGET_DB"
  echo "  compose:    madsan-db (${COMPOSE_FILE})"
  echo "  dry_run:    $DRY_RUN"
  if [[ "$TARGET_DB" == "$PROD_DB" ]]; then
    echo "  WARNING:    production database overwrite (FORCE=1)"
  fi
}

run_restore() {
  CID="$(docker compose -f "$COMPOSE_FILE" ps -q madsan-db)"
  if [[ -z "$CID" ]]; then
    echo "ERROR: madsan-db is not running; start with: docker compose -f ${COMPOSE_FILE} up -d madsan-db" >&2
    exit 1
  fi

  STAMP="$(date +%Y%m%d_%H%M%S)"
  CONTAINER_DUMP="/tmp/madsan_restore_${STAMP}.dump"

  echo "Copying dump into container..."
  docker cp "$DUMP" "${CID}:${CONTAINER_DUMP}"

  echo "Recreating target database ${TARGET_DB}..."
  compose_exec psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  compose_exec psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";"
  compose_exec psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${TARGET_DB}\";"

  echo "Restoring with pg_restore..."
  set +e
  compose_exec pg_restore -U postgres -d "$TARGET_DB" --no-owner --no-acl "$CONTAINER_DUMP"
  restore_status=$?
  set -e
  compose_exec rm -f "$CONTAINER_DUMP"
  if [[ "$restore_status" -gt 1 ]]; then
    echo "ERROR: pg_restore failed (exit ${restore_status})" >&2
    exit 1
  fi
  if [[ "$restore_status" -eq 1 ]]; then
    echo "NOTE: pg_restore exited 1 (often harmless warnings); verify counts below."
  fi

  echo "Verify (sample counts):"
  compose_exec psql -U postgres -d "$TARGET_DB" -v ON_ERROR_STOP=1 -c \
    "SELECT 'companies' AS rel, COUNT(*)::bigint AS n FROM companies
     UNION ALL SELECT 'deals', COUNT(*)::bigint FROM deals
     UNION ALL SELECT 'documents', COUNT(*)::bigint FROM documents;"

  echo "OK: restored ${DUMP} → ${TARGET_DB}"
  if [[ "$TARGET_DB" == "madsan_db_restore_test" ]]; then
    echo "Cleanup (optional): DROP DATABASE madsan_db_restore_test;"
  fi
}

plan

if [[ "$DRY_RUN" == "1" ]]; then
  echo
  echo "Dry-run only. To execute drill restore:"
  echo "  DRY_RUN=0 $0 ${DUMP}"
  exit 0
fi

run_restore
