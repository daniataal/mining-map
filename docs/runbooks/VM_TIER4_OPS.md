# Tier-4 VM ops — scheduled ingest, CDN headers, pooling, health probes

Complements [Tier-1 app-only deploy](./VM_APP_ONLY_DEPLOY.md) and the Tier-3 scale overlay
(`docker-compose.prod.scale.yml`). Target host: **8+ vCPU / 16 GB RAM** with interactive +
off-peak ingest split (~**30–60 concurrent** map/API users when scale + Redis are enabled).

## Compose stack (Tier 1 + 2 + 3 + 4)

```bash
export VERSION_TAG=v<run>
cd /opt/mining-map

docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml \
  pull

docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml \
  up -d
```

| Tier | File | What it adds |
|------|------|--------------|
| 1 | `docker-compose.prod.app.yml` | Core always-on; `ingest` / `search` profiles |
| 2 | (same overlay) | Redis cache + rate limits |
| 3 | `docker-compose.prod.scale.yml` | Dual backend + Go replicas, `Caddyfile.scale` LB |
| 4 | (same scale file) | **PgBouncer** default; cron scripts; CDN cache headers |

Optional **ingest VM** (workers only): `docker-compose.prod.ingest.yml` on a second host —
see scale file header and [env.tier4.example](./env.tier4.example).

Env template (placeholders only): [env.tier4.example](./env.tier4.example)

### Rollback

Remove `docker-compose.prod.scale.yml` from the compose command. Optionally disable pooler while
keeping scale replicas:

```bash
export SCALE_DB_HOST=db SCALE_DATABASE_URL=postgresql://postgres:password@db:5432/mining_db?sslmode=disable
```

### Caddy (scale tier)

With scale overlay, Caddy mounts `Caddyfile.scale` (includes CDN cache headers for static assets).

## 1. Scheduled ingest (cron)

Scripts live in `scripts/`:

| Script | Purpose |
|--------|---------|
| `vm-ingest-sync.sh` | One-shot graph-sync (curl) or temporary `--profile ingest` workers |
| `vm-ingest-cron.example` | Example crontab lines |
| `vm-health-check.sh` | Lightweight HTTP probes for monitoring |

### Graph-sync (preferred — no workers left running)

```bash
cd /opt/mining-map
./scripts/vm-ingest-sync.sh graph-sync
```

Uses `POST /api/admin/oil-live/graph-sync` with `ADMIN_TOKEN` from `backend.env` (600s default
timeout). Default URL is Caddy `:8080` (works with Tier-3 scale where `backend:8000` is not
host-published). Override with `VM_GRAPH_SYNC_URL`.

### Compose ingest window (all sync workers)

```bash
VM_INGEST_WAIT_SECONDS=7200 ./scripts/vm-ingest-sync.sh compose-ingest
```

Starts ingest-profile workers, waits, then stops them — frees CPU for interactive traffic.

### Weekly license sync

```bash
VM_INGEST_LICENSE_WAIT_SECONDS=3600 ./scripts/vm-ingest-sync.sh license-sync
```

Runs only `license-sync-worker` for one hour, then stops.

### Install crontab

```bash
sudo mkdir -p /var/log/mining-map
sudo chown "$USER" /var/log/mining-map
crontab -e
# paste lines from scripts/vm-ingest-cron.example (adjust MINING_MAP_ROOT)
```

Off-peak defaults in the example:

- **02:00 daily** — graph-sync curl
- **03:30 Sunday** — license-sync compose window
- **Every 5 min** — health check

## 2. Static asset / CDN-ready headers

### Nginx (frontend container)

`mining-viz/nginx.prod.conf`:

- `/assets/*` — `Cache-Control: public, max-age=31536000, immutable`
- `/index.html` — `no-cache, must-revalidate`
- Other static extensions — 7d immutable fallback

Rebuild/publish frontend image after nginx changes.

### Caddy (browser entry :8080)

`Caddyfile` includes `@static_assets` and `@spa_shell` handlers (mirrored in `Caddyfile.edge`
for copy/paste). Place a CDN or reverse proxy in front of `:8080`; origin sends correct
`Cache-Control` for hashed Vite assets.

**Verify:**

```bash
curl -sI http://localhost:8080/assets/ | grep -i cache-control
curl -sI http://localhost:8080/index.html | grep -i cache-control
```

## 3. Postgres connection pooling (PgBouncer)

Enabled by default in `docker-compose.prod.scale.yml`:

- **Pool mode:** `transaction` (compatible with SQLAlchemy + Go `database/sql` short transactions)
- **Service:** `pgbouncer:5432` inside compose network
- **Postgres:** still `db:5432` (PgBouncer connects upstream)

Tune via env (see [env.tier4.example](./env.tier4.example)):

- `PGBOUNCER_MAX_CLIENT_CONN` (default 200)
- `PGBOUNCER_DEFAULT_POOL_SIZE` (default 25)

**Verify:**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml ps pgbouncer
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml exec backend printenv DB_HOST
# expect: pgbouncer
```

If you see `too many connections` without the scale overlay, the commented PgBouncer block in
`docker-compose.prod.app.yml` remains available as a manual opt-in on Tier-1 only.

## 4. Observability / alerting

### Health probe

```bash
./scripts/vm-health-check.sh
echo $?   # 0 = all probes OK, 1 = at least one failure
```

Probes:

| Target | URL |
|--------|-----|
| backend | `http://127.0.0.1:8000/docs` |
| oil-live-intel | `http://127.0.0.1:8095/api/oil-live/health/live` |
| caddy (user path) | `http://127.0.0.1:8080/api/oil-live/health/live` |

### Alerting suggestions (wire externally)

- **Cron / systemd timer:** run `vm-health-check.sh` every 1–5 min; page on non-zero exit.
- **Uptime monitor:** HTTP GET Caddy `/api/oil-live/health/live` from outside the VM.
- **Ingest failures:** grep `/var/log/mining-map/graph-sync.log` for non-200 or stack traces;
  alert if daily 02:00 job missing success line for 2 consecutive days.
- **Postgres:** alert on `pgbouncer` container not healthy or `mining-db` restarts.
- **Disk:** `/var/lib/docker` and log dir `/var/log/mining-map` — graph-sync logs can grow.

Deep diagnostics (graph-sync POST, DB counts, key parity): `./scripts/vm-live-data-diagnose.sh`

## Capacity (Tier 3 + 4 together)

| Layer | Approx. | Notes |
|-------|---------|-------|
| Core + scale | 6–8 GB | PgBouncer + 4 Uvicorn workers + Go pools |
| + Redis (Tier 2) | +128 MB | Hot map reads |
| Ingest (off-peak) | +1–2 GB spiky | Cron window only — not 24/7 on scale tier |

**Concurrent users:** ~30–60 interactive sessions with map pan/zoom + dossier reads when Redis
cache is warm and ingest runs off-peak. Heavy route planning or agent export bursts still share
the same 8 vCPU — monitor `RATE_LIMIT_*` 429s and Postgres pool saturation.

## Related runbooks

- [VM_APP_ONLY_DEPLOY.md](./VM_APP_ONLY_DEPLOY.md) — Tier 1/2 baseline
- [GEM_GULF_VM_INGEST.md](./GEM_GULF_VM_INGEST.md) — GEM workbook placement
- [env.tier4.example](./env.tier4.example) — non-secret env placeholders
