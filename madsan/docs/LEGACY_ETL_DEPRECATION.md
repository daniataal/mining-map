# Legacy ETL deprecation (Python → Go)

MadSan V2 imports rows from the legacy `mining_db` Postgres (`LEGACY_DATABASE_URL`). The permanent path is **Go**; Python is transitional and opt-in only.

## Default behavior

| Setting | Default | Effect |
|---------|---------|--------|
| `MADSAN_LEGACY_PYTHON` | `false` | `legacy_import` jobs run via Go (`processLegacyImportGo`) |
| Admin enqueue | Go buttons only | Python import button hidden unless flag enabled |

Go import covers: `oil_vessels`, `licenses`, `oil_ais_positions` (read path for AIS sync), and mapped staging tables.

## Python opt-in (temporary bridge)

Enable only when debugging parity gaps:

```bash
# madsan/deploy/.env
MADSAN_LEGACY_PYTHON=true
```

Or enqueue with payload `{"use_python": true}` (admin UI exposes this only when the flag is on).

Python runner: `madsan/etl/legacy_import.py` via `legacy_runner.go`.

## Parity thresholds

`cmd/legacy-parity` and the admin Runtime health panel compare **row counts** between legacy `mining_db` and `madsan_db`. Default threshold: **5%** (`MADSAN_PARITY_THRESHOLD_PCT` overrides).

| Legacy table | Madsan target | Critical | Pass rule |
|--------------|---------------|----------|-----------|
| `oil_vessels` | `vessels` | yes | `drift_pct ≤ 5%` **or** `madsan_count ≥ legacy_count` (live AIS may add vessels) |
| `licenses` | `assets` where `legacy_table = 'legacy_licenses'` | yes | `drift_pct ≤ 5%` (legacy count: **distinct importable** rows — geolocated, non-empty `company`, dedupe key matches Go upsert: `normalized_name` + `asset_type` + `country_code`) |
| `petroleum_osm_features` | `assets` where `legacy_table = 'legacy_petroleum_osm_features'` | yes | `drift_pct ≤ 5%` (legacy count: rows with `geom`) |
| `oil_companies` | `companies` | no | informational only; dedupe by name+country makes counts incomparable |

**Drift semantics:** `drift = madsan_count - legacy_count`. Negative drift (madsan lower) usually means an **incomplete Go import** — enqueue **Legacy import (all)** with worker running, or wait for the daily scheduler job. Positive drift on vessels is expected when AIS sync is active.

**Licenses — expected vs bug (honest tier):**

| Signal | Expected? | Explanation |
|--------|-----------|-------------|
| Madsan ≈ **62%** of raw geolocated legacy rows (~73k → ~45k) after full import | **yes** | Go upserts one asset per `(company, sector→asset_type, country)`; many legacy license parcels share the same operator. Parity compares against **distinct importable keys**, not raw row count. |
| Go skips rows where `company` normalizes to empty (`legacy_read.go`) | **yes** | Assets require a name; vessels are exempt. Current snapshot has **0** geolocated licenses with blank `company`. |
| Madsan ≪ distinct importable count after **Legacy import (all)** | **bug** | Incomplete import, worker down, or upsert errors — not dedupe. |
| Raw legacy count used as parity denominator | **misleading** | Treat ~38% “drift” vs raw rows as dedupe, not under-import, once madsan ≈ distinct importable count. |

CLI exits **0** when all critical tables pass; **1** when any critical table exceeds threshold.

## Phase 4e validation (2026-06-09, hybrid dev)

Both DBs reachable (`madsan_db` :5433, legacy `mining_db` :5434). Commands run from `madsan/backend` with default config URLs (see `madsan/deploy/.env.example`).

### `legacy-parity` (read-only)

```bash
cd madsan/backend
go run ./cmd/legacy-parity
```

| Table | Legacy | Madsan | Drift % | Status |
|-------|--------|--------|---------|--------|
| `oil_vessels` | 9,595 | 9,595 | 0% | **pass** |
| `oil_companies` | 5,074 | 18,680 | 268% | informational |
| `licenses` | ~45,506 importable | ~45,503 | ~0% | **pass** after full import (raw geolocated rows ~73,112 dedupe to ~45k; ~62% row ratio is expected) |
| `petroleum_osm_features` | 303,745 | 57,318 | 81.1% | **fail** (under-imported) |

**Result:** `passed: false`, `failed_critical: ["petroleum_osm_features"]` (licenses fail only when using raw row denominator or import incomplete). Vessels at parity; petroleum OSM assets need full Go import before Python retirement.

