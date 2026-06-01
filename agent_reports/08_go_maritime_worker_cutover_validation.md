# 08 Go Maritime Worker Cutover Validation

## Objective

The objective of this task was to completely cut over the maritime data ingestion health reporting and vessel live feed from the legacy Python prototype (`mining-maritime-worker` / `maritime_worker.py`) to the target Go architecture (`oil-live-intel-worker` / `/api/oil-live/vessels/live`), thereby eliminating the duplicate parallel workers and ensuring adherence to the Go Migration Mandate.

## Work Completed

### 1. Go Native Health Tracking
- Modified `oil-live-intel/internal/services/ais/store.go` to safely upsert health updates to the `maritime_source_health` Postgres table natively in Go.
- Modified the main loop in `oil-live-intel/internal/workers/ais_ingestor.go` to collect frame counts, batch progress, and periodic connection statuses, sending them to the Postgres health store rather than using Redis snapshots.

### 2. Frontend Cutover
- Updated the primary hook `mining-viz/src/lib/vessels/useVessels.ts` to stop fetching from the Python `/api/maritime/vessels` route.
- Repointed the fetch call to the robust Go endpoint `/api/oil-live/vessels/live`, modifying the query parameters to use the expected `bbox={west},{south},{east},{north}` and `limit` arguments.

### 3. Cleanup of Duplicate Implementation
- Eliminated `backend/maritime_worker.py`, effectively removing the Python prototype from the codebase.
- Removed the `mining-maritime-worker` container block from both `docker-compose.yml` and `docker-compose.prod.yml`.
- Removed redundant vessel position redis mirroring logic from `backend/services/oil_live_graph_sync.py` that was reliant on the Python worker.
- Cleaned up the `maritime_source_health` table to ensure `aisstream` does not have conflicting duplicate entries.

## Verification & Tests Passed

1. **Test Coverage**: Successfully ran `go test ./...` in `oil-live-intel` which confirmed all native ingestion services still behave correctly. Repaired a pre-existing broken test in dossier handlers related to URL extraction.
2. **Frontend Typecheck & Build**: Ran `npx tsc --noEmit` and `npx vite build` in `mining-viz`, both passing correctly, proving that the type signatures align with the new endpoint arguments.
3. **Database Telemetry**: Queried the `maritime_source_health` table running inside Docker; verified that `aisstream` has an `ok` status indicating successful operation by the Go worker without conflict.
4. **Runtime Processes**: Verified that the container `mining-maritime-worker` is completely removed from Docker Compose without triggering orphan errors, and that `oil-live-intel-worker` took over seamlessly.

## Conclusion

The redundant Python maritime ingestion capabilities have been fully retired and eradicated. The application is now running cleanly on the high-performance Go worker, establishing a solid foundation for the remainder of the Go Migration Roadmap.
