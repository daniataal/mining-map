# MadSan data migration — local → production VM

One-time (or repeat) migration of intelligence data from a developer machine to the Oracle Cloud **arm64** VM (`/opt/madsan`).

## What moves where

| Source (local) | Size (typical) | Destination (VM) | Purpose |
|----------------|----------------|------------------|---------|
| `madsan_db` Postgres dump | ~1.2 GiB compressed | `madsan_postgres_data` volume via `pg_restore` | **Primary path** — JODI scores, assets, vessels, AIS, opportunities already ingested |
| `madsan/raw/` | ~24 MiB | `madsan_raw_data` volume | Bunker seed, Natural Earth, watch-folder ingestion |
| `madsan/etl/` | ~22 MiB | `madsan_etl_data` volume | Legacy ETL staging |
| `madsan/data/gem/` | ~300 MiB | `/opt/madsan/madsan/data/gem/` (host) | Future GEM re-import (not mounted in prod compose today) |
| `madsan/data/jodi/` | ~900 MiB | `/opt/madsan/madsan/data/jodi/` (host) | Future JODI file re-import |

**Prod compose note:** `docker-compose.prod.yml` mounts only `madsan_raw_data` and `madsan_etl_data` on worker/scheduler — not `data/gem`. After migration, map/API intelligence comes from the **database restore**. GEM/JODI files on the VM host support manual re-ingest or a future compose mount (`MADSAN_GEM_DATA_DIR`).

## Prerequisites

- Local MadSan stack running (`deploy-madsan-db-1` or `madsan-db` on `localhost:5433`)
- SSH key: `~/Downloads/MadSan-Global-Intelligence-vm-keys/ssh-key-2026-02-11.key`
- VM stack healthy (`curl http://129.159.141.101/health` → `{"status":"ok"}`)
- **`rsync` on the VM** (`sudo apt-get install -y rsync`) — required for file sync
- ~2 GiB free on laptop for staging dump; ~5 GiB free on VM (39 GiB typical)

## Automated (recommended)

From monorepo root:

```bash
export SSH_KEY=~/Downloads/MadSan-Global-Intelligence-vm-keys/ssh-key-2026-02-11.key

# Plan only
./madsan/scripts/migrate_data_to_vm.sh --dry-run

# Full migration (backs up VM DB first)
CONFIRM_PROD_RESTORE=1 ./madsan/scripts/migrate_data_to_vm.sh

# Database only (skip rsync)
CONFIRM_PROD_RESTORE=1 ./madsan/scripts/migrate_data_to_vm.sh --db-only

# Files only (no DB overwrite)
./madsan/scripts/migrate_data_to_vm.sh --files-only
```

Staging dumps: `madsan/.migration-staging/` (gitignored). VM staging: `/opt/madsan/madsan/.migration-staging/`.

## Manual steps (copy-paste)

### 1. Backup production DB (on VM)

```bash
ssh -i ~/Downloads/MadSan-Global-Intelligence-vm-keys/ssh-key-2026-02-11.key ubuntu@129.159.141.101
cd /opt/madsan && ./madsan/scripts/backup_db.sh
ls -lh madsan/backups/
```

### 2. Dump local DB

```bash
cd "/Users/daniatallah/Gold Project /mining-map"
mkdir -p madsan/.migration-staging
docker exec deploy-madsan-db-1 pg_dump -U postgres -d madsan_db -Fc -f /tmp/madsan_local.dump
docker cp deploy-madsan-db-1:/tmp/madsan_local.dump madsan/.migration-staging/madsan_local.dump
```

### 3. Rsync bulk files (not in git)

```bash
KEY=~/Downloads/MadSan-Global-Intelligence-vm-keys/ssh-key-2026-02-11.key
HOST=ubuntu@129.159.141.101
BASE="/Users/daniatallah/Gold Project /mining-map/madsan"

rsync -avz --progress -e "ssh -i $KEY" "$BASE/raw/"     "$HOST:/opt/madsan/madsan/raw/"
rsync -avz --progress -e "ssh -i $KEY" "$BASE/etl/"     "$HOST:/opt/madsan/madsan/etl/"
rsync -avz --progress -e "ssh -i $KEY" "$BASE/data/gem/"  "$HOST:/opt/madsan/madsan/data/gem/"
rsync -avz --progress -e "ssh -i $KEY" "$BASE/data/jodi/" "$HOST:/opt/madsan/madsan/data/jodi/"
```

### 4. Upload and restore dump (on VM)

```bash
scp -i $KEY madsan/.migration-staging/madsan_local.dump $HOST:/opt/madsan/madsan/.migration-staging/

ssh -i $KEY $HOST 'bash -s' <<'EOF'
set -euo pipefail
DUMP=/opt/madsan/madsan/.migration-staging/madsan_local.dump
CID=madsan-madsan-db-1

docker stop madsan-madsan-api-1 madsan-madsan-worker-1 madsan-madsan-scheduler-1 2>/dev/null || true
docker cp "$DUMP" "$CID:/tmp/restore.dump"
docker exec "$CID" psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'madsan_db' AND pid <> pg_backend_pid();" || true
docker exec "$CID" psql -U postgres -c 'DROP DATABASE IF EXISTS madsan_db;'
docker exec "$CID" psql -U postgres -c 'CREATE DATABASE madsan_db;'
docker exec "$CID" pg_restore -U postgres -d madsan_db --no-owner --no-acl /tmp/restore.dump || true
docker exec "$CID" rm -f /tmp/restore.dump

cd /opt/madsan
./madsan/scripts/compose_prod.sh --profile proxy up -d
EOF
```

## Verification

```bash
# VM
ssh -i $KEY ubuntu@129.159.141.101 \
  'docker exec madsan-madsan-db-1 psql -U postgres -d madsan_db -c "
    SELECT '\''market_pressure_scores'\'', COUNT(*) FROM market_pressure_scores
    UNION ALL SELECT '\''vessels'\'', COUNT(*) FROM vessels
    UNION ALL SELECT '\''assets'\'', COUNT(*) FROM assets;"'

curl -fsS http://129.159.141.101/health
# Optional: MADSAN_API_URL=http://129.159.141.101 k6 run madsan/deploy/k6-smoke.js
```

Expected after full local migration (approximate): `market_pressure_scores` ~350k, `vessels` ~11k, `assets` ~296k.

## Rollback

1. **Never** `docker compose down -v` on prod.
2. Restore pre-migration dump:

```bash
ssh ubuntu@129.159.141.101
cd /opt/madsan
DRY_RUN=0 FORCE=1 TARGET_DB=madsan_db ./madsan/scripts/restore_madsan_db.sh madsan/backups/madsan_v2_pre_*.dump
```

3. Re-seed volumes from git checkout if file trees were wrong: `./madsan/scripts/seed_prod_volumes.sh`

## Limitations

- Dump includes local AIS/opportunity state; prod will continue live AIS ingest separately when `--profile ais` is enabled.
- GEM/JODI **files** on VM do not auto-ingest until scheduler paths are mounted or jobs are triggered manually.
- Schema must be compatible (same migration generation); restore after deploy has run migrations at least once.
