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

**Licenses — expected vs bug (honest tiers):**

CLI JSON includes `license_tiers` on the licenses row. Use `under_import_gap` as the bug signal, not raw row ratio.

| Tier / signal | Field | Expected? | Explanation |
|---------------|-------|-----------|-------------|
| No coordinates | `not_importable_no_coords` | **yes** | SQL filter in `legacy_read.go`; never imported (~2.6k) |
| Empty `company` after trim | `expected_skip_empty_name` | **yes** | Go `continue` when `rec.Name == ""` (non-vessel); 0 on current snapshot |
| Dedup collapse | `expected_dedup_keys` | **yes** | One asset per `(company, sector→asset_type, country)` via `upsertMaster`; ~73k geocoded rows → ~45.5k keys (~62% row ratio) |
| Madsan ≪ dedup keys after full import | `under_import_gap` | **bug** | Incomplete import, worker down, or upsert errors |
| Raw geocoded count as denominator | `import_pool_geocoded` | **informational** | Do not fail parity on ~38% “drift” vs this alone |

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
| `licenses` | 45,506 dedup keys | 45,503 | 0.01% | **pass** (`license_tiers.under_import_gap`: 3) |
| `petroleum_osm_features` | 303,745 | 70,526 | 76.8% | **fail** (under-imported) |

**Result:** `passed: false`, `failed_critical: ["petroleum_osm_features"]`. Vessels and licenses at dedup-key parity; petroleum OSM needs full Go import before Python retirement.

License tiers on this snapshot:

| Field | Count |
|-------|-------|
| `legacy_total` | 75,671 |
| `not_importable_no_coords` | 2,559 |
| `import_pool_geocoded` | 73,112 |
| `expected_skip_empty_name` | 0 |
| `expected_dedup_keys` | 45,506 |
| `under_import_gap` | 3 |

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
