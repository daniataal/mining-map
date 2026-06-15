# MadSan standalone repo exit checklist

MadSan V2 (`madsan/`) is the target standalone intelligence stack. This document tracks **data independence** — owning durable intelligence in `madsan_db` without ongoing reads from legacy `mining_db`.

## Data independence status (2026-06-10)

| Area | Status | Notes |
|------|--------|-------|
| Base legacy ETL (vessels, licenses, petroleum, terminals) | **GREEN (dev)** | `legacy-parity` exit 0 on hybrid dev DB |
| Phase A intelligence import | **CODE COMPLETE / IMPORTED (dev)** | All 8 tables implemented; dev counts match legacy |
| Migration `029_phase_a_legacy` | **APPLIED** | Idempotent import keys + `sts_zones` |
| Live AIS | **DIRECT INGEST** | `cmd/ais-ingest` when `AISSTREAM_API_KEY` set; API legacy 2-hop off by default |
| Python `legacy_import.py` | **SOAK** | Go default; 30-day no-`use_python` before deletion |
| Prod-like end-to-end | **NOT VERIFIED** | Dev snapshot green only |

### Phase A tables (implemented)

Source: `internal/ingestion/legacy_intelligence.go` · CLI: `cmd/legacy-phase-a` · Migration: `029_phase_a_legacy.up.sql`

| Legacy table | MadSan target | Critical parity |
|--------------|---------------|-----------------|
| `oil_port_calls` | `core_signals(port_call)` + `voyages` | yes |
| `oil_sts_events` | `core_signals(sts)` + `sts_zones` | yes |
| `eia_historic_imports` | `prices(eia_historic_import)` | yes |
| `oil_commercial_events` | `core_signals(commercial_event)` | no |
| `broker_deal_packs` | `deals` | no |
| `oil_company_contacts` | `contacts` | no |
| `oil_intelligence_cards` | `evidence(intel_card)` | no |
| `entity_relationships` | `relationships` | no (62% coverage expected) |

## Verify commands (hybrid dev)

Prerequisites: `madsan-db` on `:5433`, legacy `mining-db` on `:5434`, `madsan/deploy/.env` with `DATABASE_URL` and `LEGACY_DATABASE_URL` (no secrets printed here).

```bash
cd madsan/backend

# 1. Apply pending migrations (includes 029)
go run ./cmd/migrate

# 2. Parity gate — exit 0 = pass
go run ./cmd/legacy-parity

# 3. Phase A dry-run (counts only)
go run ./cmd/legacy-phase-a --dry-run

# 4. Phase A import + parity (when counts are behind)
go run ./cmd/legacy-phase-a --parity

# 5. Single-table re-import
go run ./cmd/legacy-phase-a --tables eia_historic_imports --parity
```

### Latest dev parity snapshot (2026-06-10T18:42Z)

- **passed:** `true` (threshold 5%)
- **Critical tables:** all green
  - `oil_vessels` → 9,595 legacy / 9,679 madsan (live AIS may exceed)
  - `licenses` → 45,506 / 45,503 (3-key under-import gap)
  - `oil_port_calls` → 66,495 / 66,495
  - `oil_sts_events` → 17,574 / 17,574
  - `eia_historic_imports` → 746,387 / 746,387
  - `oil_terminals` → 19,960 / 19,968
  - `petroleum_osm_features` → 217,106 dedup keys / 217,106
- **Non-critical drift:** `entity_relationships` 20,967 → 13,054 (62.3% coverage — import requires license asset + resolvable target company; does not fail gate)

## Production import commands

Run from a host that can reach **both** databases. Use read-only credentials on legacy where possible. Do not delete or truncate production data.

```bash
cd madsan/backend

# Set connection strings for prod (from your secret store — not committed)
export DATABASE_URL='postgresql://USER:PASS@HOST:PORT/madsan_db?sslmode=require'
export LEGACY_DATABASE_URL='postgresql://USER:PASS@HOST:PORT/mining_db?sslmode=require'

# Step 1 — schema (idempotent)
go run ./cmd/migrate

# Step 2 — base tables (if not already imported via worker)
# Enqueue via admin API or scheduler, or run worker with legacy_import job.
# One-shot CLI for tier-1 tables is the daily worker path; for bulk:
go run ./cmd/worker   # processes pending legacy_import jobs

# Step 3 — Phase A intelligence (one-time or catch-up)
go run ./cmd/legacy-phase-a --parity

# Step 4 — verify gate before cutover
go run ./cmd/legacy-parity
# exit 0 required; override threshold only for investigation:
# MADSAN_PARITY_THRESHOLD_PCT=10 go run ./cmd/legacy-parity

# Step 5 — live AIS (after base import)
# deploy/.env: set AISSTREAM_API_KEY (API disables legacy 2-hop sync automatically)
go run ./cmd/ais-ingest
```

## Live AIS independence

| Mode | When | Writer |
|------|------|--------|
| **Direct (preferred)** | `AISSTREAM_API_KEY` set | `go run ./cmd/ais-ingest` → `madsan_db.vessels` |
| **Legacy 2-hop (transitional)** | No AIS key, `MADSAN_AIS_SYNC=true` | API syncs `mining_db.oil_ais_positions` → `madsan_db` |

When `AISSTREAM_API_KEY` is set:

- `MADSAN_AIS_SYNC` defaults to **false**
- `MADSAN_AIS_DIRECT` defaults to **true**
- API logs: `ais: direct ingest mode — legacy 2-hop sync disabled; run cmd/ais-ingest`

Explicit override for transitional dev only: `MADSAN_AIS_DIRECT=false MADSAN_AIS_SYNC=true`.

## Remaining blockers for full data independence

1. **Prod parity not re-run** — dev snapshot is green; repeat `legacy-parity` on prod `madsan_db` after import.
2. **`LEGACY_DATABASE_URL` still required** — one-time imports, parity gate, MCR/voyage rebuild jobs optionally read legacy until those paths are retired.
3. **Python ETL soak** — `MADSAN_LEGACY_PYTHON=false` default; delete `etl/legacy_import.py` only after 30-day soak (~2026-07-10).
4. **`entity_relationships` partial coverage** — by design (entity resolution); not a parity gate failure.
5. **Prod `ais-ingest` service** — compose profile `ais` (`madsan-ais-ingest`); requires `AISSTREAM_API_KEY` in `deploy/.env`. Host `go run ./cmd/ais-ingest` still valid for hybrid dev.
6. **GEM / tier-2 sources** — `cmd/legacy-tier2` for GEM xlsx + remaining legacy tables; separate from Phase A.

## GO migration alignment

- **Permanent path:** Go `cmd/legacy-phase-a`, `cmd/legacy-parity`, `cmd/ais-ingest`, worker `legacy_import` (Go engine).
- **Transitional:** Python `legacy_import.py` (opt-in `MADSAN_LEGACY_PYTHON=true`), legacy 2-hop AIS sync.
- **Single source of truth after cutover:** `madsan_db` only; legacy DB read-only for parity verification until decommissioned.

## Rollback

- Re-enable legacy AIS: unset `AISSTREAM_API_KEY` or set `MADSAN_AIS_DIRECT=false` + `MADSAN_AIS_SYNC=true`.
- Re-run Python import: `MADSAN_LEGACY_PYTHON=true` on worker + enqueue `legacy_import` with `use_python`.
- Imports are idempotent (migration 029 unique keys); re-running Phase A is safe, not destructive.
