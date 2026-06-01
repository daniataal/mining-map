# Backend Go Migration Roadmap

## Executive Summary
This document outlines the controlled, phased migration of the Meridian platform's backend from Python/FastAPI to Go. In accordance with the `BACKEND_GO_MIGRATION_MANDATE`, the existing Python implementation is treated as transitional. New capabilities and high-throughput domains will incrementally transition to Go (currently seeded in `oil-live-intel`) using the strangler pattern. No duplicate running of production systems will occur without a clear cutover and cleanup plan.

## Current Python Backend Inventory

### API Routes & Domains
- **Auth & Activity**: `/auth/login`, `/auth/register`, `/auth/users`, `/activity/log`
- **Mining & Licenses**: `/licenses`, `/licenses/batch-delete`, `/licenses/import`, `/licenses/export`, `/licenses/{id}/files`
- **Entity & Due Diligence**: `/entities/{id}/contacts`, `/entities/{id}/relationships`, `/entities/{id}/dd/latest`, `/entities/{id}/legal-events`, `/entities/{id}/gov-procurement`
- **Marketplace & Deals**: `/api/deal-rooms`, `/api/deal-rooms/{id}/export`, `/miner-listings`, `/meeting-points`
- **Routing & Cost**: `/api/routing/plans`, `/api/routing/cost-estimate`
- **Agent Intelligence**: `/api/agents/route-intelligence`, `/api/agents/contact-enrichment`, `/api/agents/operator-validation`, `/api/agents/data-validation/run`
- **Map & Geospatial**: `/api/map/country-borders`

### Background Workers & Sync Jobs
- **Maritime**: `maritime_worker.py` (AISStream ingest)
- **Oil/Trade**: `eia_historic_sync_worker.py`, `oil_live_graph_sync_worker.py`, `uk_trade_manifest_sync_worker.py`, `comtrade_sync_worker.py`, `petroleum_osm_sync_worker.py`
- **Mining**: `license_daily_sync_worker.py`, `sweden_mining_sync_worker.py`, `kazakhstan_mining_sync_worker.py`, `arcgis_probe_sync_worker.py`
- **Procurement**: `gov_procurement_sync_worker.py`, `ted_procurement_sync_worker.py`

### External Providers
- AI (Groq, OpenRouter), AISStream, Mapbox, Overpass (OSM), Comtrade, EIA, SEC Edgar, Wikidata, OpenSanctions, GLEIF.

## Existing Go Capability Inventory

The `oil-live-intel` service currently handles:
- **Core HTTP & Routing**: High-throughput `/api/oil-live/*` base.
- **Maritime Intelligence**: `/coverage`, `/coverage/status`, `/terminals`, `/terminals/{id}`, `/terminals/{id}/logistics-hints`.
- **Map Delivery**: `/map`, `/map-layers`, `/licenses/map` (clustering and viewport aggregation).
- **Search & Health**: `/sync-status`, `/source-health`, `/search` (Elasticsearch integration).
- **Go Workers**: `oil-live-intel-worker` and `oil-live-search-indexer`.

## Domain-by-Domain Migration Mapping

1. **High-Volume Map/Geospatial**: `backend/api/map/*` -> `oil-live-intel/internal/api/map_layers_handlers.go`.
2. **Maritime & Infrastructure**: `maritime_worker.py` and OSM sync workers -> `oil-live-intel/internal/workers`.
3. **Mining Licenses**: `backend/main.py` license CRUD and sync workers -> `mining-intel` Go package.
4. **Supplier/Buyer/DD**: `backend/services/due_diligence.py`, entity resolution -> `dossier` Go package.
5. **Marketplace & Transaction**: `backend/services/deal_rooms.py`, routing -> `transaction` Go package.

## Migration Phases

- **Phase 1: Consolidate Map & Geospatial (Immediate)**
  Migrate remaining viewport and map-layer serving to Go to guarantee high UI performance. 
- **Phase 2: Ingestion & Provider Adapters (Short-Term)**
  Rewrite `maritime_worker.py` and `petroleum_osm_sync_worker.py` in Go to leverage concurrent PostGIS processing and stable memory management.
- **Phase 3: Mining & License Cadastre (Mid-Term)**
  Migrate the core `/licenses` API and regional syncing (Sweden, Kazakhstan, ArcGIS probes).
- **Phase 4: Dossiers & Due Diligence (Mid-Term)**
  Migrate entity relationships, contacts, and legal event endpoints.
- **Phase 5: Marketplace & Transactions (Long-Term)**
  Migrate deal rooms, route planning, and opportunity management only once the foundational intelligence layers are firmly in Go.

## Stable API Compatibility Plan
- Use the **Strangler Fig Pattern**. The existing Caddy reverse proxy will route traffic per-endpoint. 
- As an endpoint is ported to Go, the Caddyfile routing will be updated to point the specific path (e.g., `/api/map/country-borders`) to the Go service while the rest of `/api/*` defaults to Python.
- Data payloads (camelCase JSON shapes) must remain strictly identical to avoid breaking the React `mining-viz` frontend.

