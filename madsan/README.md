# MadSan Intelligence V2 (greenfield)

Go + Postgres/PostGIS intelligence terminal alongside legacy `mining-map`. North star: **discover → verify → price → execute**.

## Quick start

### Option A — Full Docker stack (recommended for parity)

```bash
cp madsan/deploy/.env.example madsan/deploy/.env   # required — canonical env (no parent .env)
./madsan/scripts/compose_up.sh
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3001 |
| API | http://localhost:8088 |
| Postgres | `localhost:5433` / `madsan_db` |

With Caddy single entry: `./madsan/scripts/compose_up.sh --proxy` → http://localhost:9080

Live AIS ingest (`madsan-ais-ingest`) starts automatically when `AISSTREAM_API_KEY` is set in `deploy/.env`; otherwise add `--ais` or use legacy sync via `LEGACY_DATABASE_URL`.

Stop (keeps data): `./madsan/scripts/compose_down.sh`

### Option B — Hybrid dev (DB in Docker, Go/Node on host)

```bash
./madsan/scripts/dev_bootstrap.sh    # db + migrations + seed job
./madsan/scripts/start_api.sh        # :8088
cd madsan/backend && go run ./cmd/worker
cd madsan/frontend && npm run dev    # :3000
```

Open http://localhost:3000 — terminal map, ⌘K search, `/deals`, `/admin`.

**Requires** legacy `mining-db` on host port `:5434` for AIS sync and legacy import.

**Environment:** `madsan/deploy/.env` is the source of truth. Copy from `madsan/deploy/.env.example` and edit locally. The monorepo helper `./madsan/scripts/sync_env_from_root.sh` is deprecated (one-way migration only; never prints values).

### `LEGACY_DATABASE_URL` — hybrid vs Compose

| Mode | Where API runs | `deploy/.env` value | Compose override |
|------|----------------|---------------------|------------------|
| **Hybrid dev** | Host (`start_api.sh`, `go run ./cmd/worker`) | `127.0.0.1:5434` | — |
| **Full Docker stack** | `madsan-api` container | same file; compose substitutes | `host.docker.internal:5434` in `docker-compose.yml` |

Hybrid default: `postgresql://postgres:password@127.0.0.1:5434/mining_db?sslmode=disable`

For hybrid dev, set `LEGACY_DATABASE_URL` to `127.0.0.1:5434` in `deploy/.env` (not Docker hostname `db`).

## Environment (`madsan/deploy/.env`)

Copy `madsan/deploy/.env.example` → `madsan/deploy/.env`. API, worker, and compose scripts load this file automatically.

| Variable | Required | Default / notes |
|----------|----------|-----------------|
| `DATABASE_URL` | yes | `postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable` |
| `MADSAN_DB_PASSWORD` | yes (compose) | `password` |
| `MADSAN_JWT_SECRET` | yes | change in production |
| `NEXT_PUBLIC_API_URL` | yes (frontend) | `http://localhost:8088` |
| `LEGACY_DATABASE_URL` | yes (AIS/import) | `127.0.0.1:5434` hybrid; compose overrides to `host.docker.internal` |
| `MADSAN_AIS_SYNC` | no | `true` when no `AISSTREAM_API_KEY`; `false` when key set (run `cmd/ais-ingest`) |
| `AISSTREAM_API_KEY` | no | enables direct AIS; disables API legacy 2-hop sync by default |
| `MADSAN_LEGACY_PYTHON` | no | `false` (Go import default) |
| `MADSAN_RAW_DIR` | no | unset — auto-detects `madsan/raw` via go.mod |
| `EIA_API_KEY` | no | EIA v2 daily WTI/Brent spot for ticker |
| `OPENSANCTIONS_API_KEY` | no | deal sanctions screening |
| `MADSAN_SHIPVAULT_ENABLED` | no | vessel registry enrichment |

GEM trackers: place `.xlsx` files in `madsan/data/gem/` (see `madsan/data/gem/README.md`).

## Backfill commands

```bash
cd madsan/backend
go run ./cmd/backfill-evidence
go run ./cmd/backfill-relationships
go run ./cmd/backfill-signals
go run ./cmd/backfill-vessel-links
go run ./cmd/scan-company-duplicates
```

