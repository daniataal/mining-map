# Oil Terminals vs Storage Reconcile Report

**Generated:** 2026-06-09 (UTC) — read-only SQL analysis  
**Databases:** legacy `mining_db` (:5434) vs MadSan `madsan_db` (:5433)

## Executive summary

| Legacy source | Count | MadSan mapping today |
|---|---:|---|
| `oil_terminals` (graph-sync) | **19,960** | **Not imported** as `terminal` |
| `petroleum_osm_features` (`storage_terminals`) | **79,435** | → `tank_farm` via `LayerToAssetType` |
| `petroleum_osm_features` (all) | **303,745** | pipelines + refineries + storage |
| `storage_terminal_display` | **24** | UI overlay only |

MadSan `assets` snapshot: `pipeline` 124,467 · `tank_farm` 23,465 · **`terminal` 0** · `refinery` 496.

`map_energy_assets` matview: 57,318 rows — **`terminal` 0**.

## Root cause

1. OSM `storage_terminals` maps to `tank_farm`, not `terminal` (`legacy_map.go`).
2. `oil_terminals` table has no legacy import adapter (~20k graph-sync nodes missing).
3. Job `53774b3f-7257-4f75-a175-ae4e5e5d5446` still importing `petroleum_osm_features` (~30% of storage layer in MadSan).

Legacy `oil_terminals` by type: `storage_tank` 18,962 · `storage_terminal` 908 · `tank_farm` 55 · other 91.

## Recommended actions

1. `./scripts/wait_legacy_import.sh` — poll job → `legacy-parity` green.
2. Add `oil_terminals` adapter → `terminal` with spatial+name dedup vs existing `tank_farm`.
3. Refresh `map_energy_assets` after import completes.

## GO_MIGRATION_ALIGNMENT

Legacy `mining_db` remains authoritative until parity green. Go `legacy_import` owns petroleum ETL — no new Python.

## ROLLBACK_PLAN

Report-only; no data changes.
