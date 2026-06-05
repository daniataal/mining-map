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
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml ps | grep -E 'sync|indexer'
```