### Legacy parity (Phase 4e)

Compares legacy `mining_db` row counts with `madsan_db` for each Go import table. Prints JSON to stdout; exits **1** when critical tables drift beyond threshold (default **5%**, override with `MADSAN_PARITY_THRESHOLD_PCT`).

```bash
cd madsan/backend
go run ./cmd/legacy-parity
```

Requires `DATABASE_URL` (madsan `:5433`) and `LEGACY_DATABASE_URL` (legacy `:5434`). Critical tables: `oil_vessels`, `licenses`, `petroleum_osm_features`. `oil_companies` is informational (name dedup lowers madsan count).

Sample output shape:

```json
{
  "checked_at": "2026-06-09T12:00:00Z",
  "threshold_pct": 5,
  "passed": true,
  "tables": [
    {
      "legacy_table": "oil_vessels",
      "madsan_target": "vessels",
      "legacy_count": 9627,
      "madsan_count": 9627,
      "drift": 0,
      "drift_pct": 0,
      "critical": true,
      "ok": true,
      "note": "madsan may exceed legacy when live AIS sync is enabled"
    }
  ]
}
```

### Petroleum asset type backfill

Fixes misclassified petroleum OSM rows still stored as `processing_plant` (pre–layer_id filter). Only touches assets with petroleum provenance (`legacy_table` or `commodities_supported`).

```bash
cd madsan/backend
go run ./cmd/backfill-petroleum-types --dry-run
go run ./cmd/backfill-petroleum-types --limit 1000
go run ./cmd/backfill-petroleum-types
```

Refreshes `map_energy_assets` and `map_metals_assets` after a non–dry-run run.

## API highlights

- `GET /api/core/ticker` — benchmark quotes (`eia_open_data` when `EIA_API_KEY` set; else `reference_stub`)
- `GET /api/core/search?q=` — global search
- `GET /api/core/entities/{type}/{id}` — dossier
- `POST /api/deals/verify` — deal DD + sanctions
- `GET /api/admin/dedup/companies` — duplicate company clusters
- `POST /api/admin/dedup/companies/scan` — enqueue duplicate clusters for review
- `POST /api/admin/review-queue/{id}/resolve` — merge (`canonical_company_id`) or dismiss duplicate review items
- `GET /api/admin/health/runtime` — AIS sync stats + cached legacy parity drift (auth required; also on `/admin` UI)

## Standalone repo roadmap

MadSan is migrating out of the `mining-map` monorepo to a standalone checkout (`/opt/madsan/`). The **master exit checklist** covers data migration, repo decoupling, ops, and honest product boundaries:

**[docs/STANDALONE_MIGRATION.md](docs/STANDALONE_MIGRATION.md)**

Honest status today: only **~4 of ~95** legacy tables are imported into `madsan_db`; Price pillar is empty; AIS may still use a legacy 2-hop path unless `AISSTREAM_API_KEY` is set. Full measured inventory: [agent_reports/legacy_migration_audit.md](agent_reports/legacy_migration_audit.md).

## Docs

- [Standalone migration checklist](docs/STANDALONE_MIGRATION.md)
- [Legacy ETL deprecation](docs/LEGACY_ETL_DEPRECATION.md)
- [Execution log](agent_reports/madsan_v2_execution_log.md)
- [Roadmap status](agent_reports/madsan_v2_roadmap_status.md)
- [Dedup strategy](agent_reports/deduplication_strategy.md)

## k6 smoke (Phase 13)

Minimal load gate: `GET /health` and one MVT tile (`/tiles/{layer}/{z}/{x}/{y}.mvt`).

```bash
# Dev API direct (:8088)
k6 run madsan/scripts/k6_smoke.js

# Prod gate through Caddy (:80)
MADSAN_API_URL=http://<vm>:80 k6 run madsan/scripts/k6_smoke.js
```

Pass criteria: `http_req_duration` p95 &lt; 2s.

## Honest tiers

- AIS: limited Gulf provider coverage
- Vessel–terminal links: inferred from destination/proximity
- Ticker: EIA daily crude spot when `EIA_API_KEY` set; VLSFO/Gold remain reference stubs
- OpenSanctions: review leads, not confirmed designations
