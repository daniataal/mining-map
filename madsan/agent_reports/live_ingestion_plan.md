# MadSan Live Ingestion Plan (2026-06-10)

How MadSan V2 acquires data going forward — replacing the heavy legacy two-stack pipeline (Python `backend/services/` + Go `oil-live-intel/` + Elasticsearch, all writing into one 95-table `mining_db`) with **Go-native scheduled ingestion** through `scheduler → ingestion_jobs → worker`.

North star: **discover → verify → price → execute**, honest tiers, evidence on every record, map-first, fast on one ARM VM.

---

## 1. How the legacy data was acquired (provenance)

Two stacks wrote into `mining_db`:

**Python `backend/services/` — external API/file pulls + enrichment** (each tracked by a `*_sync_runs` table):

| Source | Legacy puller | Method | Legacy table | Rows |
|---|---|---|---|---|
| EIA | `eia_imports.py`, `eia_historic_imports.py` | API + bulk file (`eia_historic_file_state`) | `eia_historic_imports` | 746,387 |
| OSM infra | `petroleum_osm_overpass.py` | Overpass API by layer (`petroleum_osm_sync_runs`) | `petroleum_osm_features` | 303,745 |
| UN Comtrade | `comtrade_*.py`, `comtrade_keys.py` | API, year-by-year | trade flows | 0 now |
| Eurostat / JODI | `oil_live_graph_sync.py` | API / CSV (`oil_live_sync_state`: eurostat ok=500; JODI skipped, needs `JODI_CSV_URL`) | trade snapshots | small |
| TED EU procurement | `eu_procurement_intel.py` | API (`eu_procurement_sync_runs`) | `eu_procurement_notices` | 433 |
| Gov procurement | `gov_procurement_intel.py` | API | `gov_procurement_awards` | 251 |
| Licenses | bulk import + `license_sync_store.py` | file/bulk | `licenses` | 77,369 |
| GEM | manual | xlsx (barely loaded) | `gem_pipeline_segments` | 1,512 |
| Companies/contacts | `supplier_enrichment.py`, `oil_live_contact_enrichment.py`, `wikidata_company_enrichment.py` | API/scrape enrichment | `oil_companies`, contacts | 5,074 |

**Go `oil-live-intel/` — live stream + derived + serving:**

- **AIS** is the only truly *live* feed: AISStream → `oil_vessels` + `oil_ais_positions` (1.98M).
- **Derived (computed, not pulled):** `portcall`, `sts`, `syntheticbol` (MCR), `volume`, `dealpack` — computed from AIS.
- `graphsync` progressively took ownership from Python via `OIL_GRAPH_SYNC_GO_*` flags.

**Why it was heavy:** two backends + the 1,699-line `oil_live_graph_sync.py` orchestrator + Elasticsearch + full AIS history (1.98M) + precomputed payload tables (`map_feature_popup_payload` 325k) in one DB.

---

## 2. Current MadSan ingestion (what exists today)

- **Scheduler** (`cmd/scheduler`) enqueues only 4 job types: `watch_folder` (6h), `bunker_seed` (7d), `legacy_import` (24h), `deal_watch_scan` (1h).
- **Worker** (`cmd/worker`) polls `ingestion_jobs` (`FOR UPDATE SKIP LOCKED`, 5s) and `ProcessJob` dispatches: `watch_folder`, `bunker_seed`, `legacy_etl`, `legacy_import` (Go default), `deal_watch_scan`.
- **No live external-API ingestion adapters yet.** But the live-API pattern is already proven inline:
  - `internal/markets/eia.go` — `api.eia.gov/v2`, cached, `EIA_API_KEY`.
  - `internal/compliance/opensanctions.go` — live screening.
- Pipeline per job: fetch → `stageRecord` → `upsertMaster` (dedup) → `attachEvidence` → `persistImportSignals` → targeted matview refresh.

---

## 3. Two acquisition tracks

| | Track A — Legacy backfill (ETL) | Track B — Live Go adapter (permanent) |
|---|---|---|
| What | Read existing rows from `mining_db` | Call the external API/file on a schedule |
| Speed | Instant, no rate limits | Bound by API limits/cadence |
| Freshness | Frozen snapshot | Live |
| Use when | Data already in legacy + needed now | Permanent path; enables deleting legacy DB **and** Python |
| Status | Working (`legacy_import`, parity green) | Pattern proven (`eia.go`), not yet wired as ingestion jobs |

