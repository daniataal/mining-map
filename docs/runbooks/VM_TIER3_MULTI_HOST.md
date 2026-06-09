# Tier-3 multi-host deploy — App VM + Ingest VM (+ optional DB host)

Split interactive traffic from heavy background ingest. Use **scale overlay** on the app
host and **ingest overlay** on a second VM when a single Tier-1/2 host cannot sustain
24/7 sync workers plus map/API load.

See also: [VM_APP_ONLY_DEPLOY.md](./VM_APP_ONLY_DEPLOY.md) (Tier-1/2 single host).

## Architecture

```
                         ┌─────────────────────────────────────┐
                         │           App VM (primary)           │
                         │  caddy → frontend                    │
                         │       → backend-a / backend-b        │
                         │       → oil-live-intel-a / -b        │
                         │  oil-live-intel-worker (live AIS)    │
                         │  db (Postgres)  redis  route-service │
                         │  [pgbouncer] (--profile pgbouncer)   │
                         └──────────────┬──────────────────────┘
                                        │ Postgres :5432 (private)
                                        │ optional :8095 graph-sync
                         ┌──────────────▼──────────────────────┐
                         │         Ingest VM (second host)      │
                         │  license / comtrade / ted / gov      │
                         │  graph-sync / uk-manifest / eia      │
                         │  oil-live-intel-worker (optional*)   │
                         │  redis (local)                       │
                         │  [elasticsearch + search-indexer]    │
                         └─────────────────────────────────────┘

  * Move AIS worker to ingest VM only if app VM is CPU-bound; default keeps it on App VM
    when using scale overlay without ingest overlay on the same host.

  Optional dedicated DB host: run Postgres on a third VM; App VM uses local pgbouncer
  or direct connection; both overlays set DB_HOST / DATABASE_URL to that host.
```

## When to use which overlay

| Goal | Compose command |
|------|-----------------|
| Tier-1 interactive only (4 vCPU) | `docker-compose.prod.yml` + `docker-compose.prod.app.yml` |
| Tier-3 horizontal app scale (8+ vCPU) | `...app.yml` + `docker-compose.prod.scale.yml` |
| Tier-3 dedicated ingest host | `docker-compose.prod.yml` + `docker-compose.prod.ingest.yml` |
| PgBouncer on app host | add `--profile pgbouncer` to scale command |

Do **not** combine `docker-compose.prod.ingest.yml` with `docker-compose.prod.app.yml` on
the same machine — they target different hosts.

## Deploy order

1. **App VM** — Postgres, Redis, core stack (or restore DB volume from backup).
2. **Firewall** — allow Ingest VM → App VM `5432/tcp` (Postgres). If graph-sync calls
   Go admin routes on the app host, allow Ingest VM → App VM `8095/tcp` (or route via
   private network / VPN only; do not expose Postgres publicly).
3. **App VM scale** — pull images, bring up scale stack, verify Caddy health.
4. **Ingest VM** — copy repo, `backend.env`, data mounts (`data/eia_downloads`,
   `data/uk_trade_manifests`, etc.), set remote DB env, start ingest overlay.
5. **Optional search** — on Ingest VM: `--profile search` (Elasticsearch + indexer).

## Connection strings

Set on **Ingest VM** before `up`:

```bash
export DB_HOST=10.0.0.10          # App VM private IP (or dedicated DB host)
export DB_PORT=5432
export DB_NAME=mining_db
export DB_USER=postgres
export DB_PASSWORD='***'          # from backend.env — never commit
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=disable"
export OIL_INTEL_API_URL="http://10.0.0.10:8095"   # App VM Go API for graph-sync
```

On **App VM** with PgBouncer (`--profile pgbouncer`):

```bash
export SCALE_DB_HOST=pgbouncer
export SCALE_DB_PORT=5432
export SCALE_DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@pgbouncer:5432/mining_db?sslmode=disable"
```

Without PgBouncer, scale overlay defaults to `db:5432` inside the compose network.

