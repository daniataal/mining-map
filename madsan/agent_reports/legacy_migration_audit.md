# Legacy → MadSan Migration Audit (2026-06-10)

Full inventory of the legacy `mining_db` (:5434) vs what MadSan V2 (`madsan_db` :5433) actually imports. Goal: decide what content to migrate next so the built engine stops running on a thin data slice.

## Method

- Counts are **exact `COUNT(*)`** on both DBs (the `pg_stat_user_tables.n_live_tup` estimates are stale — they report `oil_terminals=0` and `madsan.assets≈0`, both false — so they were not used).
- "Mapped" = imported by `legacyTableCatalog` in `internal/ingestion/legacy_read.go` or read by a live path.
- North-star pillars: **discover → verify → price → execute**.

## Verdict

MadSan imports **4 of ~95 legacy tables**. The engine (map, dossiers, deals, search) is built, but most of the legacy intelligence — prices history, port calls, terminals, STS, intelligence cards, GEM, procurement leads — is **stranded and unmapped**.

| | Tables | Notable rows |
|---|---|---|
| **Migrated** (mapped) | 4 (+1 live read, +1 seed) | 217k petroleum assets, 45.5k licenses, 9.6k vessels |
| **High-value, UNMAPPED, has data** | ~16 | 746k EIA history, 1.98M AIS positions, 66k port calls, 60k intel cards, 20k terminals, 17k STS |
| **Empty in legacy** (no value now) | ~55 | trade_records, dd_reports, port_manifests, raw_documents, satellite_observations, … all 0 |

## Migrated today (what the platform runs on)

| Legacy table | Rows | MadSan target | Notes |
|---|---|---|---|
| `petroleum_osm_features` | 303,745 | `assets` (217,106) + `pipeline_graph_edges` (223,757) | OSM-only; dedup ceiling reached, parity green |
| `licenses` | 77,369 | `assets` (45,503) | dedup-key parity green |
| `oil_vessels` | 9,595 | `vessels` (9,595) | 100% |
| `oil_companies` | 5,074 | `companies` | partial; most of madsan's 50k companies are OSM operator stubs, not this table |
| `oil_ais_positions` | 1,976,227 | live AIS read only | latest position synced to `vessels`; **history not stored** |
| *(bunker seed file)* | 5,282 | `companies` (supplier) | from `data/bunker_fuel_suppliers_seed.json`; only 209 have commodities, 158 contacts total |

## High-value UNMAPPED (has data) — ranked migration candidates

| Rank | Legacy table | Rows | Pillar | Why it matters | Suggested MadSan target |
|---|---|---|---|---|---|
| 1 | `eia_historic_imports` | **746,387** | **price** | Closes the empty Price pillar (`prices=0`); real trade/import history for ticker + deal price-context | `prices` / `commodities` |
| 2 | `oil_terminals` | **19,960** | discover | Plan flagged `oil_terminals=0` reconcile; promotes real terminals into canonical `assets` (map density) | `assets` (terminal) |
| 3 | `oil_port_calls` | **66,495** | verify | Voyage legs, terminal activity → vessel intelligence, MCR voyages, "where from/to" | `core_signals` / new `voyages` |
| 4 | `oil_sts_events` | **17,574** | verify | STS detections feed the 6-factor scorer + dark-fleet signals | `core_signals` |
| 5 | `oil_intelligence_cards` | **59,760** | verify | Pre-built intelligence/dossier content | `evidence` / dossier enrichment |
| 6 | `oil_commercial_events` | **60,547** | verify | Commercial activity signals (recency for supplier credibility) | `core_signals` |
| 7 | `entity_relationships` | **20,967** | verify | Entity graph edges ("who is behind this") | `relationships` |
| 8 | `oil_company_contacts` | **330** | execute | Real contacts (madsan has only 158) for supplier outreach | `contacts` |
| 9 | `gem_pipeline_segments` | **1,512** | discover | The only GEM data in any DB; richer pipeline attributes | `pipeline_graph_edges` / `assets` |
| 10 | `eu_procurement_notices` | **433** | discover | Procurement leads → unknown-supplier discovery (Phase 8f) | `leads` |
| 11 | `gov_procurement_awards` | **251** | discover | Awardee leads | `leads` |
| 12 | `meridian_cargo_records` | **470** | verify | MCR ground-truth labels for confidence calibration (MCR v2) | `core_signals` / mcr |
| 13 | `oil_trade_flows` | **306** | price | Corridor trade context | `commodities` / signals |
| 14 | `broker_deal_packs` | **7** | execute | Prior deal packs (low volume, but real deal history) | `deals` |
| 15 | `oil_alerts` | **374** | execute | Watchlist/alert seeds for living deal packs (9b) | `deal_change_events` / alerts |
| 16 | `core_assets` / `core_organizations` / `core_source_records` / `core_asset_relationships` | 128 / 139 / 125 / 237 | verify | A prior canonical layer; small but already-curated; useful for reconciliation | `assets` / `companies` / `evidence` |

