# MadSan production deploy

Standalone checkout path on the prod VM: **`/opt/madsan/`** (not `/opt/mining-map/madsan/`).

While MadSan still lives in the `mining-map` monorepo, clone the **full monorepo** to `/opt/madsan` and use compose paths under `madsan/deploy/`. After repo split, the same directory holds a MadSan-only checkout with `deploy/` at the repo root.

Automated deploy: **`.github/workflows/madsan-deploy.yml`** (repo root).

## GitHub secrets (repository Settings → Secrets)

MadSan deploy uses these **SSH and registry secrets** (repository Settings → Secrets):

| Secret | Purpose |
|--------|---------|
| `DOCKER_USERNAME` | Docker Hub login for `madsan-publish.yml` |
| `DOCKER_PASSWORD` | Docker Hub token/password for publish |
| `REMOTE_HOST` | VM hostname or IP |
| `REMOTE_USER` | SSH user (e.g. `ubuntu`; must run `docker compose` or have passwordless sudo for legacy shutdown) |
| `REMOTE_SSH_KEY` | Private key for SSH (PEM; no passphrase recommended for Actions) |

Optional aliases (only if `REMOTE_*` is not set): `MADSAN_DEPLOY_HOST`, `MADSAN_DEPLOY_USER`, `MADSAN_DEPLOY_SSH_KEY`.

**Do not** add MadSan-specific GitHub secrets for API keys (`AISSTREAM_API_KEY`, `GROQ_API_KEY`, `EIA_API_KEY`, etc.). Those belong in **`madsan/deploy/.env` on the VM only** — the deploy workflow never reads them from GitHub.

Optional repo **variable** (not secret): `MADSAN_NEXT_PUBLIC_API_URL` — baked into the frontend image at publish time; should match `NEXT_PUBLIC_API_URL` in `deploy/.env` on the VM.

Optional: create a GitHub **environment** named `production` if you want approval gates on publish/deploy jobs.

## VM env file (`deploy/.env`)

Copy from `deploy/.env.example` on the host. Never commit real values.

**Required for production**

| Variable | Notes |
|----------|--------|
| `MADSAN_DB_PASSWORD` | Postgres password for `madsan-db` |
| `MADSAN_JWT_SECRET` | Strong random secret for auth |
| `NEXT_PUBLIC_API_URL` | Browser → API URL (e.g. `http://your-host` or `https://…` behind TLS) |

**Recommended**

| Variable | Notes |
|----------|--------|
| `LEGACY_DATABASE_URL` | Host-side legacy mining-db if used |
| `MADSAN_DOCKER_LEGACY_DATABASE_URL` | In-container legacy DB URL override |
| `AISSTREAM_API_KEY` | Enables `--profile ais` on deploy when set |
| `EIA_API_KEY` | Daily crude ticker |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` | AI DD copilot |
| `OPENSANCTIONS_API_KEY` | Sanctions screening |
| `SHIPVAULT_*` | Vessel registry enrichment (see `.env.example`) |

**Production overlay tuning** (optional, in `deploy/.env`)

`MADSAN_DB_MEM_LIMIT`, `MADSAN_API_MEM_LIMIT`, `MADSAN_CADDY_HTTP`, `MADSAN_RUN_MIGRATIONS` (default `true` — API runs migrations on startup).

## First-time VM bootstrap

Target: **linux/arm64** VM (~23 GiB RAM per prod overlay comments).

**Automated (recommended):** run **MadSan deploy** (`workflow_dispatch` on `madsan-deploy.yml`) after setting GitHub secrets (`REMOTE_HOST`, `REMOTE_USER`, `REMOTE_SSH_KEY`). The deploy script auto-bootstraps when `/opt/madsan` is missing or not a git checkout:

1. `mkdir -p /opt/madsan` (with `sudo` + `chown` if needed)
2. If `/opt/mining-map` is already a git checkout and `/opt/madsan` is empty, symlink `/opt/madsan` → `/opt/mining-map`
3. Otherwise `git clone` the monorepo via `GITHUB_TOKEN` (workflow `contents: read`; no deploy key required for Actions-driven clone)
4. `git fetch` + `git checkout` deploy SHA
5. Copy `madsan/deploy/.env.example` → `madsan/deploy/.env` **only when `.env` is missing** (never overwrites an existing file)
6. Run `madsan/scripts/seed_prod_volumes.sh` only when `madsan_raw_data` / `madsan_etl_data` volumes are empty
7. Stop legacy stack at `/opt/mining-map`, then `docker compose pull` / `up`

Prerequisites on the VM: Docker Engine + Compose v2, `git`, `curl`; deploy user in `docker` group (or passwordless `sudo` for legacy shutdown).

**Manual bootstrap** (optional — same end state):

```bash
# 1. Docker Engine + Compose v2 plugin
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker "$USER"
# Re-login so docker group applies

# 2. Checkout (monorepo interim — full mining-map repo at /opt/madsan)
sudo mkdir -p /opt/madsan
sudo chown "$USER":"$USER" /opt/madsan
git clone git@github.com:daniataal/mining-map.git /opt/madsan   # SSH deploy key, or HTTPS with PAT
cd /opt/madsan

# 3. Host env (paths differ pre/post split — see monorepo note below)
cp madsan/deploy/.env.example madsan/deploy/.env   # monorepo
# OR after split: cp deploy/.env.example deploy/.env
# Edit secrets on the host only.

