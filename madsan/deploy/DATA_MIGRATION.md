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

docker stop madsan-madsan-api-1 madsan-madsan-worker-1 madsan-madsan-scheduler-1 \
  madsan-madsan-ais-ingest-1 madsan-madsan-frontend-1 madsan-caddy-1 2>/dev/null || true
docker cp "$DUMP" "$CID:/tmp/restore.dump"
docker exec "$CID" psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'madsan_db' AND pid <> pg_backend_pid();" || true
docker exec "$CID" psql -U postgres -c 'DROP DATABASE IF EXISTS madsan_db;'
docker exec "$CID" psql -U postgres -c 'CREATE DATABASE madsan_db;'
docker exec "$CID" pg_restore -U postgres -d madsan_db --no-owner --no-acl --role=postgres -j 1 /tmp/restore.dump || true
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

Expected after full local migration (approximate): `market_pressure_scores` ~350k, `vessels` ~11k, `assets` ~296k, `companies` ~57k, `ais_positions` ~136k, `opportunity_candidates` ~5k.

## Troubleshooting

### `FATAL: role "madsan" does not exist`

MadSan Postgres uses **`postgres`** as the superuser (`POSTGRES_USER` in compose; `DATABASE_URL` uses `postgresql://postgres:…`). There is no `MADSAN_DB_USER` and no login role named `madsan` (only `madsan_rls` for RLS policies).

On the VM:

```bash
docker exec madsan-madsan-db-1 psql -U postgres -d madsan_db -c "SELECT COUNT(*) FROM assets;"
```

Do **not** use `-U madsan`.

### VM counts much lower than local

Common causes:

1. **Never ran `migrate_data_to_vm.sh` with `CONFIRM_PROD_RESTORE=1`** — prod still has empty/fresh `madsan_db` from first deploy.
2. **Wrong compose stack** — repo-root legacy compose (`cd /opt/madsan && docker compose up`) creates a different project/volume than MadSan prod (`./madsan/scripts/compose_prod.sh --profile proxy up -d`). Always use `compose_prod.sh` on the VM.
3. **Partial or failed restore** — interrupted `pg_restore`, parallel jobs (`-j` > 1) under memory pressure, or streaming restore over SSH can cause Postgres OOM/restart (`no connection to the server` × hundreds). Stop api/worker/scheduler/frontend/caddy first; use `pg_restore -j 1 --role=postgres` from a file copied into the container (not stdin). Re-run migration; the script recreates the volume when corruption is detected and `CONFIRM_PROD_RESTORE=1`.
4. **`docker compose down -v` on prod** — **never** do this; it wipes `madsan_postgres_data`. If it happened, restore from local dump via this script (there is nothing useful left on the volume).
5. **Local DB grew since last dump** — re-run full migration (not `--files-only`) to refresh the dump.

Check before/after counts:

```bash
# Local
docker exec deploy-madsan-db-1 psql -U postgres -d madsan_db -t -A -c "
  SELECT 'assets', COUNT(*) FROM assets
  UNION ALL SELECT 'market_pressure_scores', COUNT(*) FROM market_pressure_scores;"

# VM
ssh -i $KEY ubuntu@129.159.141.101 \
  'docker exec madsan-madsan-db-1 psql -U postgres -d madsan_db -t -A -c "
    SELECT '\''assets'\'', COUNT(*) FROM assets
    UNION ALL SELECT '\''market_pressure_scores'\'', COUNT(*) FROM market_pressure_scores;"'
```

If `madsan-madsan-db-1` is in a **Restarting** loop, inspect `docker logs madsan-madsan-db-1` and re-run:

```bash
CONFIRM_PROD_RESTORE=1 SKIP_VM_BACKUP=1 ./madsan/scripts/migrate_data_to_vm.sh
```

(`SKIP_VM_BACKUP=1` when the corrupt DB cannot be dumped.)

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