### Not worth migrating now
- `map_feature_popup_payload` (325,217) — **derived/precomputed popups**; MadSan generates these from MVT + `/api/assets/:id`, so re-ingesting is redundant.
- `oil_ais_positions` **history** (1.98M) — only the latest position is needed live; full history is heavy and low-value until voyage reconstruction is built.

## GEM trackers — downloaded but never ingested

Three GEM `.xlsx` files sit at the repo root and reach **neither** DB at scale:

| File | Size | In any DB? |
|---|---|---|
| `Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx` | 5.4 MB | **No** |
| `Global-Oil-and-Gas-Plant-Tracker-GOGPT-January-2026.xlsx` | 3.2 MB | **No** |
| `GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx` | 0.47 MB | only 1,512 rows in legacy `gem_pipeline_segments` |

There is no xlsx loader in `madsan/etl/` (only `legacy_import.py`). All GEM attributes (operator, capacity, status, ownership, commissioning year) are missing — the petroleum map is 100% OSM-derived.

## Coverage by pillar

| Pillar | State | Biggest unlock |
|---|---|---|
| **Discover** | Strong (262k assets) but OSM-only | `oil_terminals` (20k) + GEM trackers |
| **Verify** | Engine done, signals thin | `oil_port_calls`, `oil_sts_events`, `oil_intelligence_cards`, `entity_relationships` |
| **Price** | **Empty** (`prices=0`) | `eia_historic_imports` (746k) |
| **Execute** | 2 test deals, 158 contacts | `oil_company_contacts`, bunker enrichment, `broker_deal_packs` |

## Recommended order

1. **EIA history → `prices`** — single biggest gap (opens the Price pillar). 746k rows already in legacy.
2. **`oil_terminals` → `assets`** — cheap, fixes the known `oil_terminals=0` reconcile and densifies the map.
3. **GEM trackers ingest** — new Go xlsx source for attributed oil/gas infra (operator/capacity/status).
4. **`oil_port_calls` + `oil_sts_events` → signals** — feeds vessel intelligence + the 6-factor STS scorer that's already wired.
5. **Bunker supplier enrichment** — commodities/contacts/locations for the 5,282 suppliers (only 4% tagged today).
6. **Procurement notices/awards → leads** — Phase 8f unknown-supplier discovery.

## Guardrails for any migration
- Add each as a row in `sources` + a spec in `legacyTableCatalog`; reuse the existing staging → normalize → upsert → evidence path. No new Python.
- Define an honest dedup key per table and a dedup-aware `legacy-parity` spec (as done for licenses + petroleum) — do **not** compare against raw row counts.
- Preserve provenance + tier; route uncertain rows to `manual_review_queue`.
- Switch the dev DB to an **arm64** PostGIS image first — the x86/Rosetta image crashes under bulk-import load (exit 133).
