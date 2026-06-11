# MadSan production deploy

Standalone checkout path on the prod VM: **`/opt/madsan/`** (not `/opt/mining-map/madsan/`).

CI builds and tests run from the MadSan repo root via `.github/workflows/ci.yml`. Deploy is operator-driven until secrets and a real `deploy.yml` are approved.

## First-time VM setup

```bash
sudo mkdir -p /opt/madsan
sudo chown "$USER":"$USER" /opt/madsan
git clone <madsan-repo-url> /opt/madsan
cd /opt/madsan

cp deploy/.env.example deploy/.env
# Edit deploy/.env on the host — never commit secrets.

./scripts/seed_prod_volumes.sh          # once: raw + etl named volumes
docker compose -f deploy/docker-compose.yml \
  -f deploy/docker-compose.prod.yml \
  --profile proxy --profile ais up -d --build
```

When `AISSTREAM_API_KEY` is unset, omit `--profile ais` (the ingest service requires the key).

Verify:

```bash
curl -fsS http://127.0.0.1/health
MADSAN_API_URL=http://127.0.0.1 k6 run scripts/k6_smoke.js
```

## Routine deploy (manual)

```bash
cd /opt/madsan
git fetch origin
git checkout <tag-or-sha>
docker compose -f deploy/docker-compose.yml \
  -f deploy/docker-compose.prod.yml \
  --profile proxy --profile ais up -d --build
```

## Backups

Manual backup:

```bash
cd /opt/madsan && ./scripts/backup_db.sh
ls -lh backups/madsan_v2_pre_*.dump
```

Install daily cron from `scripts/backup_cron.example` or:

```bash
./scripts/install_backup_cron.sh --dry-run
./scripts/install_backup_cron.sh
```

Restore drill (non-prod DB): see `scripts/restore_madsan_db.sh` and `agent_reports/madsan_v2_launch_checklist.md`.

## GitHub Actions deploy (optional)

1. Copy `.github/workflows/deploy.example.yml` → `.github/workflows/deploy.yml`.
2. Add secrets in GitHub: `MADSAN_DEPLOY_HOST`, `MADSAN_DEPLOY_USER`, `MADSAN_DEPLOY_SSH_KEY`.
3. Uncomment the SSH step in `deploy.yml`; remove the placeholder step.
4. Use `workflow_dispatch` only until CI + smoke gates are green.

## Rollback

See [rollback.md](./rollback.md). Never run `docker compose down -v` on prod.

## Monorepo note (pre-split)

While MadSan still lives under `mining-map/madsan/`, use the same compose files but adjust paths (`madsan/deploy/...`, `madsan/scripts/...`). After split, all paths below `/opt/madsan/` drop the `madsan/` prefix.