**Rule of thumb:** backfill from legacy for instant history; add the Track-B adapter so the source stays fresh and the legacy hop can be retired. For clean public APIs (EIA, Comtrade, Eurostat, TED), prefer **Track B directly** (Go-native, skip the legacy/Python hop) per the Go-backend mandate.

---

## 4. Live adapter contract (the reusable recipe)

Adding one live source = a small, repeatable change (template: `eia.go`):

1. **Registry** — insert a `sources` row: `slug`, `source_type` (`api` | `file` | `stream` | `derived`), `category`, `vertical`, `refresh_schedule`, `reliability_score`, `endpoint`, `enabled`.
2. **Adapter** — one Go file (e.g. `internal/sources/<slug>/adapter.go`) that fetches and emits `[]NormalizedRecord` (entity_type, name, geo, commodities, raw_payload, external_id, source_slug). Reuse the cached-HTTP-client + ETag/hash pattern from `eia.go`.
3. **Dispatch** — add `case "<slug>"` in `ProcessJob`; add a `schedules` entry in `cmd/scheduler`.
4. **Worker** does the rest: hash/ETag skip-if-unchanged → raw snapshot → `stageRecord` → normalize → dedup (per-source key) → `upsertMaster` → `attachEvidence` (tier + confidence) → uncertain → `manual_review_queue` → targeted matview refresh → import report.
5. **Config** — API key via `config.go` (`EIA_API_KEY` pattern).
6. **Parity (if also backfilled)** — add a **dedup-aware** `legacy-parity` spec (never compare against raw row counts; see licenses/petroleum precedent).

**Derived intelligence is NOT a pull:** port_calls, STS, MCR, volume become **worker jobs that compute from `vessels`/positions** in Go (`internal/intelligence`, `internal/maritime`), tiered observed vs inferred.

---

## 5. Per-source ingestion plan

Legend — Track: **A** backfill, **B** live adapter, **D** derived, **S** stream. Status: ✅ done · ◐ partial · ○ todo.

| Source | Track | Endpoint / origin | Auth | Cadence | MadSan target | Dedup key | Tier | Status |
|---|---|---|---|---|---|---|---|---|
| AISStream | S | wss AISStream | key | live | `vessels` (+positions) | mmsi | observed | ◐ (madsan AIS sync) |
| **EIA prices** | **B** | `api.eia.gov/v2` | `EIA_API_KEY` | daily | `prices` | series+date | observed | ○ (client exists, not persisted) |
| OSM petroleum | A→B | Overpass API | none | monthly | `assets` + `pipeline_graph_edges` | name+type / osm_id | observed | A ✅ / B ○ |
| GEM trackers | B | repo `.xlsx` (extraction/plant/GOIT) | none | on update | `assets` | gem_id | observed | ○ (never ingested) |
| Licenses | A→B | bulk file + portal | none | quarterly | `assets` | company+type+country | observed | A ✅ |
| EIA history | A→B | legacy `eia_historic_imports` | — | once + B daily | `prices`/`commodities` | flow+period | observed | ○ (746k stranded) |
| UN Comtrade | B | `comtradeapi.un.org` | sub key | monthly | `commodity_trade_flows` | reporter+partner+hs+period | observed | ○ |
| Eurostat | B | Eurostat REST | none | monthly | trade flows | dataset+dims | observed | ○ (legacy proved 500 rows) |
| JODI | B | `JODI_CSV_URL` | none | monthly | trade snapshots | country+product+period | observed | ○ (needs URL) |
| TED procurement | B | TED API | none | weekly | `leads` | notice_id | observed | ○ (433 in legacy) |
| Gov procurement | B | national/USAspending | varies | weekly | `leads` | award_id | observed | ○ (251 in legacy) |
| GLEIF (LEI) | B | `api.gleif.org` | none | enrichment | `companies` | LEI | observed | ○ |
| OpenSanctions | B | yente/API | key | on-demand + weekly | `risk_flags` | entity_id | observed | ◐ (screening inline) |
| SEC EDGAR | B | `data.sec.gov` | none | enrichment | `companies` | CIK | observed | ○ |
| USGS MRDS/MCS | A/B | USGS file/API | none | quarterly | `assets` (metals) | dep_id | observed | ○ (Metals vertical) |
| Port calls | D | from AIS | — | hourly job | `core_signals`/`voyages` | vessel+port+ts | inferred | ○ (66k in legacy) |
| STS events | D | from AIS | — | hourly job | `core_signals` | pair+ts | observed/inferred | ◐ (scorer wired) |
| MCR | D | from AIS+manifests | — | nightly job | mcr/signals | recipe+voyage | inferred | ○ (scaffold) |
| Copernicus (tank vol) | B | Sentinel-1/2 | free acct | deferred | signals | tile+date | satellite-derived | ○ (deferred, CPU-heavy) |

