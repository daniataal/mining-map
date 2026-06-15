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

# Resolve madsan-db container on VM (project madsan, service madsan-db).
discover_remote_db_container() {
  local found
  found="$(ssh_vm "docker ps -a --filter label=com.docker.compose.project=madsan \
    --filter label=com.docker.compose.service=madsan-db --format '{{.Names}}' | head -1" 2>/dev/null || true)"
  if [[ -n "$found" ]]; then
    REMOTE_DB_CONTAINER="$found"
    echo "Remote DB container: $REMOTE_DB_CONTAINER"
  else
    echo "WARN: could not auto-discover madsan-db — using REMOTE_DB_CONTAINER=$REMOTE_DB_CONTAINER" >&2
  fi
}

stop_vm_writers() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] stop VM api/worker/scheduler/ais-ingest/frontend/caddy (keep DB)"
    return 0
  fi
  ssh_vm "cd '$VM_PATH' && ./madsan/scripts/compose_prod.sh --profile proxy stop \
    madsan-api madsan-worker madsan-scheduler madsan-ais-ingest madsan-frontend caddy 2>/dev/null || true"
}

# docker exec fails while container status is Restarting — wait or fail clearly.
wait_for_vm_db_running() {
  local status i
  for i in $(seq 1 30); do
    status="$(vm_db_container_status)"
    case "$status" in
      running)
        if vm_db_pg_ready; then
          return 0
        fi
        ;;
      restarting)
        echo "  waiting for $REMOTE_DB_CONTAINER (restarting)... attempt $i/30"
        ;;
      *)
        echo "  waiting for $REMOTE_DB_CONTAINER (status=$status)... attempt $i/30"
        ;;
    esac
    sleep 2
  done
  echo "ERROR: $REMOTE_DB_CONTAINER not running/ready after 60s (status=$status)" >&2
  return 1
}

require_local_db() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$LOCAL_DB_CONTAINER"; then
    echo "ERROR: local DB container not running: $LOCAL_DB_CONTAINER" >&2
    echo "Start: docker compose -f madsan/deploy/docker-compose.yml up -d madsan-db" >&2
    exit 1
  fi
}

stamp() { date +%Y%m%d_%H%M%S; }

# Tables compared before/after restore (skip missing relations gracefully on VM).
KEY_TABLE_COUNTS_SQL="
SELECT 'assets', COUNT(*) FROM assets
UNION ALL SELECT 'companies', COUNT(*) FROM companies
UNION ALL SELECT 'vessels', COUNT(*) FROM vessels
UNION ALL SELECT 'opportunity_candidates', COUNT(*) FROM opportunity_candidates
UNION ALL SELECT 'market_pressure_scores', COUNT(*) FROM market_pressure_scores
UNION ALL SELECT 'ais_positions', COUNT(*) FROM ais_positions
ORDER BY 1;"

print_key_table_counts() {
  local label="$1"
  shift
  echo "--- $label ---"
  "$@" 2>/dev/null || echo "(query failed — DB may be down or schema differs)"
}

phase_header() {
  echo ""
  echo "======== $1 ========"
}

vm_db_container_status() {
  ssh_vm "docker inspect '$REMOTE_DB_CONTAINER' --format '{{.State.Status}}' 2>/dev/null" || echo "missing"
}

vm_db_pg_ready() {
  ssh_vm "docker exec '$REMOTE_DB_CONTAINER' pg_isready -U postgres -d postgres >/dev/null 2>&1"
}

vm_db_has_checkpoint_corruption() {
  ssh_vm "docker logs '$REMOTE_DB_CONTAINER' 2>&1 | tail -80 | grep -qE 'invalid checkpoint record|could not locate a valid checkpoint record'"
}