### `backfill-petroleum-types` (dry-run)

```bash
go run ./cmd/backfill-petroleum-types --dry-run
# scanned=57318, would_update=0, skipped=0
```

No `asset_type` corrections needed — petroleum provenance rows already map correctly. **Do not apply** until a future dry-run shows `would_update > 0`.

Apply command (only after dry-run shows pending changes):

```bash
go run ./cmd/backfill-petroleum-types
# then verify map_energy_assets / map_metals_assets refresh in job logs
```

## Cutover checklist

Complete **in order** before retiring Python `legacy_import.py`:

- [ ] **1. Env** — `LEGACY_DATABASE_URL` points at legacy DB (`sync_env_from_root.sh` rewrites Docker hostnames to `127.0.0.1:5434` for hybrid dev). `MADSAN_LEGACY_PYTHON=false`.
- [ ] **2. Full Go import** — worker running; enqueue **Legacy import (all)** from `/admin` (no `max_rows`). Scheduler also runs daily (`cmd/scheduler`). Avoid admin buttons capped at `max_rows: 5000` for cutover validation.
- [ ] **3. Parity CLI** — `go run ./cmd/legacy-parity` exits 0; all critical tables within 5% (or vessels ≥ legacy).
- [ ] **4. Admin panel** — Platform health **Parity** green; Runtime health table shows no critical **drift** badges.
- [ ] **5. Petroleum backfill** — if metals map shows energy assets, dry-run backfill; apply only when `would_update > 0`.
- [ ] **6. Go tests** — `go test ./internal/ingestion/... -run Legacy` passes.
- [ ] **7. Soak** — no `use_python: true` jobs for 30 days; monitor ingestion job `result_report.engine = "go"`.
- [ ] **8. Remove Python** — delete `legacy_import.py`, shell path, and `MADSAN_LEGACY_PYTHON` after checklist green in staging/production-like snapshot.

## Removal criteria

Retire Python legacy import when all are true:

1. **Parity** — Go import row counts match legacy for each critical table on a production-like snapshot (`oil_vessels`, `licenses`, `petroleum_osm_features`).
2. **No production dependency** — no scheduled or admin jobs use `use_python: true` for 30 days.
3. **Go owns edge cases** — nullable FKs, charset issues, and large batch limits handled in Go with tests.
4. **Docs/runbooks updated** — admin and README no longer reference Python fallback.

After cutover: delete `madsan/etl/legacy_import.py`, `run_legacy_import` shell path, and `MADSAN_LEGACY_PYTHON` config.

## Verification commands

```bash
cd madsan/backend
go test ./internal/ingestion/... -run Legacy
go run ./cmd/legacy-parity   # JSON report; exit 1 on critical drift > 5%
# Hybrid: enqueue "Legacy import (all)" from /admin with worker running
```

## GO_MIGRATION_ALIGNMENT

| Responsibility | Owner | Status |
|----------------|-------|--------|
| Legacy row import (`oil_vessels`, `licenses`, `petroleum_osm_features`, …) | Go `processLegacyImportGo` | **default** |
| Legacy import orchestration fallback | Python `legacy_import.py` | opt-in (`MADSAN_LEGACY_PYTHON` / `use_python`) |
| AIS positions read/sync | Go (legacy DB read + worker) | active |
| Parity validation | Go `cmd/legacy-parity` + admin health API | active |
| Petroleum `asset_type` correction | Go `cmd/backfill-petroleum-types` | on-demand |

## PYTHON_TECHNICAL_DEBT_ADDED_OR_REMOVED

- **Removed from default path:** Python no longer runs unless explicitly opted in.
- **Remaining debt:** `legacy_import.py`, `runLegacyImportScript`, `MADSAN_LEGACY_PYTHON` config and admin Python button — retire after parity checklist green.

## CUTOVER_PLAN

1. Run full Go **Legacy import (all)** with worker + scheduler.
2. Re-run `legacy-parity` until exit 0.
3. Confirm admin parity panel green for 24h (5m cache).
4. Disable Python flag in all envs; monitor 30 days.
5. Delete Python runner and config keys.

## ROLLBACK_PLAN

1. Set `MADSAN_LEGACY_PYTHON=true` in `madsan/deploy/.env` and restart API/worker.
2. Enqueue `{"use_python": true, "tables": ["<table>"], "max_rows": N}` for targeted replay.
3. Re-run `legacy-parity` to compare; Go path remains available — flip flag back to `false` when Go gap is fixed.
4. No schema rollback required; imports are upsert/idempotent per table.
