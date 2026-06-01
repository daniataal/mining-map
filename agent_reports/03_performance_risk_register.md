# Performance Risk Register

## 1. Monolithic Backend (`main.py`)
- **Risk**: The `backend/main.py` is over 300KB in size.
- **Impact**: Difficult to maintain, increased chance of regressions, poor developer experience, and likely tight coupling between routing, logic, and data access.
- **Mitigation**: Refactor `main.py` into a modular router structure (e.g., `api/routes/vessels.py`, `api/routes/licenses.py`).

## 2. Unbounded Geospatial Queries
- **Risk**: Rendering 1.2M `oil_ais_positions` or 300k `petroleum_osm_features`.
- **Impact**: Server out-of-memory crashes or frontend browser freezing if the API returns unbounded JSON arrays instead of viewport-limited GeoJSON/tiles.
- **Mitigation**: Ensure all map APIs mandate a `bbox` parameter, a strict `limit`, and utilize PostGIS clustering or simplification at low zoom levels.

## 3. Worker Concurrency and Database Locks
- **Risk**: Multiple background sync workers (`maritime-worker`, `petroleum-osm-worker`) writing heavily to the same database.
- **Impact**: Postgres transaction deadlocks or elevated IOPS that slow down user-facing read queries.
- **Mitigation**: Use batch upserts, appropriate indexing, and separate read/write workloads or replicas if scale demands it.