# When PGDATA is corrupt (common after interrupted restore or compose down -v mid-write),
# DROP DATABASE cannot help — recreate the named volume, then restore from dump.
ensure_vm_db_healthy() {
  phase_header "VM Postgres health"
  local status
  status="$(vm_db_container_status)"
  echo "Container $REMOTE_DB_CONTAINER status: $status"

  if [[ "$status" == "running" ]] && vm_db_pg_ready; then
    echo "Postgres accepts connections."
    return 0
  fi

  if [[ "$status" == "restarting" ]]; then
    echo "WARN: DB container is restarting — stopping writers and waiting..."
    stop_vm_writers
    sleep 3
    status="$(vm_db_container_status)"
    if [[ "$status" == "running" ]] && vm_db_pg_ready; then
      echo "Postgres recovered after stopping writers."
      return 0
    fi
  fi

  if ! vm_db_has_checkpoint_corruption; then
    echo "ERROR: VM Postgres is not healthy and logs do not show known checkpoint corruption." >&2
    echo "Inspect: ssh ${VM_USER}@${VM_HOST} docker logs $REMOTE_DB_CONTAINER" >&2
    exit 1
  fi

  echo "WARN: PGDATA corruption detected (invalid checkpoint record)."
  echo "      Likely causes: interrupted pg_restore, docker stop during write, or compose down -v."
  if [[ "${CONFIRM_PROD_RESTORE:-}" != "1" ]]; then
    echo "ERROR: set CONFIRM_PROD_RESTORE=1 to recreate madsan_postgres_data and restore from local dump" >&2
    exit 1
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] would recreate volume madsan_postgres_data and start fresh madsan-db"
    return 0
  fi

  echo "Recreating madsan_postgres_data (empty cluster) before restore..."
  ssh_vm "bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/madsan
./madsan/scripts/compose_prod.sh --profile proxy stop \
  madsan-api madsan-worker madsan-scheduler madsan-ais-ingest madsan-frontend caddy madsan-db 2>/dev/null || true
docker rm -f madsan-madsan-db-1 2>/dev/null || true
docker volume rm madsan_postgres_data
./madsan/scripts/compose_prod.sh --profile proxy up -d madsan-db
for i in $(seq 1 45); do
  if docker exec madsan-madsan-db-1 pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    echo "Fresh Postgres ready."
    exit 0
  fi
  sleep 2
done
echo "ERROR: madsan-db did not become ready after volume recreate" >&2
exit 1
REMOTE
}

inventory_local() {
  phase_header "Local inventory"
  require_local_db
  echo "Local DB container: $LOCAL_DB_CONTAINER (database: $DB_NAME)"
  print_key_table_counts "local key tables" \
    docker exec "$LOCAL_DB_CONTAINER" psql -U postgres -d "$DB_NAME" -t -A -c "$KEY_TABLE_COUNTS_SQL"
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
  ssh_vm "curl -fsS http://127.0.0.1/health && echo" || echo "WARN: /health not OK (API may be up but DB down)"
  if vm_db_pg_ready; then
    print_key_table_counts "VM key tables (before)" \
      ssh_vm "docker exec $REMOTE_DB_CONTAINER psql -U postgres -d $DB_NAME -t -A -c \"$KEY_TABLE_COUNTS_SQL\""
  else
    echo "VM Postgres not ready — counts skipped (see health check below)"
  fi
  ssh_vm "docker run --rm -v madsan_raw_data:/v alpine du -sh /v 2>/dev/null; docker run --rm -v madsan_etl_data:/v alpine du -sh /v 2>/dev/null"
}

