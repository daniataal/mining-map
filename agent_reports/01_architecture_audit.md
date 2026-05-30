# Architecture Audit

## Data and Ingestion
- **Strengths**: The system uses a worker-based pattern to decouple ingestion from API serving. Dedicated background workers (`maritime-worker`, `petroleum-osm-worker`, `license-sync-worker`, etc.) fetch data and sync to Postgres.
- **Weaknesses**: The `backend/main.py` is extremely monolithic (328 KB). This indicates tightly coupled logic, poor separation of concerns between API endpoints, business logic, and database queries.
- **Observation**: AIS ingestion is active (`oil_ais_positions` has 1.2M+ rows). 

## Backend and Database
- **Strengths**: Postgres is used for relational and spatial storage. Elasticsearch is deployed for search indexing, removing heavy text-search load from Postgres. Redis is used for caching (`maritime:snapshot:global`).
- **Weaknesses**: With a monolithic backend, query plans and spatial filtering for endpoints could be sub-optimal. The sheer size of `petroleum_osm_features` (303k) and `oil_ais_positions` (1.2M) requires robust PostGIS indexing, viewport-bound `limit` + `bbox` querying, and clustering.

## Frontend and Map
- **Current Setup**: TypeScript frontend, Mapbox integration.
- **Risk**: Returning tens of thousands of features (e.g. vessels or OSM pipelines) to the frontend will crash the browser. Vector tiling or strict server-side clustering must be enforced.
