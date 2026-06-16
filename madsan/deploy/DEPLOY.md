# MadSan production deploy

**Production VM is Oracle Cloud aarch64 (`linux/arm64`)** — e.g. `ubuntu@129.159.141.101`, deploy path `/opt/madsan`. All registry images (`dannyatalla/madsan-api`, `dannyatalla/madsan-frontend`) and the prod PostGIS image must be **arm64-native**. Do not use `postgis/postgis:16-3.4` on prod (official image is amd64-only); the prod overlay defaults to `imresamu/postgis:16-3.6.1-bookworm`.

Standalone checkout path on the prod VM: **`/opt/madsan/`** (not `/opt/mining-map/madsan/`).

While MadSan still lives in the `mining-map` monorepo, clone the **full monorepo** to `/opt/madsan` and use compose paths under `madsan/deploy/`. After repo split, the same directory holds a MadSan-only checkout with `deploy/` at the repo root.

## DO NOT run legacy mining-map compose for MadSan

The monorepo also contains the **legacy Meridian/mining-map** stack (`backend`, `oil-live-intel-worker`, `uk-trade-manifest-sync-worker`, `eia-historic-sync-worker`, …) in repo-root `docker-compose.yml` / `docker-compose.prod.yml`. That stack is **not** MadSan.

| Wrong (builds ~14 legacy images as `madsan-*`) | Right (MadSan-only stack) |
|------------------------------------------------|---------------------------|
| `cd /opt/madsan && docker compose up -d --build` | `./madsan/scripts/compose_prod.sh --profile proxy up -d` |
| `COMPOSE_PROJECT_NAME=madsan docker compose -f docker-compose.prod.yml up -d` | `./madsan/scripts/compose_prod.sh --profile proxy up -d` |
| `docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml up -d` | `./madsan/scripts/compose_prod.sh --profile proxy pull` then `up -d` |

**MadSan prod services only:** `madsan-db`, `madsan-api`, `madsan-worker`, `madsan-scheduler`, `madsan-frontend`, `caddy` (+ optional `madsan-ais-ingest` with `--profile ais`).

**Not MadSan:** `backend`, `db`, `frontend`, `oil-live-intel-worker`, `uk-trade-manifest-sync-worker`, `eia-historic-sync-worker`, `oil-live-graph-sync-worker`, etc.

Compose project names are locked in YAML (`name: mining-map` / `name: madsan`), but **`COMPOSE_PROJECT_NAME` in the shell overrides the YAML `name` field**. Do not export `COMPOSE_PROJECT_NAME=madsan` in `.bashrc` or before repo-root compose. Use the wrapper scripts:

- MadSan prod: `./madsan/scripts/compose_prod.sh` (forces `-p madsan`)
- Legacy mining-map: `./scripts/mining_map_compose.sh` (forces `-p mining-map`)

If `/opt/madsan` is a symlink to `/opt/mining-map`, both paths point at the same repo — always use `./madsan/scripts/compose_prod.sh`, never bare `docker compose up` from that directory.

## Release pipeline (full chain)

Push to `main` / `master` / `paperclip2` with changes under `madsan/**` or `.github/workflows/madsan-*`:

```mermaid
flowchart TB
  subgraph trigger [Push to main with madsan changes]
    PUSH[git push]
  end

  subgraph ci [Stage 1 — CI gates parallel]
    BE[MadSan backend<br/>go vet test build]
    FE[MadSan frontend<br/>typecheck build]
    DK[MadSan Docker validate<br/>compose config + build no push]
  end

  subgraph publish [Stage 2 — Build and push linux/arm64]
    PUB[MadSan Docker publish]
    API_IMG["dannyatalla/madsan-api<br/>latest vN short_sha"]
    FE_IMG["dannyatalla/madsan-frontend<br/>latest vN short_sha"]
  end

  subgraph deploy [Stage 3 — SSH VM deploy]
    DEP[MadSan deploy]
    VM["docker compose pull + up<br/>IMAGE_TAG=vN"]
    HC[Health: db api worker scheduler frontend caddy + edge /health]
  end

  PUSH --> BE
  PUSH --> FE
  PUSH --> DK
  DK -->|workflow_run success| PUB
  PUB --> API_IMG
  PUB --> FE_IMG
  PUB -->|workflow_run success| DEP
  DEP --> VM --> HC
```

