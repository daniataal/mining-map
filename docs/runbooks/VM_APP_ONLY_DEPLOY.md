# Tier-1 VM — app-only deploy (4 vCPU ARM)

Use when the host should serve the map, dossiers, and live maritime API without running
all background ingest workers continuously.

## Compose files

| Mode | Command |
|------|---------|
| Interactive core | `docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml up -d` |
| + ingest workers | `... --profile ingest up -d` |
| + Elasticsearch | `... --profile search up -d` |
| Full overlay | `... --profile ingest --profile search up -d` |

Pull before deploy (same as prod):

```bash
export VERSION_TAG=v<run>
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml pull
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml up -d
```

Rollback: drop the overlay file from the command (reverts to full `docker-compose.prod.yml` behavior).

## Always-on services (core)

- `db`, `redis`, `caddy`
- `backend`, `route-service`, `frontend`
- `oil-live-intel`, `oil-live-intel-worker` (live AIS + Go API)

## Profile `ingest` (off by default)

- `license-sync-worker`, `comtrade-sync-worker`, `ted-procurement-worker`
- `gov-procurement-sync-worker`, `oil-live-graph-sync-worker`
- `uk-trade-manifest-sync-worker`, `eia-historic-sync-worker`
- `oil-live-search-indexer` (requires `--profile search` for Elasticsearch; see below)

Start ingest during a maintenance window, then stop to free CPU:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml --profile ingest up -d
# after sync completes
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml stop \
  license-sync-worker comtrade-sync-worker ted-procurement-worker \
  gov-procurement-sync-worker oil-live-graph-sync-worker \
  uk-trade-manifest-sync-worker eia-historic-sync-worker oil-live-search-indexer
```

One-shot graph sync without leaving workers up:

```bash
curl -X POST http://localhost:8000/api/admin/oil-live/graph-sync
```

## Profile `search` (optional)

- `elasticsearch` (~512 MB heap in base prod compose)

Pair with `--profile ingest` when running `oil-live-search-indexer`:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml \
  --profile ingest --profile search up -d
```
Set `vm.max_map_count=262144` before enabling Elasticsearch (see header comment in
`docker-compose.prod.yml`).

Without `search`, map and API work; full-text search endpoints may be empty or degraded.
Do not run `oil-live-search-indexer` without Elasticsearch (enable both profiles).

## Capacity notes (4 vCPU ARM, ~8 GB RAM target)

| Layer | Approx. RAM | Notes |
|-------|-------------|-------|
| Core stack | 4–5 GB | Postgres, backend, route-service (2 GB cap), oil-live-intel ×2, frontend, redis, caddy |
| + `ingest` | +1–2 GB | Spiky during Comtrade/EIA/graph-sync; avoid running all ingest workers 24/7 on Tier-1 |
| + `search` | +0.7–1 GB | ES JVM 512 MB + indexer |

**CPU:** Reserve ~2 vCPU for interactive path (backend + map frontend + oil-live-intel).
Ingest workers are I/O-bound and can contend with route planning; run `ingest` off-peak.

**Connection budget:** Overlay sets `UVICORN_WORKERS=2` and `OIL_INTEL_DB_MAX_CONNS=10` on Go
services. Override via env if needed. Optional commented `pgbouncer` profile in the overlay if
Postgres hits `max_connections`.

**When to scale up:** Move to full `docker-compose.prod.yml` (no overlay) or add
`docker-compose.prod.large-vm.yml` on a ≥16 GB host if Elasticsearch + all workers must run
continuously.

## Verify

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml ps
curl -sf http://localhost:8000/docs >/dev/null && echo backend ok
curl -sf http://localhost:8095/api/oil-live/health/live && echo oil-live-intel ok
curl -sf http://localhost:8080/ >/dev/null && echo caddy ok
```

With `--profile ingest`, confirm workers are running:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml --profile ingest ps | grep -E 'sync|indexer'
```

## Tier 2 — Redis cache and rate limits

Optional scalability layer for repeated map reads and protection of expensive Python routes.
Enabled in `docker-compose.prod.app.yml` when Redis is running.

### Environment variables

