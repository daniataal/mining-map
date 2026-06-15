#!/usr/bin/env bash
# MadSan — one-shot local → production VM data migration.
#
# Migrates:
#   1. Postgres madsan_db (pg_dump local → pg_restore on VM) — primary intelligence path
#   2. Host file trees: madsan/raw, madsan/etl, madsan/data/gem, madsan/data/jodi (rsync)
#   3. Re-seeds prod named volumes madsan_raw_data / madsan_etl_data on VM (from synced trees)
#
# Safety:
#   - Backs up VM madsan_db before any restore (unless SKIP_VM_BACKUP=1)
#   - Prod restore requires CONFIRM_PROD_RESTORE=1
#   - Never prints .env secrets
#
# Usage (from repo root or madsan/):
#   export SSH_KEY=~/Downloads/MadSan-Global-Intelligence-vm-keys/ssh-key-2026-02-11.key
#   ./madsan/scripts/migrate_data_to_vm.sh --dry-run
#   CONFIRM_PROD_RESTORE=1 ./madsan/scripts/migrate_data_to_vm.sh
#   CONFIRM_PROD_RESTORE=1 ./madsan/scripts/migrate_data_to_vm.sh --db-only
#   CONFIRM_PROD_RESTORE=1 ./madsan/scripts/migrate_data_to_vm.sh --files-only
#
# Env overrides:
#   VM_HOST VM_USER VM_PATH SSH_KEY LOCAL_DB_CONTAINER REMOTE_DB_CONTAINER
#   STAGING_DIR SKIP_VM_BACKUP SKIP_FILES SKIP_DB
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MADSAN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MADSAN_ROOT/.." && pwd)"

VM_HOST="${VM_HOST:-129.159.141.101}"
VM_USER="${VM_USER:-ubuntu}"
VM_PATH="${VM_PATH:-/opt/madsan}"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/MadSan-Global-Intelligence-vm-keys/ssh-key-2026-02-11.key}"
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-deploy-madsan-db-1}"
REMOTE_DB_CONTAINER="${REMOTE_DB_CONTAINER:-madsan-madsan-db-1}"
STAGING_DIR="${STAGING_DIR:-$MADSAN_ROOT/.migration-staging}"
DB_NAME="${DB_NAME:-madsan_db}"

DRY_RUN=0
DB_ONLY=0
FILES_ONLY=0
SKIP_VM_BACKUP="${SKIP_VM_BACKUP:-0}"
SKIP_FILES="${SKIP_FILES:-0}"
SKIP_DB="${SKIP_DB:-0}"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --db-only) DB_ONLY=1 ;;
    --files-only) FILES_ONLY=1 ;;
    -h|--help)
      sed -n '1,22p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$DB_ONLY" == "1" && "$FILES_ONLY" == "1" ]]; then
  echo "ERROR: use only one of --db-only or --files-only" >&2
  exit 1
fi
if [[ "$FILES_ONLY" == "1" ]]; then
  SKIP_DB=1
fi
if [[ "$DB_ONLY" == "1" ]]; then
  SKIP_FILES=1
fi

SSH_OPTS=(-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
else
  echo "WARN: SSH_KEY not found at $SSH_KEY — using default ssh agent/config" >&2
fi

ssh_vm() {
  ssh "${SSH_OPTS[@]}" "${VM_USER}@${VM_HOST}" "$@"
}

rsync_vm() {
  local src="$1"
  local dest="$2"
  local extra="${3:-}"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] rsync -avz --progress $extra $src ${VM_USER}@${VM_HOST}:$dest"
    return 0
  fi
  rsync -avz --progress $extra -e "ssh ${SSH_OPTS[*]}" "$src" "${VM_USER}@${VM_HOST}:$dest"
}

run_or_echo() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

require_ssh() {
  if ! ssh_vm 'echo SSH_OK' >/dev/null 2>&1; then
    echo "ERROR: cannot SSH to ${VM_USER}@${VM_HOST}" >&2
    exit 1
  fi
}

require_local_db() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$LOCAL_DB_CONTAINER"; then
    echo "ERROR: local DB container not running: $LOCAL_DB_CONTAINER" >&2
    echo "Start: docker compose -f madsan/deploy/docker-compose.yml up -d madsan-db" >&2
    exit 1
  fi
}

stamp() { date +%Y%m%d_%H%M%S; }

phase_header() {
  echo ""
  echo "======== $1 ========"
}

