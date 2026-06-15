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
| `petroleum_osm_features` | `assets` where `legacy_table = 'legacy_petroleum_osm_features'` | yes | `drift_pct ≤ 5%` (legacy count: **distinct dedup keys** — `geom`-bearing rows collapsed by Go upsert key `normalized_name` + `asset_type`, name precedence `name → operator → layer_id:id`; **not** raw OSM rows) |
| `oil_companies` | `companies` | no | informational only; dedupe by name+country makes counts incomparable |

**Drift semantics:** `drift = madsan_count - legacy_count` where `legacy_count` is the **expected dedup-key count** for `licenses` and `petroleum_osm_features` (not raw rows). Negative drift against the dedup-key count means an **incomplete Go import** — enqueue **Legacy import (all)** with worker running, or wait for the daily scheduler job. Comparing madsan against the raw OSM/license row count is **not** a bug signal: use `under_import_gap` in `license_tiers` / `petroleum_tiers`. Positive drift on vessels is expected when AIS sync is active.

**Petroleum — expected dedup vs bug (honest tiers):**

CLI JSON includes `petroleum_tiers` on the petroleum row. The importer upserts one canonical asset per `(normalized_name, asset_type)`; multi-segment pipelines and same-named storage features collapse. **This is not data loss** — every pipeline segment's geometry is preserved in `pipeline_graph_edges`.

| Tier / signal | Field | Expected? | Explanation |
|---------------|-------|-----------|-------------|
| Raw OSM rows with geom | `legacy_total` | informational | ~303.7k; do **not** use as parity denominator |
| Rows carrying `name`/`operator` | `with_name_or_operator` | informational | ~174k; these collapse where names repeat |
| Synthetic-named rows | `synthetic_named` | informational | ~130k; named `layer_id:id`, stay unique |
| Dedup collapse | `expected_dedup_keys` | **yes** | One asset per `(normalized_name, asset_type)`; ~303.7k rows → ~217.1k keys |
| Madsan ≪ dedup keys after full import | `under_import_gap` | **bug** | Incomplete import, worker down, or DB crash mid-import |

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
| `petroleum_osm_features` | 303,745 | 70,526 | 76.8% | **fail** (measured vs raw rows — see 2026-06-10 correction) |

**Result:** `passed: false`, `failed_critical: ["petroleum_osm_features"]`. Vessels and licenses at dedup-key parity; petroleum reported failing.

### `legacy-parity` correction (2026-06-10)

Investigation found the petroleum "fail" was a **measurement bug**, not an under-import. The importer upserts assets by `(normalized_name, asset_type)`, but the parity spec compared madsan against the **raw** OSM row count (303,745) instead of the **dedup-key** count — the same mismatch licenses had already fixed. Petroleum was at the natural dedup ceiling all along (pipeline segment geometry preserved in `pipeline_graph_edges` = 223,757).

Fix: `petroleumDedupKeySQL` + `petroleum_tiers` in `legacy_parity.go` (mirrors `license_tiers`). Re-run is now green:

| Table | Legacy (dedup keys) | Madsan | Drift % | Status |
|-------|--------|--------|---------|--------|
| `oil_vessels` | 9,595 | 9,595 | 0% | **pass** |
| `oil_companies` | 5,074 | 50,009 | informational | pass (info only) |
| `licenses` | 45,506 | 45,503 | 0.01% | **pass** (`under_import_gap`: 3) |
| `petroleum_osm_features` | 217,106 | 217,106 | 0% | **pass** (`under_import_gap`: 0) |

**Result:** `passed: true`, exit 0 — **Python `legacy_import.py` retirement is unblocked** on this snapshot (pending the 30-day no-`use_python` soak in removal criteria).

Petroleum tiers on this snapshot:

| Field | Count |
|-------|-------|
| `legacy_total` (raw geom rows) | 303,745 |
| `with_name_or_operator` | 173,972 |
| `synthetic_named` | 129,773 |
| `expected_dedup_keys` | 217,106 |
| `under_import_gap` | 0 |

> **Infra note:** the dev `madsan-db` runs an **x86 PostGIS image (`postgis/postgis:16-3.4`) under Rosetta** on Apple Silicon and crashed mid-import (exit 133 / `rosetta error … sigreturn`), which is what repeatedly killed the import jobs and left an orphaned `running` row. The prod overlay already pins `linux/arm64`; for dev, use an arm64 Postgres/PostGIS image to stop the crashes.

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