| Stage | Workflow file | What it does |
|-------|---------------|--------------|
| 1a | `.github/workflows/madsan-backend.yml` | CI gate only — **no Docker image** |
| 1b | `.github/workflows/madsan-frontend.yml` | CI gate only — **no Docker image** |
| 1c | `.github/workflows/madsan-docker.yml` | Validate compose YAML; build API + frontend locally (`push: false`) |
| 2 | `.github/workflows/madsan-publish.yml` | Build + push to Docker Hub (`DOCKER_USERNAME` / `DOCKER_PASSWORD`) |
| 3 | `.github/workflows/madsan-deploy.yml` | SSH to VM (`REMOTE_*`); stop legacy stack; `compose pull` + `up`; health checks |

Manual runs: `workflow_dispatch` on **MadSan Docker publish** or **MadSan deploy** (choose ref and `IMAGE_TAG`).

### Images pushed vs compose services

| Registry image | Built from | Compose service(s) | Notes |
|----------------|------------|-------------------|--------|
| `dannyatalla/madsan-api` | `madsan/deploy/Dockerfile.api` | `madsan-api`, `madsan-worker`, `madsan-scheduler`, `madsan-ais-ingest` | One image; different `command` per service (`/app/api`, `/app/worker`, `/app/scheduler`, `/app/ais-ingest`) |
| `dannyatalla/madsan-frontend` | `madsan/deploy/Dockerfile.frontend` | `madsan-frontend` | `NEXT_PUBLIC_API_URL` baked at publish |
| `imresamu/postgis:16-3.6.1-bookworm` (prod arm64) | — (multi-arch) | `madsan-db` | Official `postgis/postgis` is amd64-only; prod overlay uses `imresamu/postgis` on arm64 VMs |
| `caddy:2-alpine` | — (official) | `caddy` | `--profile proxy`; not built in CI |

Prod overlay (`docker-compose.prod.yml`) sets `IMAGE_TAG` (default `latest`; auto deploy uses `v<publish-run-number>`).

Automated deploy: **`.github/workflows/madsan-deploy.yml`** (repo root).

## GitHub secrets (repository Settings → Secrets)

MadSan deploy uses these **SSH and registry secrets** (repository Settings → Secrets):

| Secret | Purpose |
|--------|---------|
| `DOCKER_USERNAME` | Docker Hub login for `madsan-publish.yml` |
| `DOCKER_PASSWORD` | Docker Hub token/password for publish |
| `REMOTE_HOST` | VM hostname or IP |
| `REMOTE_SSH_KEY` | Private key for SSH user **ubuntu** (Oracle ARM VM rejects `opc`) |

Optional aliases (only if `REMOTE_*` is not set): `MADSAN_DEPLOY_HOST`, `MADSAN_DEPLOY_SSH_KEY`.

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
4. `git fetch` + `git checkout origin/main` (compose/deploy files; app images come from registry `IMAGE_TAG`)
5. Copy `madsan/deploy/.env.example` → `madsan/deploy/.env` **only when `.env` is missing** (never overwrites an existing file)
6. Run `madsan/scripts/seed_prod_volumes.sh` only when `madsan_raw_data` / `madsan_etl_data` volumes are empty
7. Stop legacy stack at `/opt/mining-map`, then `docker compose pull` / `up`

Prerequisites on the VM: Docker Engine + Compose v2, `git`, `curl`; deploy user in `docker` group (or passwordless `sudo` for legacy shutdown). `jq` is optional — health poll falls back to `sed` when absent.

**One-time VM permission note:** the deploy user needs **passwordless `sudo` for `mkdir` and `chown` under `/opt`** (bootstrap only), **or** an operator must pre-create the checkout directory before the first deploy:

```bash
sudo mkdir -p /opt/madsan
sudo chown ubuntu:ubuntu /opt/madsan   # match REMOTE_USER
```

