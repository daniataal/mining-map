# Platform Baseline

## Git State
- **Branch**: `paperclip2`
- **Status**: Ahead of origin/paperclip2 by 1 commit. Working tree has modified files including `backend/main.py`, `backend/maritime_worker.py`, `docker-compose.yml`, `mining-viz/src/components/MapComponent.tsx`, etc. Several untracked files are present (e.g. `.agents/`, `backend/services/ais_tanker_ingestion.py`).

## Runtime/Container Inventory
Docker Compose defines a robust, multi-container architecture. Running services include:
- `backend` (FastAPI/Python based)
- `frontend` (TypeScript/React based via Vite, port 5173)
- `db` (Postgres, port 5432)
- `redis` (Redis cache)
- `elasticsearch` (Search index layer)
- `route-service` (OSRM wrapper for routing)
- `oil-live-intel` & `oil-live-search-indexer`
- `caddy` (Reverse proxy)
- Multiple background workers: `maritime-worker`, `license-sync-worker`, `comtrade-sync-worker`, `petroleum-osm-worker`, `ted-procurement-worker`, `oil-live-graph-sync-worker`, etc.

## Database State
The `mining_db` (Postgres) database contains 70 tables in the `public` schema. Data coverage (approx. row counts):
- `licenses`: 72,583
- `oil_ais_positions`: 1,242,837
- `petroleum_osm_features`: 303,274
- `oil_port_calls`: 33,938
- `oil_vessels`: 7,522
- `vessel_positions`: 24,967
- `vessel_identity`: 5,792
- `oil_companies`: 4,414
- `meridian_cargo_records`: 330
- `oil_trade_flows`: 306
- `oil_terminals`: 7

**Finding:** Vessel data *does* exist natively within the application's storage (`oil_ais_positions`, `oil_vessels`, etc.). Over 1.2 million AIS positions are already recorded.

## Existing Data Providers
The application utilizes multiple background sync workers that suggest integrations with:
- AISStream (maritime-worker)
- Comtrade (comtrade-sync-worker)
- EIA (eia-historic-sync-worker)
- Mapbox / OSM (petroleum-osm-worker)
- Kazakhstan eGov & ArcGIS (arcgis-probe-worker, kazakhstan-mining-worker)
- Sweden SGU (sweden-mining-worker)
- EU TED (ted-procurement-worker)

## Next Steps
- Review frontend map layer handling for rendering 1.2M AIS positions and 300K OSM features efficiently.
- Refactor the monolithic `main.py` backend.