backup_vm_db() {
  phase_header "VM pre-restore backup"
  if [[ "$SKIP_VM_BACKUP" == "1" ]]; then
    echo "SKIP_VM_BACKUP=1 — skipping"
    return 0
  fi
  echo "Stopping writers before VM backup (avoids checkpoint corruption during pg_dump)..."
  stop_vm_writers
  if ! wait_for_vm_db_running; then
    echo "WARN: VM Postgres not ready — skipping backup (use prior dump in madsan/backups/ if needed)"
    return 0
  fi
  local remote_backup="$VM_PATH/madsan/backups/madsan_v2_pre_$(stamp).dump"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] ssh VM: docker exec $REMOTE_DB_CONTAINER pg_dump → $remote_backup"
    return 0
  fi
  ssh_vm "mkdir -p '$VM_PATH/madsan/backups'"
  local attempt
  for attempt in 1 2 3; do
    if ssh_vm "docker exec '$REMOTE_DB_CONTAINER' pg_dump -U postgres -d '$DB_NAME' -Fc -f /tmp/madsan_vm_pre.dump"; then
      break
    fi
    if [[ "$attempt" -eq 3 ]]; then
      echo "ERROR: pg_dump failed after 3 attempts (container may be restarting)" >&2
      exit 1
    fi
    echo "WARN: pg_dump attempt $attempt failed — retrying in 5s..."
    sleep 5
    wait_for_vm_db_running || true
  done
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
  docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d "$DB_NAME" -Fc > "$out"
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
  local local_migration_version
  local_migration_version="$(docker exec "$LOCAL_DB_CONTAINER" psql -U postgres -d "$DB_NAME" -t -A -c \
    "SELECT version FROM schema_migrations LIMIT 1;" 2>/dev/null || echo "42")"
  local remote_script
  remote_script=$(cat <<'REMOTE'
set -euo pipefail
REMOTE_DUMP="$1"
REMOTE_DB_CONTAINER="$2"
DB_NAME="$3"
LOCAL_MIGRATION_VERSION="$4"
DRY="$5"

KEY_COUNTS_SQL="
SELECT 'assets', COUNT(*)::bigint FROM assets
UNION ALL SELECT 'vessels', COUNT(*)::bigint FROM vessels
UNION ALL SELECT 'market_pressure_scores', COUNT(*)::bigint FROM market_pressure_scores
ORDER BY 1;"

count_key_tables() {
  docker exec "$REMOTE_DB_CONTAINER" psql -U postgres -d "$DB_NAME" -t -A -c "$KEY_COUNTS_SQL" 2>/dev/null || true
}

wait_for_db_stable() {
  local i
  for i in $(seq 1 45); do
    if docker exec "$REMOTE_DB_CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
      return 0
    fi
    echo "  waiting for Postgres stable... attempt $i/45"
    sleep 2
  done
  echo "ERROR: Postgres not ready after 90s" >&2
  return 1
}

drop_recreate_db() {
  docker exec "$REMOTE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  docker exec "$REMOTE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
  docker exec "$REMOTE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${DB_NAME}\";"
}

restore_table_data() {
  local table="$1"
  echo "  data-only retry: $table"
  set +e
  docker exec "$REMOTE_DB_CONTAINER" pg_restore -U postgres -d "$DB_NAME" \
    --no-owner --no-acl --role=postgres --data-only --table="$table" -j 1 \
    /tmp/madsan_restore.dump >/dev/null 2>&1
  set -e
}

run_pg_restore() {
  local log="/tmp/pg_restore_${DB_NAME}.log"
  docker cp "$REMOTE_DUMP" "${REMOTE_DB_CONTAINER}:/tmp/madsan_restore.dump"
  set +e
  docker exec "$REMOTE_DB_CONTAINER" pg_restore -U postgres -d "$DB_NAME" \
    --no-owner --no-acl --role=postgres -j 1 /tmp/madsan_restore.dump >"$log" 2>&1
  local st=$?
  set -e
  tail -15 "$log" 2>/dev/null || true
  if [[ "$st" -gt 1 ]] && grep -qE 'no connection to the server|server closed the connection|could not connect' "$log"; then
    return 2
  fi
  if [[ "$st" -gt 1 ]]; then
    return 1
  fi
  return 0
}

if [[ "$DRY" == "1" ]]; then
  echo "[dry-run] stop stack, pg_restore into $DB_NAME from $REMOTE_DUMP"
  exit 0
fi

echo "Stopping full stack (keep DB up)..."
cd /opt/madsan
./madsan/scripts/compose_prod.sh --profile proxy stop \
  madsan-api madsan-worker madsan-scheduler madsan-ais-ingest madsan-frontend caddy 2>/dev/null || true

CID="$REMOTE_DB_CONTAINER"
if [[ ! -f "$REMOTE_DUMP" ]]; then
  echo "ERROR: dump not found on VM host: $REMOTE_DUMP" >&2
  exit 1
fi
echo "Restore source: $REMOTE_DUMP ($(du -h "$REMOTE_DUMP" | cut -f1))"

wait_for_db_stable

drop_recreate_db

echo "pg_restore (-j 1, file inside container, may take 10–20 min)..."
restore_ok=0
for attempt in 1 2 3; do
  echo "  restore attempt $attempt/3..."
  set +e
  run_pg_restore
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    restore_ok=1
    break
  fi
  if [[ "$rc" -eq 2 ]]; then
    echo "WARN: connection lost during restore — waiting for DB and retrying clean restore..."
    wait_for_db_stable || exit 1
    drop_recreate_db
    continue
  fi
  echo "ERROR: pg_restore failed (exit $rc)" >&2
  exit 1
done
if [[ "$restore_ok" != "1" ]]; then
  echo "ERROR: pg_restore failed after 3 attempts" >&2
  exit 1
fi

# Retry data-only for key tables still empty after interrupted restore.
for table in vessels market_pressure_scores opportunity_candidates; do
  n="$(docker exec "$CID" psql -U postgres -d "$DB_NAME" -t -A -c "SELECT COUNT(*) FROM ${table};" 2>/dev/null || echo 0)"
  if [[ "${n:-0}" == "0" ]]; then
    restore_table_data "$table"
  fi
done
docker exec "$CID" rm -f /tmp/madsan_restore.dump

echo "Post-restore schema fix (migration runner + PKs from dump)..."
docker exec "$CID" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "UPDATE schema_migrations SET version = ${LOCAL_MIGRATION_VERSION}, dirty = false;"
docker exec "$CID" psql -U postgres -d "$DB_NAME" \
  -c "ALTER TABLE tenants ADD PRIMARY KEY (id);" 2>/dev/null || true
docker exec "$CID" psql -U postgres -d "$DB_NAME" \
  -c "ALTER TABLE core_source_ledger ADD PRIMARY KEY (source_key);" 2>/dev/null || true

echo "Post-restore counts:"
docker exec "$CID" psql -U postgres -d "$DB_NAME" -t -A -c \
  "SELECT 'assets', COUNT(*) FROM assets
   UNION ALL SELECT 'companies', COUNT(*) FROM companies
   UNION ALL SELECT 'vessels', COUNT(*) FROM vessels
   UNION ALL SELECT 'opportunity_candidates', COUNT(*) FROM opportunity_candidates
   UNION ALL SELECT 'market_pressure_scores', COUNT(*) FROM market_pressure_scores
   UNION ALL SELECT 'ais_positions', COUNT(*) FROM ais_positions
   ORDER BY 1;"

assets_n="$(docker exec "$CID" psql -U postgres -d "$DB_NAME" -t -A -c "SELECT COUNT(*) FROM assets;" 2>/dev/null || echo 0)"
if [[ "${assets_n:-0}" == "0" ]]; then
  echo "ERROR: restore produced zero assets — aborting before stack start" >&2
  exit 1
fi

echo "Starting stack (migrations skipped — restored DB already at v${LOCAL_MIGRATION_VERSION})..."
MADSAN_RUN_MIGRATIONS=false ./madsan/scripts/compose_prod.sh --profile proxy up -d --remove-orphans
REMOTE
)
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] remote restore from $REMOTE_DUMP"
    return 0
  fi
  ssh_vm "bash -s" -- "$REMOTE_DUMP" "$REMOTE_DB_CONTAINER" "$DB_NAME" "$local_migration_version" "0" <<<"$remote_script"
}

verify_vm() {
  phase_header "Verify VM"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] curl http://${VM_HOST}/health and sample API"
    return 0
  fi
  ssh_vm "curl -fsS http://127.0.0.1/health && echo"
  print_key_table_counts "VM key tables (after)" \
    ssh_vm "docker exec $REMOTE_DB_CONTAINER psql -U postgres -d $DB_NAME -t -A -c \"$KEY_TABLE_COUNTS_SQL\""
  ssh_vm "curl -fsS 'http://127.0.0.1/api/energy/assets?limit=1' | head -c 200 && echo" \
    || echo "WARN: assets API sample failed"
  echo "Public checks:"
  echo "  curl -fsS http://${VM_HOST}/health"
  echo "  curl -fsS 'http://${VM_HOST}/api/energy/assets?limit=1'"
}

main() {
  echo "MadSan local → VM migration"
  echo "  VM:      ${VM_USER}@${VM_HOST}:${VM_PATH}"
  echo "  staging: ${STAGING_DIR}"
  echo "  dry_run: ${DRY_RUN}"
  require_ssh
  discover_remote_db_container
  inventory_local
  inventory_vm
  ensure_vm_db_healthy

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
