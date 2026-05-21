# oil-live-intel

Free, explainable oil **live intelligence** service for the mining-map platform.

## What it does

- Oil terminals, tank farms, and hubs (curated seed + GeoJSON import)
- Inferred possible loading/unloading from AIS + geofence (when enabled)
- Company discovery and **Save to Suppliers** (creates license + Deal annotation)
- Intelligence cards with confidence, evidence, and disclaimers

**Not confirmed transactions.** All cargo activity is labeled possible/likely/inferred.

## Live AIS pipeline (Phases 6–8)

**Two AIS paths (by design):**

| Service | Role | Map layer |
|---------|------|-----------|
| `maritime-worker` (Python) | Global AIS snapshot → Redis | Canvas vessel layer (Oil & Gas + Live Data when enabled) |
| `oil-live-intel-worker` (Go) | Terminal geofence port calls + `oil_ais_positions` + WebSocket | Oil Live overlay markers + port-call intel |

**No duplicate DB writes:** `maritime-worker` stores snapshots in **Redis** only (Python `/api/maritime/vessels`). `oil-live-intel-worker` is the sole writer to `oil_ais_positions` and live `oil_port_calls` (metadata `source=live_ais`). Graph-sync seed port calls use `source=seed_port_calls`.

Live Data auto-enables the maritime canvas layer and oil-live overlay vessels when you open the tab. For live positions you need `AISSTREAM_API_KEY` in repo-root `.env` (or `backend.env`) **and** both workers running:

```bash
docker compose up -d maritime-worker oil-live-intel oil-live-intel-worker
```

When `AISSTREAM_API_KEY` is set and `ENABLE_AIS=true`:

1. Worker subscribes to AISStream bounding boxes around seeded terminals
2. Filters oil/product tankers (AIS types 80–89 + name heuristics; bulk near sulfur terminals)
3. Geofence match (~1.2 km) opens `oil_port_calls`
4. After 2+ hours outside terminal, closes visit, classifies load/discharge from draft delta
5. Generates `oil_intelligence_cards` with confidence + evidence
6. Worker POSTs events to API `/api/oil-live/internal/broadcast` → WebSocket clients

## Run with Docker Compose

From repo root:

```bash
docker compose up -d --build oil-live-intel
curl -s http://localhost:8095/api/oil-live/health
```

## Environment

| Variable | Required | Default |
|----------|----------|---------|
| `DATABASE_URL` | yes | `postgresql://postgres:password@db:5432/mining_db?sslmode=disable` |
| `OIL_INTEL_PORT` | no | `8095` |
| `AISSTREAM_API_KEY` | for live AIS | — |
| `ENABLE_AIS` | no | `true` (needs API key) |
| `EIA_API_KEY` | optional | — |
| `COMTRADE_API_KEY` | optional | Higher-quota Comtrade; public preview works without key |
| `ENABLE_COMTRADE` | no | `true` — sync HS 2709/2710/2711 daily |
| `ENABLE_EIA` | no | `true` — EIA volume supplement when key set |
| `EXISTING_BACKEND_URL` | no | `http://backend:8000` |
| `SUPPLIER_CREATE_ENDPOINT` | no | `/licenses` |

## Migrations (commercial graph + synthetic cargo)

Go migrations run on service startup against `DATABASE_URL`:

- `migrations/008_commercial_graph.sql` — `oil_commercial_events`
- `migrations/009_meridian_cargo_records.sql` — BOL-shaped synthetic rows

```bash
# Ensure DB is up, then start intel once (applies 001–009)
docker compose up -d db oil-live-intel
docker compose logs -f oil-live-intel | head
```

## Meridian graph sync (Python)

Merges OSM storage, licenses, trade, TED, gov awards into `mining_db`, then triggers synthetic BOL rebuild:

```bash
# One-shot (admin token from .env ADMIN_API_TOKEN)
curl -X POST "http://localhost:8000/api/admin/oil-live/graph-sync" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN"

# Scheduled worker (docker-compose service)
docker compose up -d oil-live-graph-sync-worker
```

Env: `OIL_GRAPH_SYNC_ENABLED`, `OIL_GRAPH_SYNC_INTERVAL_SECONDS`, `OIL_INTEL_API_URL`, `OIL_INTEL_INTERNAL_KEY`.

Optional U.S. macro trade on graph sync:

- `CENSUS_API_KEY` — see `backend/services/census_trade.py`
- `USITC_DATAWEB_API_KEY` — see `backend/services/usitc_dataweb.py` (free DataWeb account required)

## End-to-end demo populate (Docker)

From repo root with `.env` containing at least `ADMIN_API_TOKEN` and `OIL_INTEL_INTERNAL_KEY`:

```bash
# 1) Core stack + intel migrations (001–010)
docker compose up -d db backend oil-live-intel

# 2) Wait for health
curl -sf http://localhost:8095/api/oil-live/health
curl -sf http://localhost:8000/health

# 3) Import OSM terminals + mirror trade/TED/licenses + trigger synthetic BOL rebuild
curl -sf -X POST "http://localhost:8000/api/admin/oil-live/graph-sync" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" | jq .

# 4) (Optional) Force synthetic cargo rebuild without full graph sync
curl -sf -X POST "http://localhost:8095/api/oil-live/internal/synthetic-bol-rebuild" \
  -H "X-Oil-Intel-Internal: $OIL_INTEL_INTERNAL_KEY" | jq .

# 5) Verify coverage banner inputs
curl -sf http://localhost:8095/api/oil-live/sync-status | jq .
curl -sf "http://localhost:8095/api/oil-live/cargo-records?limit=1" | jq '.count'

# Expect: terminal_count >> 6 after graph-sync, cargo_record_count > 0 when port calls exist
```

## OSM storage import (Overpass + fallbacks)

Graph sync imports petroleum storage terminals via `GET /api/storage/terminals` (Python `backend/services/storage_terminals.py`).

**Fetch order**

1. **Live Overpass** — 11 world tiles; tries `STORAGE_OVERPASS_URL` / `OVERPASS_URL`, then `overpass.kumi.systems`, then `overpass-api.de`, with retries.
2. **`petroleum_osm_features`** — persisted nightly OSM sync (`petroleum_osm_sync_worker`); used when live Overpass fails or cache is globally complete.
3. **Offline bulk seed** — `backend/data/oil_terminals_seed_bulk.json` (~300 worldwide terminals) when live + DB coverage is still sparse (typical in Docker/CI when Overpass times out).
4. **Curated reference** — `data/storage_terminals_seed.json` (major named hubs).

**Cache behavior:** `force_refresh=true` no longer clears the in-memory cache up front. If a refresh fails (all tiles timeout), the previous cached snapshot is returned and graph-sync can still import hundreds of terminals from cache/DB/bulk seed.

| Variable | Default | Purpose |
|----------|---------|---------|
| `STORAGE_OVERPASS_URL` | `https://overpass.kumi.systems/api/interpreter` | Primary Overpass mirror for storage tiles |
| `OVERPASS_URL` | same as above | Shared fallback for petroleum OSM sync |
| `STORAGE_OVERPASS_TIMEOUT_SECONDS` | `120` | HTTP read timeout per tile request |
| `STORAGE_OVERPASS_QUERY_TIMEOUT_SECONDS` | `90` | Overpass `[timeout:…]` inside QL |
| `STORAGE_OVERPASS_RETRY_ATTEMPTS` | `3` | Retries per mirror before next endpoint |
| `STORAGE_OVERPASS_TILE_WORKERS` | `3` | Parallel world tiles (lower = gentler on public mirrors) |
| `STORAGE_SKIP_LIVE_OVERPASS` | unset (`true` in docker-compose) | Skip live Overpass; use `petroleum_osm_features` + bulk seed + curated reference |

Regenerate the offline bulk seed when Overpass is reachable:

```bash
python backend/scripts/build_oil_terminals_bulk_seed.py
```

**Demo corridor (Recipe B):** Fresh DB seed (`oil-live-intel/internal/seed/seed.go`) inserts paired `possible_loading` + `possible_unloading` port calls for demo vessel **MT DEMO STAR** (MMSI `636012345`) — Ras Tanura → Rotterdam — so synthetic BOL rebuild can produce at least one full corridor when trade-flow data exists.

Scheduled graph sync worker:

```bash
docker compose up -d oil-live-graph-sync-worker
```

## Tests

```bash
cd oil-live-intel && go test ./...
```

## API

All routes under `/api/oil-live/` — see plan doc for full list.

Notable routes: `GET /sync-status`, `GET /map?bbox=west,south,east,north&limit=500`, `GET /cargo-records`, `GET /opportunities/{id}/deal-pack`, `POST /internal/synthetic-bol-rebuild`.

Admin (Python backend): `POST /api/admin/oil-live/graph-sync`, `POST /api/admin/oil-live/enrich-contacts?limit=50` (batch contact agent for companies with `supplier_id`).

## Product families

Terminals tag products: `crude_oil`, `diesel`, `gasoline`, `lng`, `lpg`, `sulfur`, `refined_products`, etc.

Heavy/light crude grades are **terminal tags only** in v1 — not inferred from AIS.

## Confidence

Deterministic score from terminal proximity, dwell time, draft change, tanker class, and product match.

## Supplier integration

`POST /api/oil-live/companies/{id}/save-to-suppliers` forwards auth to:

1. `POST /licenses` on the Python backend
2. `PUT /api/licenses/{id}/annotations` with `status: "good"`

On failure, returns payload for manual supplier creation and logs `oil_supplier_exports`.