If `sudo` is unavailable during bootstrap, the deploy script falls back to cloning into `$HOME/madsan` and symlinking `/opt/madsan` when possible; otherwise it uses `$HOME/madsan` for that run.

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
./madsan/scripts/compose_prod.sh --profile proxy up -d
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
| Push to `main` / `master` / `paperclip2` with `madsan/**` changes | **Stage 1:** backend + frontend + Docker validate (parallel) → **Stage 2:** publish to Docker Hub → **Stage 3:** SSH deploy (pull + up + health) |
| Push without `madsan/**` changes | No publish or deploy |
| Pull request | Never publishes or deploys |
| `workflow_dispatch` on publish / deploy | Manual registry push or VM deploy with chosen ref and `IMAGE_TAG` |

Deploy steps on the VM:

1. **Stop legacy mining-map stack** at `/opt/mining-map` (`docker compose -f docker-compose.prod.yml down --remove-orphans`; volumes preserved). Tries deploy user, then `sudo docker compose`, then `sudo docker-compose`. **Non-fatal** — warns and continues if shutdown fails (permissions, stack not running, or compose missing).
2. `git fetch` + `git checkout origin/main` (compose/deploy scripts; not the publish SHA)
3. `export IMAGE_TAG=v<publish-run>` (or `latest` / short SHA via manual dispatch)
4. `docker compose … pull` for `madsan-api`, `madsan-worker`, `madsan-scheduler`, `madsan-frontend` (and `madsan-ais-ingest` when `AISSTREAM_API_KEY` is set). Worker/scheduler/ais share the **same** `dannyatalla/madsan-api` image tag.
5. On pull failure, fallback: `docker compose … build --pull`
6. `docker compose … up -d --remove-orphans --wait` with profiles `proxy` and optionally `ais`
7. Health poll: `madsan-db`, `madsan-api`, `madsan-worker`, `madsan-scheduler`, `madsan-frontend`, `caddy` (+ `madsan-ais-ingest` when enabled)
8. Edge check: `curl http://127.0.0.1/health` (Caddy → API)
9. Migrations run via API (`MADSAN_RUN_MIGRATIONS=true` in compose)
10. Scoped image cleanup (see below)

**First run:** if `/opt/madsan` is missing or not a git checkout, deploy auto-bootstraps (clone or legacy symlink), creates `.env` from `.env.example` when absent, and seeds empty prod volumes. Existing `madsan/deploy/.env` on the VM is never overwritten.

## Enable live AIS on prod