Python workers on ingest use `DB_HOST` / `DB_PORT`; Go worker and search indexer use
`DATABASE_URL`.

## App VM commands

```bash
export VERSION_TAG=v<run>
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml pull

docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml up -d

# With pooler (recommended at scale):
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml --profile pgbouncer up -d
```

## Ingest VM commands

```bash
export VERSION_TAG=v<run>
# DB_* and DATABASE_URL as above

docker compose -f docker-compose.prod.yml -f docker-compose.prod.ingest.yml pull
docker compose -f docker-compose.prod.yml -f docker-compose.prod.ingest.yml up -d

# Full-text search indexing on ingest host:
docker compose -f docker-compose.prod.yml -f docker-compose.prod.ingest.yml \
  --profile search up -d
```

## Firewall checklist

| Source | Destination | Port | Purpose |
|--------|-------------|------|---------|
| Ingest VM | App VM (or DB host) | 5432 | Postgres writes/reads |
| Ingest VM | App VM | 8095 | graph-sync → oil-live-intel (optional) |
| Users | App VM | 8080/8443 | Caddy HTTP(S) |
| App VM | Internet | 443 | AIS, Comtrade, EIA, etc. |

Block `5432` from the public internet. Prefer VPC/private networking between VMs.

## Verify

**App VM:**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.app.yml \
  -f docker-compose.prod.scale.yml ps
curl -sf http://localhost:8080/ >/dev/null && echo caddy ok
curl -sf http://localhost:8095/api/oil-live/health/live && echo oil-live direct ok
# Repeat curl to Caddy /api/oil-live/health/live — should hit a/b instances
```

**Ingest VM:**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.ingest.yml ps
docker compose -f docker-compose.prod.yml -f docker-compose.prod.ingest.yml logs -f --tail=20 \
  comtrade-sync-worker
```

**Compose config (CI / preflight):**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.scale.yml config >/dev/null
docker compose -f docker-compose.prod.yml -f docker-compose.prod.ingest.yml config >/dev/null
```

## Postgres read replica (manual)

For read-heavy map queries without adding app code yet:

1. On **primary** (App VM `db`), enable replication (`wal_level=replica`, replication slot,
   `pg_hba.conf` entry for replica IP).
2. On **replica host**, run `pg_basebackup` or provider snapshot restore; start Postgres
   in hot-standby mode.
3. Point read-only clients at replica `:5432` (never run migrations against replica).

Future Go hook (not wired by default): set `OIL_INTEL_DATABASE_READ_URL` to the replica
DSN and teach `oil-live-intel` to route SELECT-heavy handlers to a second pool. Until
that lands, use PgBouncer on the primary or scale `oil-live-intel-a/b` only.

Example replica DSN (documentation only):

```bash
OIL_INTEL_DATABASE_READ_URL="postgresql://postgres:***@10.0.0.11:5432/mining_db?sslmode=disable"
```

## Rollback

| Change | Rollback |
|--------|----------|
| Scale overlay | Omit `docker-compose.prod.scale.yml`; single `oil-live-intel` + `backend` return |
| Ingest VM | `docker compose ... down` on ingest host; app VM unchanged |
| PgBouncer | Drop `--profile pgbouncer`; unset `SCALE_*` URLs |
| Multi-host | Stop ingest VM; run `--profile ingest` on app during maintenance window |

## Capacity notes

| Host | vCPU / RAM | Overlays |
|------|------------|----------|
| Tier-1 | 4 / 8 GB | `app.yml` only |
| Tier-3 app | 8+ / 16 GB | `app.yml` + `scale.yml` |
| Tier-3 ingest | 4–8 / 8–16 GB | `ingest.yml` |
| Tier-3 + search | ingest +2 GB | `ingest.yml --profile search` |

Ingest VM carries spiky CPU during Comtrade/EIA/graph-sync; keeping it off the app host
preserves interactive latency for map pan/zoom and maritime live view.