inventory_local() {
  phase_header "Local inventory"
  require_local_db
  echo "Local DB container: $LOCAL_DB_CONTAINER (database: $DB_NAME)"
  docker exec "$LOCAL_DB_CONTAINER" psql -U postgres -d "$DB_NAME" -t -c \
    "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 12;" 2>/dev/null || true
  for d in raw etl data/gem data/jodi; do
    if [[ -d "$MADSAN_ROOT/$d" ]]; then
      du -sh "$MADSAN_ROOT/$d"
    else
      echo "missing: madsan/$d"
    fi
  done
}

inventory_vm() {
  phase_header "VM inventory"
  ssh_vm "curl -fsS http://127.0.0.1/health && echo"
  ssh_vm "docker exec $REMOTE_DB_CONTAINER psql -U postgres -d $DB_NAME -t -c \
    \"SELECT 'market_pressure_scores', COUNT(*) FROM market_pressure_scores
     UNION ALL SELECT 'vessels', COUNT(*) FROM vessels
     UNION ALL SELECT 'assets', COUNT(*) FROM assets;\" 2>/dev/null || true"
  ssh_vm "docker run --rm -v madsan_raw_data:/v alpine du -sh /v 2>/dev/null; docker run --rm -v madsan_etl_data:/v alpine du -sh /v 2>/dev/null"
}

backup_vm_db() {
  phase_header "VM pre-restore backup"
  if [[ "$SKIP_VM_BACKUP" == "1" ]]; then
    echo "SKIP_VM_BACKUP=1 — skipping"
    return 0
  fi
  local remote_backup="$VM_PATH/madsan/backups/madsan_v2_pre_$(stamp).dump"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] ssh VM: docker exec $REMOTE_DB_CONTAINER pg_dump → $remote_backup"
    return 0
  fi
  ssh_vm "mkdir -p '$VM_PATH/madsan/backups'"
  ssh_vm "docker exec '$REMOTE_DB_CONTAINER' pg_dump -U postgres -d '$DB_NAME' -Fc -f /tmp/madsan_vm_pre.dump"
  ssh_vm "docker cp '${REMOTE_DB_CONTAINER}:/tmp/madsan_vm_pre.dump' '$remote_backup'"
  ssh_vm "docker exec '$REMOTE_DB_CONTAINER' rm -f /tmp/madsan_vm_pre.dump"
  ssh_vm "ls -lh '$remote_backup'"
}

dump_local_db() {
  phase_header "Local pg_dump"
  require_local_db
  mkdir -p "$STAGING_DIR"
  local out="$STAGING_DIR/madsan_local_$(stamp).dump"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] docker exec $LOCAL_DB_CONTAINER pg_dump → $out"
    DUMP_FILE="$out"
    return 0
  fi
  echo "Dumping to $out (this may take 1–3 minutes)..."
  docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d "$DB_NAME" -Fc -f "/tmp/madsan_migrate.dump"
  docker cp "${LOCAL_DB_CONTAINER}:/tmp/madsan_migrate.dump" "$out"
  docker exec "$LOCAL_DB_CONTAINER" rm -f /tmp/madsan_migrate.dump
  ls -lh "$out"
  DUMP_FILE="$out"
}

upload_dump() {
  phase_header "Upload dump to VM"
  local remote_dir="$VM_PATH/madsan/.migration-staging"
  if [[ -z "${DUMP_FILE:-}" ]]; then
    echo "ERROR: DUMP_FILE not set" >&2
    exit 1
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] scp $DUMP_FILE → ${VM_USER}@${VM_HOST}:$remote_dir/"
    REMOTE_DUMP="$remote_dir/$(basename "$DUMP_FILE")"
    return 0
  fi
  ssh_vm "mkdir -p '$remote_dir'"
  scp "${SSH_OPTS[@]}" "$DUMP_FILE" "${VM_USER}@${VM_HOST}:$remote_dir/"
  REMOTE_DUMP="$remote_dir/$(basename "$DUMP_FILE")"
  echo "Remote dump: $REMOTE_DUMP"
}

sync_files() {
  phase_header "Rsync file trees to VM"
  local remote_madsan="$VM_PATH/madsan"
  for pair in "raw:raw" "etl:etl" "data/gem:data/gem" "data/jodi:data/jodi"; do
    local rel="${pair%%:*}"
    local dest_rel="${pair##*:}"
    local src="$MADSAN_ROOT/$rel/"
    if [[ ! -d "$MADSAN_ROOT/$rel" ]]; then
      echo "skip missing: madsan/$rel"
      continue
    fi
    rsync_vm "$src" "$remote_madsan/$dest_rel/"
  done
}