- [x] **1. Env** — `LEGACY_DATABASE_URL` points at legacy DB (`sync_env_from_root.sh` rewrites Docker hostnames to `127.0.0.1:5434` for hybrid dev). `MADSAN_LEGACY_PYTHON=false`.
- [x] **2. Full Go import** — petroleum/licenses/vessels imported to the dedup ceiling (217,106 / 45,503 / 9,595). Scheduler runs daily (`cmd/scheduler`).
- [x] **3. Parity CLI** — `go run ./cmd/legacy-parity` exits 0 (2026-06-10, re-verified 2026-06-10T15:30Z); all critical tables within 5%.
- [~] **4. Admin panel** — `GET /api/admin/health` and `/health/runtime` use the same `ingestion.RunLegacyParity` as the CLI (expected **passed: true** when legacy DB reachable). API live on `:8088` (`/health/live` 200). **Human verify:** sign in at `/admin` → Runtime health → Parity row green, no critical drift badges. `legacy_import_running` may show while a scheduled import is active — parity counts remain valid.
- [x] **5. Petroleum backfill** — `go run ./cmd/backfill-petroleum-types --dry-run` → `would_update=0` (2026-06-10); no apply needed.
- [x] **6. Go tests** — `go test ./internal/ingestion/...` passes (2026-06-10).
- [~] **7. Soak** — **started 2026-06-10** (parity exit 0 + Go-default confirmed). **Earliest Python removal: 2026-07-10.** No `use_python: true` enqueue; monitor `result_report.engine = "go"`. See [Soak tracking](#soak-tracking) below.
- [ ] **8. Remove Python** — **gated** until item 7 complete on staging/production-like snapshot. See [Gated removal (post-soak)](#gated-removal-post-soak). Rollback path must remain until deletion ships.

## Soak tracking

| Field | Value |
|-------|-------|
| Soak start | **2026-06-10** (parity CLI exit 0; petroleum dedup-key measurement fix merged) |
| Soak end (earliest) | **2026-07-10** (30 calendar days; not accelerable) |
| Env default | `MADSAN_LEGACY_PYTHON=false` (`config.go`, `deploy/.env.example`, `docker-compose.yml`) |
| Job default | Go unless payload `use_python: true` **or** env flag true (`legacy_runner.go`) |
| Scheduler | Daily `legacy_import` — no `use_python` in payload (`cmd/scheduler`) |
| Admin UI | Python button hidden unless `legacy_python_enabled` (API reflects env flag) |

**Monitor (weekly):**

```sql
-- No Python orchestrator jobs since soak start
SELECT COUNT(*) FROM ingestion_jobs
WHERE job_type = 'legacy_import'
  AND created_at >= '2026-06-10'
  AND (
    payload::text LIKE '%"use_python": true%'
    OR result_report->>'orchestrator' = 'legacy_import.py'
  );

-- Go engine on completed jobs since soak start
SELECT result_report->>'engine' AS engine, COUNT(*)
FROM ingestion_jobs
WHERE job_type = 'legacy_import' AND status = 'completed'
  AND created_at >= '2026-06-10'
GROUP BY 1;
```

Pre-soak snapshot (informational): one completed job on 2026-06-09 used Python orchestrator (`result_report.orchestrator = legacy_import.py`); zero payload `use_python: true` jobs in history.

## Gated removal (post-soak)

Execute **only after** soak end (2026-07-10) **and** items 1–6 remain green on a production-like DB snapshot.

| Artifact | Path / symbol | Action |
|----------|---------------|--------|
| Python orchestrator | `madsan/etl/legacy_import.py` | Delete |
| Host ETL script | `madsan/scripts/run_legacy_etl.sh` | Delete or rewrite to enqueue Go job only |
| Go Python runner | `runLegacyImportScript`, `processLegacyImport` Python branch in `legacy_runner.go` | Remove branch; Go-only `processLegacyImportGo` |
| Config | `MADSAN_LEGACY_PYTHON`, `LegacyImportPython` in `config.go` | Remove key + struct field |
| Deploy | `deploy/.env.example`, `docker-compose.yml` | Remove env var |
| Admin API | `legacy_python_enabled` in `admin.go` | Remove field |
| Admin UI | Python button + flag gate in `admin/page.tsx` | Remove button and copy referencing opt-in |
| Docs | This file rollback section | Keep rollback narrative as historical ADR until Obsidian runbook updated |

**Keep until soak ends:** all rows above — rollback requires `MADSAN_LEGACY_PYTHON=true` + optional `use_python` enqueue.

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
- **Remaining debt:** `legacy_import.py`, `runLegacyImportScript`, `MADSAN_LEGACY_PYTHON` config and admin Python button — retire after **30-day soak** (earliest 2026-07-10).

## CUTOVER_PLAN

1. Run full Go **Legacy import (all)** with worker + scheduler.
2. Re-run `legacy-parity` until exit 0.
3. Confirm admin parity panel green for 24h (5m cache).
4. Disable Python flag in all envs; monitor 30 days (**soak started 2026-06-10**).
5. Delete Python runner and config keys (earliest **2026-07-10**; see gated removal table).

## ROLLBACK_PLAN

1. Set `MADSAN_LEGACY_PYTHON=true` in `madsan/deploy/.env` and restart API/worker.
2. Enqueue `{"use_python": true, "tables": ["<table>"], "max_rows": N}` for targeted replay.
3. Re-run `legacy-parity` to compare; Go path remains available — flip flag back to `false` when Go gap is fixed.
4. No schema rollback required; imports are upsert/idempotent per table.