> Don't rewrite — **port** the proven legacy pullers (`petroleum_osm_overpass.py`, `comtrade_*.py`, `eu_procurement_intel.py`, `eia_*.py`) into Go adapters; keep their endpoint/auth logic.

---

## 6. Performance & safety (stay smooth on one ARM VM)

- **No Elasticsearch, no Redis** — Postgres FTS + Postgres-backed queue (already chosen).
- **Hash/ETag skip** unchanged sources; **batch** 500–5000; **3 retries**; 30–60s API timeout; heavy jobs **off-peak**.
- **Never refresh all matviews** per small import — targeted per job type (already shipped).
- **Don't store firehose history** in the request path — keep latest AIS for live; archive/aggregate positions; derive port_calls/STS in jobs.
- **Rate-limit etiquette:** respect per-API quotas (Comtrade keys, Overpass fair-use); 1 worker initially.
- **Dev DB must be arm64 PostGIS** — the current x86/Rosetta image crashes under bulk-import load (exit 133), which is what kept killing imports. Fix before scaling ingest.
- Every record carries **source + tier + freshness + confidence**; uncertain → `manual_review_queue`; user/supplier submissions enter the same path tagged low-reliability.

---

## 7. Phased rollout (recommended order)

1. **EIA → `prices` (Track B)** — reuses `eia.go`; opens the empty Price pillar; becomes the **adapter template** every other API copies.
2. **Generalize** the adapter into `internal/sources` (registry-driven dispatch) once EIA proves the shape.
3. **`oil_terminals` backfill (Track A)** — cheap, fixes `oil_terminals=0`, densifies map.
4. **GEM trackers (Track B, xlsx)** — attributed oil/gas infra (operator/capacity/status).
5. **OSM Overpass live (Track B, monthly)** — map self-updates without legacy.
6. **Derived jobs** — port_calls + STS from AIS into `core_signals` (feeds the wired 6-factor scorer).
7. **Comtrade / Eurostat / TED / gov-proc (Track B)** — trade context + supplier leads.
8. **Enrichment (GLEIF/SEC/Wikidata)** — company credibility for supplier ranking.

Track A (legacy backfill) runs in parallel to populate now; Track B replaces each source for freshness, then the legacy table can be dropped from the import catalog.

---

## 8. Legacy retirement criteria

Retire a legacy source + its Python puller when:
1. Track-B Go adapter is live and writing to master with evidence/tier.
2. Dedup-aware parity (or freshness check) green for ≥1 cycle.
3. No production path depends on the Python puller for 30 days.
4. Docs/runbooks updated (`docs/DATA_SOURCES.md`, this plan).

End state: AIS stream + a set of Go API/file adapters + derived intelligence jobs, all on the Postgres queue — **no `mining_db`, no Python `backend/services/`, no Elasticsearch.**

---

## 8b. Vessel intelligence: live AIS + owner/operator cache (performance-first)

Two distinct problems behind the "VALERY ROMA is registry-only, no owner" dossier.

### Problem A — positions not live

Today: AIS sync is **off** (`MADSAN_AIS_SYNC=false` at API start) and even when on it is a 2-hop path (AISStream → legacy `oil-live-intel-worker` → legacy `oil_ais_positions` → madsan sync → `vessels`).

Design (perf-first):
- **One row per vessel = latest position only** (upsert by mmsi). Never store history in `vessels`; derive port_calls/STS in jobs; archive/aggregate raw positions elsewhere.
- **Short term:** enable `MADSAN_AIS_SYNC=true`; batch-upsert latest position; ensure the legacy worker is feeding `oil_ais_positions`.
- **Target (Track S):** madsan ingests **AISStream directly** in a Go stream worker → `vessels`, removing the legacy hop and Python entirely.
- **Serving:** never send the world — MVT/viewport-bounded GeoJSON only when the layer is on AND zoom ≥ threshold; WS **deltas + client dead-reckoning** (already shipped); conflation + backpressure; **batch** DB writes, never per-AIS-message.
- **Honest tier:** `live` vs `registry-only` by `last_seen_at` age (dossier already labels this).