## Tests and Parity Validation
- Run dual-read integration scripts mapping the Python response payload to the Go response payload on identical local database seeds.
- Retain existing unit tests in Python; duplicate the test matrices natively in Go (`_test.go`) prior to cutover.
- Ensure bounding-box parity and PostGIS indexing parity during spatial queries.

## Rollback Strategy
- The Caddyfile will maintain commented-out routes for instantaneous rollback to the Python backend without redeploying containers.
- Write operations (CRUD) migrated to Go must use the exact same Postgres schemas, allowing the Python backend to read/write identically if traffic is reverted.
- Migrations modifying schemas must be backward-compatible (e.g., adding columns, not dropping/renaming) during the cutover window.

## Python-Removal Criteria
A Python subsystem or file can be deleted when:
1. The equivalent Go implementation is merged, deployed, and serving 100% of the traffic.
2. 48 hours of operational stability has been observed without unhandled errors.
3. No background Python workers rely on the same shared ORM/service file.

## Smallest Safe First Migration Milestone
**Target:** Migrate `maritime_worker.py` to `oil-live-intel-worker` natively in Go.
**Why:** The Go service already handles the read-paths (`/coverage/status`, `/terminals`). Moving the ingest worker to Go centralizes all maritime logic in a single compiled binary, eliminating the largest real-time Python memory overhead. It requires no frontend changes and is easily reversible.

## Recent cutovers (branch `go-maritime-worker-cutover`)

| Item | Status | Notes |
|------|--------|-------|
| License map clusters (`GET /api/oil-live/licenses/map`) | **Cut over** | Frontend defaults to Go for zoom &lt; 8; Python `/licenses` remains fallback + point mode |
| Maritime read APIs (`/api/maritime/stats`, `/context`) | **Routed to Go** | Caddy + Vite dev proxy; Python stubs kept for `:8000` direct access |
| `GET /api/maritime/vessels` | **Routed to Go** | Caddy + Vite dev proxy; Python shim for `:8000` direct only |
| Vite dev `/licenses` CRUD | **Routed to Go** | Annotations `/api/licenses/*/annotations` still Python |
| Maritime ingest (`oil-live-intel-worker`) | **Done** | Do not reintroduce Python websocket worker |
| `oil-live-graph-sync-worker` | **In progress** | Go cold steps: `terminal_operators`, `licenses`, `trade_flows`, `port_calls`, `ted`, `gov_awards`; Python orchestrator still primary |

### Graph-sync inventory (`backend/services/oil_live_graph_sync.py`)

| Step | Runtime | External keys | Tables touched | Idempotent | Go port |
|------|---------|---------------|----------------|------------|---------|
| `ensure_commercial_graph_tables` | cold/DDL | — | applies 008/010/011/018 if missing | yes | — |
| `storage_terminals` | IO+CPU | Overpass optional | `oil_terminals` | upsert | — |
| `petroleum_osm_storage` | IO | OSM | `oil_terminals`, layers | upsert | — |
| **`licenses`** | **CPU** | **—** | **`oil_companies`, `oil_commercial_events`** | **upsert** | **Go (`OIL_GRAPH_SYNC_GO_LICENSES`)** |
| **`terminal_operators`** | **cold CPU** | **—** | **`oil_companies`** | **upsert** | **Go (`OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS`)** |
| `seed_port_calls` | CPU | — | `oil_port_calls`, `oil_vessels` | conditional insert | — |
| **`trade_flows`** | **CPU** | **—** | **`oil_commercial_events`** | **upsert** | **Go (`OIL_GRAPH_SYNC_GO_TRADE_FLOWS`)** |
| `census_trade` | IO | `CENSUS_API_KEY` | `oil_trade_flows` | upsert | — |
| `usitc_trade` | IO | `USITC_DATAWEB_API_KEY` | `oil_trade_flows` | upsert | — |
| `eia_crude_imports` | IO | `EIA_API_KEY` | `oil_trade_flows`, `oil_refinery_throughput` | upsert | — |
| `eia_historic_imports` | IO | `EIA_DOWNLOADS_DIR` | `eia_historic_imports` | upsert | — |
| `gem_extraction_tracker` | IO | xlsx path | terminals/events | upsert | — |
| `eurostat_trade` | IO | public REST | `oil_trade_flows`, `oil_live_sync_state` | upsert | — |
| `jodi_oil` | IO | `JODI_CSV_URL` | snapshots | upsert | — |
| `commodity_trade_flows` | IO | `COMTRADE_API_KEY` | `oil_trade_flows` | upsert | — |
| `trade_manifest_uk` | IO | UK API | trade rows | upsert | — |
| `gleif_batch` / `wikidata_enrich` / `opensanctions_screening` | IO | optional keys | `oil_companies` | batch upsert | — |
| **`port_calls`** | **CPU** | **—** | **`oil_commercial_events`** | **upsert** | **Go (`OIL_GRAPH_SYNC_GO_PORT_CALLS`)** |
| **`ted`** | **CPU** | **—** | **`oil_commercial_events`** | **upsert** | **Go (`OIL_GRAPH_SYNC_GO_TED`)** |
| **`gov_awards`** | **CPU** | **—** | **`oil_commercial_events`** | **upsert** | **Go (`OIL_GRAPH_SYNC_GO_GOV_AWARDS`)** |
| `barentswatch_ais` | IO | BarentsWatch | AIS tables | upsert |
| `opportunity_links` | CPU | — | `oil_opportunities` | update/insert |
| `synthetic_bol` | HTTP | Go internal API | `meridian_cargo_records` | rebuild |
| `mcr_party_denormalize` | CPU | — | `meridian_cargo_records` | update |
| `_record_graph_sync_at` | cold | — | `oil_live_sync_state` | upsert |

