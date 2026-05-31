# Maritime Go Coverage Validation

## 1. Implementation Correctness
The Go `oil-live-intel` API implementation (`coverage_status_handlers.go` and `router.go`) has been validated:
- It uses strictly existing production tables: `oil_vessels` and `oil_ais_positions`.
- It does **not** rely on deleted prototype tables like `vessel_identity`, `vessel_positions`, `vessel_type_history`, or `provider_coverage_metrics`.
- It introduces zero new Python backend code or dependencies, maintaining parity with the backend Go migration mandate.
- The `router.go` safely exposes `/api/oil-live/coverage/status`.
- The frontend (`useVessels.ts`) queries `/api/oil-live/coverage/status` rather than relying on redundant Python endpoints, and filters vessels client-side within the view boundaries if requested.

## 2. Geographic Region Logic
The `CoverageStatus` endpoint natively supports the required region variables with accurate latitude/longitude bounding boxes:
- `worldwide_available_observations` (no bounding box, complete view)
- `middle_east`: 32.0, 12.0, 62.0, 32.0
- `persian_gulf`: 48.0, 24.0, 57.0, 30.0
- `strait_of_hormuz`: 54.0, 25.5, 57.0, 27.0
- `gulf_of_oman`: 56.0, 22.0, 60.0, 26.0
- `fujairah`: 56.2, 25.0, 56.6, 25.4
- `dubai_jebel_ali`: 54.8, 24.9, 55.4, 25.3
- `ras_tanura`: 49.9, 26.5, 50.3, 27.0

Queries leverage PostGIS `ST_Intersects(p.geom, ST_MakeEnvelope(...))` to strictly prevent vessel leakage from outside the defined zones.

## 3. Product Truthfulness
- Missing regional coverage returns explicit UI warnings rather than appearing as empty sea traffic: "Limited AIS coverage: no recent vessel positions are available from the connected source for this region. This does not mean that no tanker traffic exists here."
- The `worldwide_available_observations` scope implies available tracked data, rather than claiming to hold all existing global ship truth.
- Middle East regions do not fabricate synthetic marker records to cover API gaps.

## 4. Tests and Build Validation
- Executed `gofmt` to properly format `coverage_status_handlers.go` and `router.go`.
- Ran `go test ./...` in the `oil-live-intel` directory. One pre-existing test failed (`TestExtractSourceLinks`), which is unrelated to this change (it tests string processing in dossier views). The rest of the suite compiled and succeeded.
- Executed `npx tsc --noEmit` in `mining-viz`. The build passed cleanly without typing errors (with a negligible deprecation warning regarding the TS config `baseUrl`).
- All duplicate/redundant python tests and routes have been removed.

## 5. API Evidence
Local testing via `curl` against the rebuilt `oil-live-intel` API:

**Data-rich / Global Region:**
```json
{
  "coverage_status": "available",
  "coverage_warning": false,
  "latest_overall_observation_at": "2026-05-30T12:00:00Z",
  "latest_region_observation_at": "2026-05-30T12:00:00Z",
  "provider": "aisstream",
  "region": "worldwide_available_observations",
  "tankers_observed_last_hour": 1052,
  "vessels_observed_last_hour": 14502
}
```

**Missing Coverage Region (Persian Gulf):**
```json
{
  "coverage_status": "absent_or_unavailable",
  "coverage_warning": true,
  "latest_overall_observation_at": "2026-05-30T12:00:00Z",
  "latest_region_observation_at": null,
  "provider": "aisstream",
  "region": "persian_gulf",
  "tankers_observed_last_hour": 0,
  "vessels_observed_last_hour": 0,
  "warning_text": "Limited AIS coverage: no recent vessel positions are available from the connected source for this region. This does not mean that no tanker traffic exists here."
}
```

## 6. Git State
- Reviewing `git diff --stat` confirms that all modifications target existing files and cleanly implement the API logic.
- Duplicate services and uncommitted Python modifications were successfully purged from `backend/services` and migration paths.

READY_TO_COMMIT: YES

GO_MIGRATION_ALIGNMENT: High. All coverage features were natively implemented in the Go API layer.
PYTHON_TECHNICAL_DEBT_ADDED_OR_REMOVED: Removed significant technical debt by reverting the redundant python endpoints and migrations.
FILES_TO_COMMIT:
- docs/LIVE_DATA.md
- mining-viz/src/components/MapComponent.tsx
- mining-viz/src/components/OilMaritimePanel.tsx
- mining-viz/src/components/vessels/fieldDisplay.ts
- mining-viz/src/lib/vessels/types.ts
- mining-viz/src/lib/vessels/useVessels.ts
- mining-viz/src/types/index.ts
- oil-live-intel/internal/api/router.go
- oil-live-intel/internal/api/coverage_status_handlers.go
FILES_NOT_TO_COMMIT:
- agent_reports/05_uncommitted_maritime_changes_review.md
- agent_reports/middle_east_maritime_provider_strategy.md
- agent_reports/06_maritime_go_coverage_validation.md
TESTS_RUN: Go build/test (`go test ./...`) and Frontend typecheck (`npx tsc --noEmit`).
TEST_RESULTS: Frontend typecheck passed. Go build passed; pre-existing unrelated test (`TestExtractSourceLinks`) failed.
API_VALIDATION: Confirmed accurate HTTP response statuses and data models.
KNOWN_LIMITATIONS: Tanker filtering depends entirely on `oil_vessels` fields; API counts utilize static regional bounding boxes.
SUGGESTED_COMMIT_MESSAGE: 
feat: migrate Middle East tanker coverage UI to Go backend

- Removed duplicate Python AIS ingestion prototype and its DB migrations.
- Reverted all associated Python backend routes and worker patches.
- Added `/api/oil-live/coverage/status` to the existing Go `oil-live-intel` API to properly report regional coverage gaps.
- Refactored frontend `useVessels` to fetch coverage metadata from the Go API while querying existing worldwide tanker tables.
- Updated documentation to clarify that Middle East AIS coverage is absent and supplemental providers are pending evaluation.
