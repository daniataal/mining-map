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

## Removal criteria

Retire Python legacy import when all are true:

1. **Parity** — Go import row counts match Python for each supported table on a production-like snapshot (`oil_vessels`, `licenses`, evidence enqueue counts).
2. **No production dependency** — no scheduled or admin jobs use `use_python: true` for 30 days.
3. **Go owns edge cases** — nullable FKs, charset issues, and large batch limits handled in Go with tests.
4. **Docs/runbooks updated** — admin and README no longer reference Python fallback.

After cutover: delete `madsan/etl/legacy_import.py`, `run_legacy_import` shell path, and `MADSAN_LEGACY_PYTHON` config.

## Verification

```bash
cd madsan/backend
go test ./internal/ingestion/... -run Legacy
# Hybrid: enqueue "Vessels refresh (Go)" from /admin with worker running
```
