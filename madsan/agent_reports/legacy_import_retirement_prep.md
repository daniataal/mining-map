# Legacy `legacy_import.py` retirement prep (2026-06-10)

Branch: `new-refactor-eng-style`. Canonical doc: `madsan/docs/LEGACY_ETL_DEPRECATION.md`.

## Checklist 4–8 status

| # | Item | Status |
|---|------|--------|
| 4 | Admin parity panel | **Partial** — CLI + API share `RunLegacyParity` (green on dev); confirm `/admin` Runtime health UI with auth |
| 5 | Petroleum backfill | **Done** — dry-run `would_update=0` |
| 6 | Go tests | **Done** |
| 7 | 30-day soak | **In progress** — start **2026-06-10**, end **2026-07-10** |
| 8 | Remove Python | **Gated** — no file deletes until soak + prod-like parity |

## Verified today

- `go run ./cmd/legacy-parity` → exit **0** (all critical tables green; petroleum dedup keys 217,106).
- `go test ./internal/ingestion/...` → pass.
- API `/health/live` → 200 on `:8088`.
- Code defaults: `MADSAN_LEGACY_PYTHON=false`; Go path unless explicit opt-in.

## Remove now vs after soak

**Do not remove yet (rollback):** `legacy_import.py`, `run_legacy_etl.sh`, `MADSAN_LEGACY_PYTHON`, admin Python button, `runLegacyImportScript`.

**After 2026-07-10** (if soak SQL clean + parity green on prod-like snapshot): delete Python artifacts per gated table in `LEGACY_ETL_DEPRECATION.md`.

## GO_MIGRATION_ALIGNMENT

Go owns default legacy import; Python is opt-in bridge only until soak completes.

## ROLLBACK_PLAN

Unchanged: `MADSAN_LEGACY_PYTHON=true` + `use_python` enqueue + re-run `legacy-parity`.