Live AIS is **optional** and **off by default** until `AISSTREAM_API_KEY` is set in `madsan/deploy/.env` on the VM. Free key: [aisstream.io](https://aisstream.io/).

When the key is present (non-empty), `deploy_prod_vm.sh` and `compose_prod.sh` automatically add `--profile ais`, which starts `madsan-ais-ingest` (`/app/ais-ingest` in the shared `madsan-api` image). The API disables legacy 2-hop AIS sync when the key is set.

### Performance guardrails

| Concern | Behavior |
|---------|----------|
| **Map MVT / bbox** | Vessel tiles read `vessels` (GIST on `geom`, `last_seen_at` window) — **not** `ais_positions`. Ingest does not run inside the API container. |
| **DB writes** | `ais-ingest` upserts `vessels` per frame; `ais_positions` throttled to **≥90s per MMSI** (`MADSAN_AIS_POSITION_MIN_SEC`). Retention purge every 6h (`MADSAN_AIS_RETAIN_DAYS`, default 30). |
| **Scheduler** | `port_call_sweep` every 6h reads recent `ais_positions` — light batch; no change needed when enabling AIS. |
| **Resource limits** | Prod overlay: **512m** RAM, **0.5 CPU** (`MADSAN_AIS_INGEST_MEM_LIMIT`, `MADSAN_AIS_INGEST_CPUS` in `.env`). Total compose limits ~7.7 GiB with AIS on a ~23 GiB VM. |
| **Live WS** | API `LISTEN vessel_delta` from ingest NOTIFY — small extra API load; separate from tile path. |

**What to monitor after enable**

```bash
# Container health and memory (expect madsan-madsan-ais-ingest-1)
docker stats --no-stream madsan-madsan-ais-ingest-1 madsan-madsan-db-1 madsan-madsan-api-1
free -h

# Ingest logs (subscription boxes, reconnects, retention purge)
docker logs --tail 50 madsan-madsan-ais-ingest-1

# DB: recent positions and provider health (read-only)
docker exec madsan-madsan-db-1 psql -U postgres -d madsan_db -c \
  "SELECT source, status, observation_count, last_observation_at FROM maritime_source_health;"
docker exec madsan-madsan-db-1 psql -U postgres -d madsan_db -c \
  "SELECT COUNT(*) AS positions_24h FROM ais_positions WHERE ts > now() - interval '24 hours';"

# Map/API smoke
curl -fsS http://127.0.0.1/health
```

Rollback: remove or comment out `AISSTREAM_API_KEY` in `.env`, redeploy (ais container stops; `deploy_prod_vm.sh` skips `--profile ais`). Vessel rows already written remain; legacy sync can be re-enabled with `MADSAN_AIS_SYNC=true` only if you intentionally return to 2-hop mode.

### Coverage caveats (required UI honesty)

Open AIS via AISStream is **sparse in the Persian Gulf, Strait of Hormuz, and Gulf of Oman**. An empty vessel layer there is **limited provider coverage**, not proof of no traffic. The frontend and `/api/admin/health/runtime` already surface this disclaimer.

Ingest subscribes only to bounding boxes around terminal/port assets in `madsan_db` (not global AIS). Relevant tanker-like vessels near those assets are filtered server-side.

### Steps on the VM

1. Edit secrets on the host only (never commit):

   ```bash
   nano /opt/madsan/madsan/deploy/.env
   # AISSTREAM_API_KEY=<your key from aisstream.io>
   ```

2. Redeploy (GitHub **MadSan deploy** workflow, or on-VM):

   ```bash
   cd /opt/madsan
   ./madsan/scripts/deploy_prod_vm.sh
   # OR manual:
   ./madsan/scripts/compose_prod.sh --profile proxy pull
   ./madsan/scripts/compose_prod.sh --profile proxy up -d --wait
   ```

   `compose_prod.sh` adds `--profile ais` automatically when the key is non-empty; you do not need to pass `--profile ais` manually.

3. Verify `madsan-madsan-ais-ingest-1` is running and logs show `ais ingest subscribing to AISStream`.

**Current prod check (2026-06):** VM has `AISSTREAM_API_KEY` line in `.env` but **value is empty** — AIS ingest is correctly **not** running. Add the key, then redeploy.

### Optional ARM tuning (`.env`)

Only if `docker stats` shows pressure after 24–48h of live ingest:

| Variable | Default | Tighter on small ARM |
|----------|---------|----------------------|
| `MADSAN_AIS_INGEST_MEM_LIMIT` | `512m` | `384m` |
| `MADSAN_AIS_INGEST_CPUS` | `0.5` | `0.25` |
| `MADSAN_AIS_POSITION_MIN_SEC` | `90` | `120` (fewer `ais_positions` rows) |
| `MADSAN_AIS_RETAIN_DAYS` | `30` | `14` (smaller history table) |

Do not lower `MADSAN_DB_MEM_LIMIT` below `4g` while AIS is on unless you have measured headroom and accept slower tile queries under load.

## Image cleanup strategy

After a successful health check, the deploy script:

1. `docker image prune -f` — dangling layers only (safe on a shared VM)
2. Removes **unused** images labeled `com.docker.compose.project=madsan` (not referenced by any container)
3. `docker builder prune -f --filter until=48h` — old build cache

It does **not** run `docker image prune -a` and does **not** remove legacy mining images — only stops legacy **containers** before bring-up.

MadSan prod compose sets `name: madsan` in `madsan/deploy/docker-compose.yml`. Use `./madsan/scripts/compose_prod.sh` so paths and project name stay correct.

## Cutover from legacy mining-viz

| Legacy mining-viz | MadSan |
|-------------------|--------|
| Path `/opt/mining-map` | Path `/opt/madsan` |
| Manual VM deploy / legacy CI (removed) | Workflow `madsan-deploy.yml` (auto after CI on `main`/`paperclip2`, or `workflow_dispatch`) |
| Registry images `dannyatalla/mining-*` | Registry images `dannyatalla/madsan-api`, `dannyatalla/madsan-frontend` (pull on VM; fallback build) |
| GitHub injects API keys at deploy | API keys in `madsan/deploy/.env` only |

## Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| `docker ps` empty on the VM | Deploy never finished (failed at prepare env, checkout, pull, or health) | Check **MadSan deploy** workflow logs on GitHub Actions; re-run **MadSan deploy** with `workflow_dispatch`, ref **`main`**, and the intended `IMAGE_TAG` (e.g. `latest` or `v<N>` from publish) |
| Deploy fails at **prepare deploy env** | Missing or unreadable `madsan/deploy/.env`, or stale deploy script from an old git checkout | Confirm `/opt/madsan/madsan/deploy/.env` exists and is readable; fill in real secrets (not `.env.example` placeholders). Ensure VM checkout is on `origin/main` so compose scripts match current main |
| `.env` exists but stack still unhealthy | Placeholder values from `.env.example` (`MADSAN_DB_PASSWORD`, `MADSAN_JWT_SECRET`, etc.) | Edit `.env` on the host with production secrets; redeploy |
| Deploy fails at **compose up** / health poll | PostGIS platform mismatch, frontend not binding to 0.0.0.0, or Caddy not publishing host port 80 | Ensure VM is on latest `main` (PostGIS `imresamu/postgis:16-3.6.1-bookworm`, frontend `HOSTNAME=0.0.0.0`, Caddy `ports: !override` in prod overlay). `curl http://127.0.0.1/health` should return `{"status":"ok"}` |

Auto-deploy after publish pins **registry** tags (`IMAGE_TAG=v<N>`) but checks out **`origin/main`** for compose files — not the publish commit SHA. If a deploy ran before a workflow fix landed, re-run deploy manually with ref **`main`**.

## Routine deploy (manual)

```bash
cd /opt/madsan
git fetch origin
git checkout <tag-or-sha>
./madsan/scripts/compose_prod.sh --profile proxy --profile ais up -d
```

## Clean up stray legacy stack (mis-run with wrong compose)

If `docker compose build` showed `madsan-backend`, `madsan-oil-live-intel-worker`, or similar, the **repo-root** legacy stack was started with MadSan env — not the MadSan V2 stack.

```bash
# 1. Stop legacy containers (project mining-map; mis-runs may have used project madsan via COMPOSE_PROJECT_NAME)
cd /opt/mining-map   # or /opt/madsan if symlinked — same repo root
./scripts/mining_map_compose.sh -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true
docker compose -p madsan -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true

# 2. Bring up correct MadSan stack only
cd /opt/madsan
./madsan/scripts/compose_prod.sh --profile proxy up -d --remove-orphans

# 3. Verify — expect madsan-madsan-api-1, madsan-madsan-db-1, madsan-caddy-1 (not backend/oil-live-intel-worker)
./madsan/scripts/compose_prod.sh ps
curl -fsS http://127.0.0.1/health

# 4. Optional: remove unused mis-built images (does not delete volumes)
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^madsan-(backend|oil-live|uk-trade|eia-historic|db|frontend)-' || true
docker image prune -f
```

Do **not** run `docker compose down -v` unless you intend to wipe Postgres volumes.

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
./madsan/scripts/compose_prod.sh --profile proxy up -d
```

Restore DB from `backups/` only if schema/data regression requires it.

## Monorepo note (pre-split)

| Item | Monorepo (`/opt/madsan` = full repo) | Standalone (post-split) |
|------|--------------------------------------|-------------------------|
| Compose | `madsan/deploy/docker-compose.yml` | `deploy/docker-compose.yml` |
| Env | `madsan/deploy/.env` | `deploy/.env` |
| Scripts | `madsan/scripts/…` | `scripts/…` |

The deploy workflow auto-detects which layout is present on the VM.
