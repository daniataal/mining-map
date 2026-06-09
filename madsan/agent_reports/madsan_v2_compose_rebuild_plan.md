# Compose Rebuild Plan

**Status (2026-06-09):** Dev stack implemented. Run `./madsan/scripts/compose_up.sh`.

## Stack (`madsan/deploy/`)

| Service | Role | Host port |
|---------|------|-----------|
| madsan-db | PostGIS 16 | 5433 |
| madsan-api | Go API + AIS sync + migrations | 8088 |
| madsan-worker | Ingestion job drain | — |
| madsan-scheduler | Cron enqueue | — |
| madsan-frontend | Next.js standalone | 3001 |
| caddy (`--profile proxy`) | Reverse proxy + WS | 9080 |

## Commands

```bash
./madsan/scripts/compose_up.sh              # full stack
./madsan/scripts/compose_up.sh --proxy        # + Caddy :9080
./madsan/scripts/compose_up.sh madsan-db    # DB only (hybrid)
./madsan/scripts/compose_down.sh              # stop, keep volumes
```

Copy `deploy/.env.example` → `deploy/.env` for secrets and `LEGACY_DATABASE_URL`.

## Legacy bridge

- `LEGACY_DATABASE_URL` → `host.docker.internal:5434` (mining-db on host)
- Python ETL not in compose; Go worker handles `legacy_import`
- Old `mining-map` compose unchanged

## Volumes

- `madsan_postgres_data` — separate from `mining-map_postgres_data`
- **Never** `docker compose down -v` in production

## Remaining (prod)

- Resource limits / `docker-compose.prod.yml`
- Observability sidecar
- River queue worker (optional replacement for Postgres poll)
