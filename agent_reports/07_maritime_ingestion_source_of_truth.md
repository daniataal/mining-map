# Maritime Ingestion Source of Truth

## Executive Summary
This report identifies the true data-writing pathways for maritime AIS data in the production system. Contrary to some assumptions, there is a split-brain architecture where both the Python and Go workers independently connect to the external AIS provider, but they write to entirely different storage destinations. The Python worker writes to a legacy Redis cache and a legacy health table, while the Go worker performs the actual durable writes to the Postgres tracking tables.

## 1. Which active service connects to AISStream?
**Both.** 
- The Python `mining-maritime-worker` (running `maritime_worker.py`) establishes concurrent websocket connections (`global_tanker_discovery` and `middle_east_critical_with_singapore_heartbeat`).
- The Go `oil-live-intel-worker` (running `internal/workers/ais_ingestor.go`) also establishes a websocket connection and subscribes to terminal bounding boxes.
This means the platform consumes double the bandwidth and API quota necessary.

## 2. Which active service writes to `oil_ais_positions`?
**Go (`oil-live-intel-worker`) only.** 
The Python codebase does not contain a single `INSERT INTO oil_ais_positions` statement. The Go service handles all historical AIS tracking appends and position grooming.

## 3. Which active service writes to `oil_vessels`?
**Go (`oil-live-intel-worker`) primarily.** 
When live AIS data arrives, the Go worker upserts the vessel into `oil_vessels` with its dynamically observed tanker classification. (Additionally, the Python `oil_live_graph_sync_worker.py` occasionally performs batch background enrichment of `oil_vessels` using static EIA/Comtrade metadata).

## 4. Which active service updates `maritime_source_health`?
**Python (`mining-maritime-worker`).**
The `maritime_worker.py` calls `update_maritime_ingest_status`, which updates the Postgres `maritime_source_health` table with success/failure metadata based on its own websocket. The Go worker ignores this table entirely.

## 5. Does `backend/maritime_worker.py` currently run in Docker Compose?
**Yes.** It is active as the `mining-maritime-worker` service in both `docker-compose.yml` and `docker-compose.prod.yml`.

## 6. Does `oil-live-intel-worker` currently ingest AIS data, or does it only process/read?
**It actively ingests.** It subscribes to AISStream, parses the websocket stream, generates Intelligence Cards for port calls, upserts `oil_vessels`, inserts into `oil_ais_positions`, and publishes Redis pub/sub messages for live UI overlays.

## 7. Are both Python and Go services writing maritime data concurrently?
**Yes**, but to different targets. Python writes a volatile JSON blob to Redis (`maritime:snapshot:global`) and updates the Postgres `maritime_source_health` row. Go writes durable rows to Postgres (`oil_ais_positions`, `oil_vessels`, `oil_port_calls`).

## 8. Is there any duplication, conflict, or double-counting in the production data path?
**Network duplication**: Both services pull the exact same data from AISStream simultaneously. 
**Data conflict**: The Python worker asserts the "health" of the maritime system based on its own connection, which might differ from the Go worker's connection health. Furthermore, older frontend API endpoints might read from the legacy Redis snapshot, while newer APIs (like the recently built coverage endpoint) read from the true Postgres tables.

## 9. Which exact Python functionality remains to be migrated into Go?
Virtually nothing for raw ingest. The Go worker already fully replicates (and exceeds) the Python AIS ingestion capability. The only remaining tasks are:
- Deleting the redundant Python worker.
- Ensuring the frontend exclusively relies on Go API endpoints (which the previous coverage UI update largely completed).

## 10. What is the safe cutover sequence?
1. Verify the frontend map layers pull exclusively from the Go `/api/oil-live/map` and `/api/oil-live/coverage/status` rather than Python `/api/maritime/vessels`.
2. Delete the `mining-maritime-worker` service from docker-compose.
3. Delete `backend/maritime_worker.py`.
4. Drop or ignore the legacy `maritime:snapshot:global` Redis key and `maritime_source_health` table.

---
