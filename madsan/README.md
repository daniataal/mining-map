# MadSan Intelligence V2 (greenfield)

Go + Postgres/PostGIS intelligence terminal alongside legacy `mining-map`. North star: **discover → verify → price → execute**.

## Quick start

### Option A — Full Docker stack (recommended for parity)

```bash
cp madsan/deploy/.env.example madsan/deploy/.env   # optional
./madsan/scripts/compose_up.sh
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3001 |
| API | http://localhost:8088 |
| Postgres | `localhost:5433` / `madsan_db` |

With Caddy single entry: `./madsan/scripts/compose_up.sh --proxy` → http://localhost:9080

Stop (keeps data): `./madsan/scripts/compose_down.sh`

### Option B — Hybrid dev (DB in Docker, Go/Node on host)

```bash
./madsan/scripts/dev_bootstrap.sh    # db + migrations + seed job
./madsan/scripts/start_api.sh        # :8088
cd madsan/backend && go run ./cmd/worker
cd madsan/frontend && npm run dev    # :3000
```

Open http://localhost:3000 — terminal map, ⌘K search, `/deals`, `/admin`.

**Requires** legacy `mining-db` on `:5434` for AIS sync and legacy import (`host.docker.internal:5434` from containers).

## Environment

| Variable | Default |
|----------|---------|
| `DATABASE_URL` | `postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable` |
| `LEGACY_DATABASE_URL` | `postgresql://postgres:password@127.0.0.1:5434/mining_db?sslmode=disable` |
| `MADSAN_AIS_SYNC` | `true` |
| `MADSAN_LEGACY_PYTHON` | `false` (Go import default) |
| `EIA_API_KEY` | optional — EIA v2 daily WTI/Brent spot for ticker; omit for honest `reference_stub` fallback |

## Backfill commands

```bash
cd madsan/backend
go run ./cmd/backfill-evidence
go run ./cmd/backfill-relationships
go run ./cmd/backfill-signals
go run ./cmd/backfill-vessel-links
go run ./cmd/scan-company-duplicates
```

## API highlights

- `GET /api/core/ticker` — benchmark quotes (`eia_open_data` when `EIA_API_KEY` set; else `reference_stub`)
- `GET /api/core/search?q=` — global search
- `GET /api/core/entities/{type}/{id}` — dossier
- `POST /api/deals/verify` — deal DD + sanctions
- `GET /api/admin/dedup/companies` — duplicate company clusters
- `POST /api/admin/dedup/companies/scan` — enqueue duplicate clusters for review
- `POST /api/admin/review-queue/{id}/resolve` — merge (`canonical_company_id`) or dismiss duplicate review items

## Docs

- [Execution log](agent_reports/madsan_v2_execution_log.md)
- [Roadmap status](agent_reports/madsan_v2_roadmap_status.md)
- [Dedup strategy](agent_reports/deduplication_strategy.md)

## Honest tiers

- AIS: limited Gulf provider coverage
- Vessel–terminal links: inferred from destination/proximity
- Ticker: EIA daily crude spot when `EIA_API_KEY` set; VLSFO/Gold remain reference stubs
- OpenSanctions: review leads, not confirmed designations