**Worker schedule:** `oil_live_graph_sync_worker.py` — `run_once()` then sleep `OIL_GRAPH_SYNC_INTERVAL_SECONDS` (default 43200–86400s); backoff `OIL_GRAPH_SYNC_BACKOFF_SECONDS` on failure. Admin trigger: `POST /api/admin/oil-live/graph-sync` (Python, `X-Admin-Token`).

**Go ports (branch `go-maritime-worker-cutover`):**

| Step | Env flag | Go package | Sync state key |
|------|----------|------------|----------------|
| `terminal_operators` | `OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS` | `graphsync/terminal_operators.go` | `graphsync_terminal_operators` |
| `licenses` | `OIL_GRAPH_SYNC_GO_LICENSES` | `graphsync/licenses.go` | `graphsync_licenses` |
| `trade_flows` | `OIL_GRAPH_SYNC_GO_TRADE_FLOWS` | `graphsync/trade_flows.go` | `graphsync_trade_flows` |
| `port_calls` | `OIL_GRAPH_SYNC_GO_PORT_CALLS` | `graphsync/port_calls.go` | `graphsync_port_calls` |
| `ted` | `OIL_GRAPH_SYNC_GO_TED` | `graphsync/ted.go` | `graphsync_ted` |
| `gov_awards` | `OIL_GRAPH_SYNC_GO_GOV_AWARDS` | `graphsync/gov_awards.go` | `graphsync_gov_awards` |

Shared helpers: `graphsync/commercial_event.go`, `graphsync/commodity_helpers.go`, `graphsync/company.go`.

Python `run_full_graph_sync` skips each step when its Go flag is true (returns `go_worker` skip payload). Rollback = disable flag; Python step runs on next graph-sync tick.

**Validation:** parity tests in `graphsync/*_test.go` and `workers/graph_sync_steps_test.go`; enable flags on **oil-live-intel-worker** and compare `oil_live_sync_state.metadata` vs Python `steps.*`.

### Next bounded step: graph-sync (continued)

1. **Validate Go steps in dev** — enable all `OIL_GRAPH_SYNC_GO_*` flags; compare sync_state after one worker tick.
2. **Port next cold step** — IO steps (`census_trade`, `eurostat_trade`) or guarded `seed_port_calls` (demo-gated).
3. **Admin trigger** — optional Go handler for individual graph-sync steps before Python cutover.
4. **Cutover criteria** — 48h stable scheduled runs, parity row counts; rollback = disable Go flags + Python worker.

**Rollback:** Set `OIL_GRAPH_SYNC_GO_*=false`; Python worker + admin POST unchanged; no schema drops.

### Python shims — safe retirement candidates

| Route | Status | Callers | Action |
|-------|--------|---------|--------|
| `GET /api/maritime/vessels` | **Caddy + Vite → Go** | **Zero** in `mining-viz` | Python shim kept for `:8000` direct access; returns `deprecated_route` + `canonical_route` |

### Phase 3 partial — license CRUD on Go

Go serves: `GET/POST/PUT/DELETE /api/oil-live/licenses/*`, map clusters, import/export, files. **Dev parity:** Vite now proxies `/licenses` → Go (annotations `/api/licenses/*/annotations` still → Python). Caddy already rewrites `/api/licenses*` and `/licenses*` to Go (annotations exceptions unchanged). Gap: `sync_license_contacts` still deferred to Python on create (`license_crud.go`).

### License sync worker inventory

| Worker | Runtime | Steps | Go equivalent |
|--------|---------|-------|---------------|
| `license_daily_sync_worker.py` | Python | `open_data_sync.sync_open_data_sources()` | Partial — Go runs Sweden/Kazakhstan/ArcGIS on **oil-live-intel-worker** |
| Python-only open-data sources | Python | ~40 ArcGIS/country sources in `open_data_sync.py` | **Not ported** — next after graph-sync IO steps validated |