# 4. Seed named volumes once (raw + etl for worker/scheduler)
./madsan/scripts/seed_prod_volumes.sh            # monorepo
# OR after split: ./scripts/seed_prod_volumes.sh

# 5. First stack bring-up
docker compose -f madsan/deploy/docker-compose.yml \
  -f madsan/deploy/docker-compose.prod.yml \
  --profile proxy up -d --build
# Add --profile ais when AISSTREAM_API_KEY is set in deploy/.env
```

**Private repo clone auth:** GitHub Actions passes `GITHUB_TOKEN` for the one-time clone during deploy. For manual `git pull` on the VM afterward, configure either an SSH deploy key (`git@github.com:…`) or a read-only PAT in `git credential` — do not store tokens in `.env`.

Verify:

```bash
curl -fsS http://127.0.0.1/health
MADSAN_API_URL=http://127.0.0.1 k6 run madsan/deploy/k6-smoke.js   # monorepo path
```

Install backup cron (optional): `madsan/scripts/install_backup_cron.sh`

## Automated deploy behavior

| Trigger | What happens |
|---------|----------------|
| Push to `main` / `master` / `paperclip2` with `madsan/**` changes | After **MadSan Docker validate** → **MadSan Docker publish** (Docker Hub) → **MadSan deploy** (VM pull + up) |
| Push without `madsan/**` changes | No publish or deploy |
| Pull request | Never publishes or deploys |
| `workflow_dispatch` on publish / deploy | Manual registry push or VM deploy with chosen ref and `IMAGE_TAG` |

Deploy steps on the VM:

1. **Stop legacy mining-map stack** at `/opt/mining-map` (`docker compose -f docker-compose.prod.yml down --remove-orphans`; volumes preserved). Falls back to `sudo` if the deploy user did not start legacy containers.
2. `git fetch` + `git checkout` deploy SHA
3. `export IMAGE_TAG=v<publish-run>` (or `latest` / short SHA via manual dispatch)
4. `docker compose -f …/docker-compose.yml -f …/docker-compose.prod.yml --profile proxy [--profile ais] pull` for `dannyatalla/madsan-api` and `dannyatalla/madsan-frontend`
5. On pull failure, fallback: `docker compose … build --pull`
6. `docker compose … up -d --remove-orphans`
7. Migrations run via API (`MADSAN_RUN_MIGRATIONS=true` in compose)
8. Health check: `curl http://127.0.0.1/health` (Caddy → API)
9. Scoped image cleanup (see below)

**First run:** if `/opt/madsan` is missing or not a git checkout, deploy auto-bootstraps (clone or legacy symlink), creates `.env` from `.env.example` when absent, and seeds empty prod volumes. Existing `madsan/deploy/.env` on the VM is never overwritten.

## Image cleanup strategy

After a successful health check, the deploy script:

1. `docker image prune -f` — dangling layers only (safe on a shared VM)
2. Removes **unused** images labeled `com.docker.compose.project=madsan` (not referenced by any container)
3. `docker builder prune -f --filter until=48h` — old build cache

It does **not** run `docker image prune -a` and does **not** remove legacy mining images — only stops legacy **containers** before bring-up.

Set `COMPOSE_PROJECT_NAME=madsan` so labels stay consistent.

## Cutover from legacy mining-viz

| Legacy mining-viz | MadSan |
|-------------------|--------|
| Path `/opt/mining-map` | Path `/opt/madsan` |
| Manual VM deploy / legacy CI (removed) | Workflow `madsan-deploy.yml` (auto after CI on `main`/`paperclip2`, or `workflow_dispatch`) |
| Registry images `dannyatalla/mining-*` | Registry images `dannyatalla/madsan-api`, `dannyatalla/madsan-frontend` (pull on VM; fallback build) |
| GitHub injects API keys at deploy | API keys in `madsan/deploy/.env` only |

## Routine deploy (manual)

```bash
cd /opt/madsan
git fetch origin
git checkout <tag-or-sha>
docker compose -f madsan/deploy/docker-compose.yml \
  -f madsan/deploy/docker-compose.prod.yml \
  --profile proxy --profile ais up -d --build
```

## Backups

Manual backup:

```bash
cd /opt/madsan && ./madsan/scripts/backup_db.sh
ls -lh backups/madsan_v2_pre_*.dump
```

Object-storage automated backup is **not** implemented yet.

Restore drill (non-prod DB): `madsan/scripts/restore_madsan_db.sh`, `agent_reports/madsan_v2_launch_checklist.md`.

## Rollback

See [rollback.md](./rollback.md). Never run `docker compose down -v` on prod.

Quick rollback:

```bash
cd /opt/madsan
git checkout <previous-good-sha>
docker compose -f madsan/deploy/docker-compose.yml \
  -f madsan/deploy/docker-compose.prod.yml \
  --profile proxy up -d --build
```

Restore DB from `backups/` only if schema/data regression requires it.

## Monorepo note (pre-split)

| Item | Monorepo (`/opt/madsan` = full repo) | Standalone (post-split) |
|------|--------------------------------------|-------------------------|
| Compose | `madsan/deploy/docker-compose.yml` | `deploy/docker-compose.yml` |
| Env | `madsan/deploy/.env` | `deploy/.env` |
| Scripts | `madsan/scripts/…` | `scripts/…` |

The deploy workflow auto-detects which layout is present on the VM.