### Problem B — owner/operator was a live per-click scrape (bad UX)

Legacy: clicking a vessel triggered a live **ShipVault** session-scrape (`shipvault.com`, Firebase auth) → `/api/vessels/{id}` + `/api/companies/search/{name}`, cached in `vessel_enrichment_cache` (now empty). Slow, fragile, credentialed, per-click.

Design (perf-first) — **precompute once, read from DB, never pull on the request path:**

1. **New table `vessel_enrichment`** (mirror legacy cache): PK `mmsi`; `imo, owner_name, owner_company_id, operator_name, operator_company_id, builder, build_year, vessel_class, flag, gross_tonnage, deadweight_tons, fleet_list jsonb, owner_profile jsonb, raw_payload jsonb, source, tier, confidence, fetched_at, stale_after`.
2. **Cron job `vessel_enrichment`** (scheduler → `ingestion_jobs` → worker):
   - **Selection + prioritization:** enrich only vessels that are (a) never enriched, or (b) `stale_after < now()`; order by priority — recently active (`last_seen_at` desc), on a watchlist, or recently opened in a dossier.
   - **Bounded + rate-limited:** small batch per run (e.g. 50–200), respect provider quota, 1 worker, heavy backfill off-peak. Never enrich all 9.6k at once.
   - **Upsert** `vessel_enrichment`; upsert/dedup operator + owner `companies` (low confidence); create `relationships` `operated_by` / `owned_by`; attach **evidence** (tier `observed`, provider source); route uncertain to `manual_review_queue`.
   - **Long TTL:** owner/operator is near-static → `stale_after` ~90–180 days; skip fresh rows (huge cost/perf saver).
3. **Read path:** dossier reads owner/operator via a single indexed join on `vessel_enrichment` — **instant, no click, no live call.** A "Refresh ownership" action **enqueues a job (202)** and streams the update when ready; it never blocks.
4. **Provider:** **ShipVault (live)** is the primary owner/operator path — port of `oil-live-intel/internal/services/shipvault` into madsan Go (`internal/enrichment/vessel/shipvault`). Results persist to **`madsan_db.vessel_enrichment`** (not `mining_db.vessel_enrichment_cache`). **Equasis deferred** (no bulk API; ToS limits automation).

**Runbook (offline ShipVault bulk ingest — not on dossier click):**

`cmd/vessel-enrich` loads `madsan/deploy/.env` automatically, calls ShipVault with rate limiting, and writes to `madsan_db` only. The dossier API reads precomputed rows (`vessel_enrichment`, `vessel_name_history`, `shipvault_companies`, `shipvault_yards`, `vessel_yard_links`) — no live ShipVault on the request path.

```bash
cd madsan/backend
# deploy/.env: MADSAN_SHIPVAULT_ENABLED=true + SHIPVAULT_BEARER_TOKEN or SHIPVAULT_REFRESH_TOKEN

# Apply migration 027 once (or start API with MADSAN_RUN_MIGRATIONS=true)
migrate -path migrations -database "$DATABASE_URL" up

# Smoke test (MS LEON / LERRIX name history — IMO 7530901; MMSI fallback when AIS IMO 9599377 404s)
go run ./cmd/vessel-enrich --dry-run --imo 9599377

# Small batch after auth check
go run ./cmd/vessel-enrich --limit 5

# Stale/missing vessels only (resume-safe; skips fresh stale_after)
go run ./cmd/vessel-enrich --limit 50

# Full refresh off-peak
go run ./cmd/vessel-enrich --force --limit 200

# Flags: --skip-companies --skip-yards to skip owner fleet / yard pages (faster)
go build -o /tmp/vessel-enrich ./cmd/vessel-enrich
```

**Tables (migration `027_shipvault_registry.up.sql`):**
| Table | Contents |
|---|---|
| `vessel_enrichment` | Owner/operator, tonnages, fleet_list, owner_profile, raw_payload |
| `vessel_name_history` | Prior names, dates, disponent (ShipVault history table) |
| `shipvault_companies` | Owner company page: fleet aggregates (DWT/GT/avg age), fleet_list |
| `shipvault_yards` | Yard page: vessels built list |
| `vessel_yard_links` | Vessel ↔ yard + yard number |

Scheduler job `vessel_enrichment` (weekly) uses the same batch path via the worker. Do **not** restart workers mid-import.