| Service | Variable | Default (app overlay) | Purpose |
|---------|----------|----------------------|---------|
| `oil-live-intel` | `REDIS_URL` or `OIL_INTEL_REDIS_URL` | `redis://redis:6379/1` | Hot GET response cache; unset = cache off |
| `backend` | `REDIS_HOST` | `redis` | Rate limit counters (falls back to in-memory if down) |
| `backend` | `RATE_LIMIT_ENABLED` | `1` | Set `0` to disable rate limits |
| `backend` | `RATE_LIMIT_RPM` | `30` | AI/agent + bulk export routes per client per minute |
| `backend` | `RATE_LIMIT_ROUTE_RPM` | `60` | `/api/routing/*` per client per minute |

**Cached Go paths** (fail-open if Redis unavailable): `licenses/country-summary`,
`map/country-borders`, `intelligence/country/{country}` (TTL ~120s),
`maritime/stats` (TTL 30s). Existing `Cache-Control` headers are preserved.

**Rate-limited Python paths:** `/api/agents/*`, `/api/routing/*`, `/licenses/export`,
`/api/deal-rooms/{id}/export(.pdf)`. Returns HTTP 429 with an honest message when exceeded.

### Expected capacity gain

- **Map pan/zoom:** Repeat viewport requests hit Redis instead of Postgres for country
  summaries and borders — typically 2–5× lower DB load during active map sessions.
- **Maritime stats banner:** 30s Redis TTL cuts repeated health queries during live view.
- **Abuse protection:** Agent and route planner calls capped per IP or JWT, reducing CPU
  spikes from scripted traffic on a 4 vCPU VM.

### Rollback

No redeploy required — disable via env and restart affected containers:

```bash
# Disable Go response cache
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml exec oil-live-intel sh -c 'unset REDIS_URL OIL_INTEL_REDIS_URL'

# Or in compose / .env:
REDIS_URL=
RATE_LIMIT_ENABLED=0

docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml up -d backend oil-live-intel
```

Removing `docker-compose.prod.app.yml` from the compose command reverts Tier-1 and Tier-2
overlay settings together.

### Verify Tier 2 locally

```bash
# Go cache (second request should include X-Cache: HIT when Redis is up)
curl -s -D - "http://localhost:8095/api/oil-live/maritime/stats" -o /dev/null | grep -i x-cache

# Rate limit (429 after exceeding RATE_LIMIT_RPM)
RATE_LIMIT_ENABLED=1 REDIS_HOST=redis pytest backend/tests/test_rate_limit.py -q
```

## Tier 3 — Scale overlay (8+ vCPU / ~16 GB)

Horizontal scale for busier app VMs: dual `backend-a`/`backend-b` and
`oil-live-intel-a`/`oil-live-intel-b` behind Caddy round-robin (`Caddyfile.scale`).
Optional second **ingest VM** uses [`docker-compose.prod.ingest.yml`](../../docker-compose.prod.ingest.yml).

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml up -d
```

| Setting | Default (scale overlay) | Purpose |
|---------|-------------------------|---------|
| `UVICORN_WORKERS` | 3 per backend replica | Parallel Python API |
| `OIL_INTEL_DB_MAX_CONNS` | 8 per Go replica | Go pool per process |
| `RATE_LIMIT_RPM` | 60 | Multi-tab headroom |
| Backend / Go replicas | 2 each | Caddy load balance |

**Expected capacity:** ~30–60 concurrent interactive users when Tier-2 Redis is warm and ingest
runs off-peak (cron or separate ingest VM). Route planning and agent exports remain CPU-heavy.

**Rollback:** omit `docker-compose.prod.scale.yml` from the compose command.

## Tier 4 — Ops automation, CDN headers, PgBouncer

See **[VM_TIER4_OPS.md](./VM_TIER4_OPS.md)** for full detail. Summary:

| Deliverable | Location |
|-------------|----------|
| Scheduled graph-sync / license cron | `scripts/vm-ingest-sync.sh`, `scripts/vm-ingest-cron.example` |
| Health probe (monitoring exit code) | `scripts/vm-health-check.sh` |
| PgBouncer (default with scale overlay) | `docker-compose.prod.scale.yml` |
| CDN-ready cache headers | `mining-viz/nginx.prod.conf`, `Caddyfile`, `Caddyfile.scale`, `Caddyfile.edge` |
| Ingest-only second VM | `docker-compose.prod.ingest.yml` |
| Env placeholders | [env.tier4.example](./env.tier4.example) |

**Compose (Tier 1 + 2 + 3 + 4):**

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml up -d
```

Off-peak ingest via cron (graph-sync 02:00, license sync weekly) keeps CPU for interactive
traffic while maintaining data freshness. Target **~30–60 concurrent** sessions with scale +
ingest split on an 8 vCPU / 16 GB host.