seed_vm_volumes() {
  phase_header "Re-seed VM named volumes (raw + etl)"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] ssh VM: cd $VM_PATH && ./madsan/scripts/seed_prod_volumes.sh"
    return 0
  fi
  ssh_vm "cd '$VM_PATH' && ./madsan/scripts/seed_prod_volumes.sh"
}

restore_vm_db() {
  phase_header "Restore dump on VM"
  if [[ "${CONFIRM_PROD_RESTORE:-}" != "1" ]]; then
    echo "ERROR: set CONFIRM_PROD_RESTORE=1 to overwrite production $DB_NAME" >&2
    exit 1
  fi
  if [[ -z "${REMOTE_DUMP:-}" ]]; then
    echo "ERROR: REMOTE_DUMP not set" >&2
    exit 1
  fi
  local remote_script
  remote_script=$(cat <<'REMOTE'
set -euo pipefail
REMOTE_DUMP="$1"
REMOTE_DB_CONTAINER="$2"
DB_NAME="$3"
DRY="$4"

if [[ "$DRY" == "1" ]]; then
  echo "[dry-run] stop api/worker/scheduler, pg_restore into $DB_NAME from $REMOTE_DUMP"
  exit 0
fi

echo "Stopping writers..."
docker stop madsan-madsan-api-1 madsan-madsan-worker-1 madsan-madsan-scheduler-1 madsan-madsan-ais-ingest-1 2>/dev/null || true

CID="$REMOTE_DB_CONTAINER"
IN_CONTAINER="/tmp/madsan_restore.dump"
docker cp "$REMOTE_DUMP" "${CID}:${IN_CONTAINER}"

docker exec "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  >/dev/null 2>&1 || true
docker exec "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
docker exec "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${DB_NAME}\";"

set +e
docker exec "$CID" pg_restore -U postgres -d "$DB_NAME" --no-owner --no-acl "$IN_CONTAINER"
st=$?
set -e
docker exec "$CID" rm -f "$IN_CONTAINER"
if [[ "$st" -gt 1 ]]; then
  echo "ERROR: pg_restore exit $st" >&2
  exit 1
fi
[[ "$st" -eq 1 ]] && echo "NOTE: pg_restore warnings (exit 1) — verify counts"

echo "Starting stack..."
cd /opt/madsan
./madsan/scripts/compose_prod.sh --profile proxy up -d --remove-orphans

echo "Post-restore counts:"
docker exec "$CID" psql -U postgres -d "$DB_NAME" -t -c \
  "SELECT 'market_pressure_scores', COUNT(*) FROM market_pressure_scores
   UNION ALL SELECT 'vessels', COUNT(*) FROM vessels
   UNION ALL SELECT 'assets', COUNT(*) FROM assets
   UNION ALL SELECT 'ais_positions', COUNT(*) FROM ais_positions
   UNION ALL SELECT 'opportunity_candidates', COUNT(*) FROM opportunity_candidates;"
REMOTE
)
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] remote restore from $REMOTE_DUMP"
    return 0
  fi
  ssh_vm "bash -s" -- "$REMOTE_DUMP" "$REMOTE_DB_CONTAINER" "$DB_NAME" "0" <<<"$remote_script"
}

verify_vm() {
  phase_header "Verify VM"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] curl http://${VM_HOST}/health and sample API"
    return 0
  fi
  ssh_vm "curl -fsS http://127.0.0.1/health && echo"
  ssh_vm "docker exec $REMOTE_DB_CONTAINER psql -U postgres -d $DB_NAME -t -c \
    \"SELECT 'market_pressure_scores', COUNT(*) FROM market_pressure_scores
     UNION ALL SELECT 'vessels', COUNT(*) FROM vessels
     UNION ALL SELECT 'assets', COUNT(*) FROM assets;\""
  echo "Edge (if Caddy on :80): curl -fsS http://${VM_HOST}/health"
}

main() {
  echo "MadSan local → VM migration"
  echo "  VM:      ${VM_USER}@${VM_HOST}:${VM_PATH}"
  echo "  staging: ${STAGING_DIR}"
  echo "  dry_run: ${DRY_RUN}"
  require_ssh
  inventory_local
  inventory_vm

  if [[ "$SKIP_DB" != "1" ]]; then
    backup_vm_db
    dump_local_db
    upload_dump
    restore_vm_db
  fi

  if [[ "$SKIP_FILES" != "1" ]]; then
    sync_files
    seed_vm_volumes
  fi

  verify_vm
  echo ""
  echo "Done. Rollback: restore VM backup from ${VM_PATH}/madsan/backups/ (see madsan/deploy/DATA_MIGRATION.md)"
}

main "$@"