**2026-06-10 deeper ShipVault ingest shipped:** `LoadVesselDetail` always merges `/api/vessels/{id}` (LOA/beam/depth/draft, propulsion, engine kW/HP, grain/bale/TEU, events, yard, disponent); IMO shipsearch 404 falls back to MMSI then name; `vessel_specs` in `raw_payload` feeds dossier **Vessel specifications** panel (class/GT/DWT/built/dimensions/yard/status/est. value). Offline backfill: `go run ./cmd/vessel-enrich --limit 200` → **196 enriched**, **145 companies**, 4 not in ShipVault registry.

## 8c. Tank / terminal enrichment: operator + capacity (same pattern)

The tank dossier (e.g. OSM `way 275414308`) shows no operator/capacity because the raw OSM feature lacks those tags. Legacy filled them **on click** by reconciling to curated data and caching the result.

Legacy mechanism:
- **OSM Overpass** (`petroleum_osm_overpass.py`) captures `operator`, `capacity`, `capacity:*` tags **when present**.
- **`oil_terminals`** (19,960) — curated operator/owner/products (e.g. VTTI @ Fujairah).
- **GEM Plant Tracker** xlsx — capacity + operator (never ingested).
- **`map_facility_registry`** reconciles OSM ↔ `oil_terminal_id` ↔ `gem_unit_key` ↔ `license_id`.
- **`storage_terminal_intel.py`** enriched + cached the display in **`storage_terminal_display`** (the click result).

Design (perf-first) — **precompute the reconciliation, store on the asset, read from DB:**
1. **Backfill `oil_terminals` → `assets`** (audit rank #2; cheap) with operator/owner/products into fields + `raw_payload`.
2. **New `asset_enrichment` cache** (mirror `map_facility_registry`/`storage_terminal_display`): PK `asset_id`; `operator_name, owner_name, operator_company_id, capacity_value, capacity_unit, products jsonb, oil_terminal_id, gem_unit_key, source, tier, confidence, fetched_at, stale_after, limitations`.
3. **Cron job `terminal_enrichment`** (scheduler → worker): for each `tank_farm`/`storage`/`refinery` asset needing enrichment, **reconcile** OSM tags → curated `oil_terminals` (name + geo proximity) → GEM units (capacity); write `asset_enrichment`; upsert/dedup operator `companies`; create `operated_by` relationship + **evidence** (tier `observed` curated / `inferred` reconciled); bounded + rate-limited; long TTL.
4. **Read path:** dossier reads operator + capacity from `asset_enrichment` instantly; "Refresh" = 202 background job. No click-time pull.

This is the **same enrichment cron pattern as vessels (§8b)** — one mechanism for vessels (owner/operator) and assets (operator/capacity), differing only by source and reconciliation rules. Capacity tier is honest: `observed` (OSM/GEM stated) vs `inferred` (geometry-estimated, deferred).

### Performance principles (apply to ALL enrichment, critical)
- **Decouple acquisition from the request** — UI reads precomputed cache; any refresh is a 202 + background job + WS push. Nothing expensive blocks a click.
- **Cache + TTL + skip-fresh** — never re-pull static data; staleness gates the cron.
- **Prioritized, bounded backfill** — active/queried/watchlisted entities first; rate-limited small batches off-peak.
- **One write path (worker), indexed reads only on request** — `vessel_enrichment` PK on mmsi; dossier join is one lookup.
- **Quota/cost gating via entitlements** — enrichment is the expensive op; meter it.

---

## 9. Open decisions / inputs needed

- **API keys/URLs:** confirm `EIA_API_KEY` (have), Comtrade subscription key, AISStream key, `JODI_CSV_URL`, OpenSanctions key. Store via `.env`/config, never in repo.
- **Track per source:** confirm EIA/Comtrade/Eurostat/TED go **direct Track B** (skip legacy) vs backfill-first.
- **`prices` schema:** confirm columns (symbol, value, unit, period, source, tier) before EIA adapter.
- **GEM xlsx:** pick a Go xlsx reader (e.g. `excelize`) and confirm the three trackers' sheet schemas.
- **arm64 DB image** swap in dev compose (blocker for heavy ingest).
- **Vessel owner/operator provider:** **ShipVault live** (`MADSAN_SHIPVAULT_ENABLED` + `SHIPVAULT_REFRESH_TOKEN` or `SHIPVAULT_BEARER_TOKEN`). Equasis deferred.
- **AIS now:** enable `MADSAN_AIS_SYNC=true` (2-hop via legacy) now, vs build the direct AISStream Go ingest first.
