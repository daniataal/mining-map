# Archived ETL scripts

## `legacy_import.py` — 30-day soak retirement

**Status:** Deprecated. Go-native import is the default (`MADSAN_LEGACY_PYTHON=false`).

| Milestone | Date |
|-----------|------|
| Parity green on critical tables | 2026-06-10 |
| Earliest deletion | 2026-07-10 (30-day no-`use_python` soak) |

Rollback: set `MADSAN_LEGACY_PYTHON=true` or enqueue `legacy_import` with `use_python: true`.

After soak: delete this file, `runLegacyImportScript`, and `MADSAN_LEGACY_PYTHON` config. See `docs/LEGACY_ETL_DEPRECATION.md`.
