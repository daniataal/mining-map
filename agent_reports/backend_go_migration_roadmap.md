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
