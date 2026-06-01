# Data sources catalog (free & open only)

This document is the operational source-of-truth for **what** Meridian ingests, **why** gaps exist (e.g. Kazakhstan), and **how** to verify rows in production. Paid APIs (Mapbox tilesets, commercial company registries) are called out explicitly so we do not mistake them for official cadastre data.

**MAD-45 planning matrix** (vessels, parties, tank farms, pipelines — match keys & cross-match): [OPEN_DATA_MATRIX_MAD-45.md](./OPEN_DATA_MATRIX_MAD-45.md).

**Last reviewed:** 2026-05-23

---

## 1. Why Kazakhstan (and peers) show no official oil data

| Factor | Detail |
|--------|--------|
| **Not in `OPEN_DATA_SOURCES`** | Live ArcGIS sync is limited to countries with verified **open, machine-readable** FeatureServer/MapServer URLs. Kazakhstan has **no** petroleum or mining layer in `backend/services/ingest/open_data_sync.py`. |
| **Listed for visibility only** | `Kazakhstan` appears in `WORLD_COVERAGE_ATTENTION_COUNTRIES` so `/api/open-data/coverage/world` reports `unavailable` instead of silently omitting the country. |
| **OPEC/Gulf module scope** | `opec_gulf_sync.py` seeds Persian Gulf / OPEC reference entities (Saudi, UAE, Iraq, Iran, etc.) and optional EIA production enrichment. **Kazakhstan is not OPEC** and is outside that module. |
| **Global petroleum fallback** | `megagiant_oil_gas_fields_world` may include **named giant fields** in Kazakhstan via the Megagiant layer (`record_origin=global_open_fallback`). That is **not** a licence/block registry; UI hides unknown-name fallback placeholders (`licenseVisibility.ts`). |
| **National portals exist, sync not wired** | Mining: [data.egov.kz](https://data.egov.kz/datasets/view?index=reestr_vydannyh_licenzii_na_ne1) (JSON/Excel register), [minerals.e-qazyna.kz](https://minerals.e-qazyna.kz/) (e-licensing). Petroleum: Committee of Geology contract-area GIS ([gis-terra.kz](https://gis-terra.kz/)); national ArcGIS hub at `arcgis.gis-center.kz` — **layer IDs for hydrocarbon licences not verified** for unattended sync. |
| **Petroleum map layers (Mapbox)** | `petroleum_infrastructure.py` serves **oilmap** vector tiles via **Mapbox** (paid token recommended). Coverage is global compiled ~2019 data, **not** Kazakhstan government cadastre. Prefer OSM/Overpass for pipelines where Mapbox is unavailable (see §4). |

**Same pattern for many countries:** official portal or token-gated ArcGIS → `official_portal_only` / `official_api_restricted` in `AFRICA_COVERAGE_OVERRIDES` / `WORLD_COVERAGE_OVERRIDES`; no row in `OPEN_DATA_SOURCES` until a stable public query URL is verified.

---

## 2. Current in-repo ingest inventory

### 2.1 Official ArcGIS sync (`OPEN_DATA_SOURCES`)

| Country / scope | Sector | `source_id` | Notes |
|-----------------|--------|-------------|-------|
| Kenya | mining | `kenya_mining_cadastre` | Landfolio, capped 1500 |
| Zambia | mining | `zambia_mining_*` (9 layers) | Landfolio |
| Zambia | oil_and_gas | `zambia_petroleum_licenses` | |
| United States | mining | `us_blm_mining_claims` | BLM MLRS, capped |
| United States | oil_and_gas | `us_blm_oil_gas_authorized` | BLM fluid minerals, capped |
| South Africa | oil_and_gas | `south_africa_onshore/offshore_petroleum` | PASA Landfolio |
| New Zealand | oil_and_gas | `new_zealand_petroleum_active_permits` | NZPAM |
| Canada (BC) | mining | `british_columbia_mineral_tenure` | Subnational, capped |
| Canada (north) | oil_and_gas | `canada_northern_oil_gas_rights` | SAC-ISC open data |
| Norway | oil_and_gas | `norway_npd_production_licences_current` | NPD Factmaps |
| Finland | mining | `finland_tukes_active_mining_areas` | Tukes via GTK |
| Colombia | mining | `colombia_anm_titulo_vigente` | ANM ServiciosANM layer 4, capped 2000 |
| Mexico | mining | `mexico_inecc_concesiones_mineras` | INECC Atlas Minero MapServer/22; national concessions; capped 2000/run |
| Peru | mining | `peru_ingemmet_derechos_mineros` | INGEMMET Derechos Mineros; ~2k cap (no offset pagination) |
| Australia (QLD) | mining | `australia_queensland_mineral_tenement` | State only, capped |
| Global | mining | `usgs_mrds_global` | **Fallback** — sites/deposits, not licences; updates ceased ~2011 |
| Global | oil_and_gas | `megagiant_oil_gas_fields_world` | **Fallback** — giant fields only |

#### Mexico — `mexico_inecc_concesiones_mineras` (MAD-77)

| | |
|--|--|
| **URL** | https://mapas.inecc.gob.mx/ArcGIS/rest/services/Atlas_Minero_Mercurio/MapServer/22 |
| **License** | Mexican government open GIS (INECC Atlas Minero; concession attributes from national mining cadastre) |
| **Refresh cadence** | On-demand via `POST /api/admin/open-data/sync?source_id=mexico_inecc_concesiones_mineras`; optional daily worker with other `OPEN_DATA_SOURCES` |
| **Ingest** | `open_data_sync` ArcGIS query → idempotent upsert (`record_origin=open_data`) |
| **Match keys** | Primary: `TITULO` (concession title no.); fallback: `OBJECTID`; holder: `TITULAR` |
| **Mapped fields** | `TITULAR` → company; `NOMBRELOTE` → license type label; `SUST1`–`SUST3` → commodity codes; `MUNICIPIO` + `NOM_ENT` → region |
| **Tier honesty** | National polygon layer (~25k features); sync capped at **2000 records/run** for MVP performance — not a live SGM portal scrape |
| **Verify** | `curl` layer `returnCountOnly`; after sync: `SELECT COUNT(*) FROM licenses WHERE source_id='mexico_inecc_concesiones_mineras'`; sample `id` like `mexico_inecc_concesiones_mineras:232215` |

#### GEM — `gem_global_extraction_tracker_march_2026` (MAD-99)

| | |
|--|--|
| **File** | `Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx` (repo root or `GEM_TRACKER_XLSX_PATH`) |
| **License** | [Global Energy Monitor](https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/) open tracker (March 2026) |
| **Refresh cadence** | On-demand `POST /api/admin/gem-extraction-tracker/ingest`; optional auto step on `POST /api/admin/oil-live/graph-sync` when `GEM_TRACKER_AUTO_INGEST=true` |
| **Ingest** | `gem_extraction_tracker_import.py` — Field-level main data (~7.6k rows); reserves/production merged into `raw_payload` when present |
| **Match keys** | Primary: `Unit ID` → `id` prefix `gem_global_extraction_tracker_march_2026:` |
| **Mapped fields** | `Operator`/`Owner(s)` → company; `Country/Area` → country; `Subnational unit`/`Basin`/`Block(s)` → region; `Fuel type` → commodity; `Status` → status; `Latitude`/`Longitude` → map coords when present |
| **Tier honesty** | Global NGO field-level extraction reference — **not** an official licence/block registry (`record_origin=global_open_fallback`) |
| **Verify** | After ingest: `SELECT COUNT(*) FROM licenses WHERE source_id='gem_global_extraction_tracker_march_2026'`; sample `id` like `gem_global_extraction_tracker_march_2026:L100000321006`; Oil & Gas map with `prefer_open_data=true` |

### 2.2 Other backend ingest (not ArcGIS list)

| Module | Data | Free? | Verification |
|--------|------|-------|--------------|
| `opec_gulf_sync.py` | Gulf/OPEC NOCs, major fields, terminals | Static + optional EIA API key | `record_origin` → `opec_gulf_reference` / open_data; compare to national NOC sites |
| `gov_procurement_sync.py` | USAspending contract awards | Yes (US federal) | Award ID on USAspending.gov |
| `csv_fallback_import.py` | User/admin CSV (e.g. SA/Ghana mining) | User-provided | `user_import_csv`; source file + row hash |
| `gem_extraction_tracker_import.py` | GEM Global Oil & Gas Extraction Tracker (March 2026 xlsx) | Yes (GEM open data) | `source_id=gem_global_extraction_tracker_march_2026`; `record_origin=global_open_fallback`; admin `POST /api/admin/gem-extraction-tracker/ingest`; auto on graph-sync when xlsx present |
| `petroleum_infrastructure.py` | Exploration polygons, pipelines, refineries | **Mapbox** (oilmap tilesets) | Layer catalog `limitations`; token env `MAPBOX_ACCESS_TOKEN` |
| `petroleum_trade.py` / Comtrade | Bilateral HS27 trade flows | UN Comtrade (free tier limits) | Reporter/partner codes in API response |
| `ingest_oil_trades.py` | Static Comtrade-style seeds | Reference | Documented M49/HS codes |
| `comtrade_scheduled_sync.py` | Scheduled HS27 refresh | UN Comtrade keyed API | `comtrade_sync_runs`; worker + admin sync |
| `census_trade.py` | U.S. bilateral HS 2709/2710/2711 (Census timeseries API) | Free API key ([signup](https://api.census.gov/data/key_signup.html)) | `oil_trade_flows.data_source=census_api`; macro tier; runs on graph sync |
| `usitc_dataweb.py` | U.S. HS flows / tariff context (DataWeb) | Free account + API token | `USITC_DATAWEB_API_KEY`; `data_source=usitc_dataweb` on graph sync |
| Bundled `licenses.json` | Legacy snapshot | Deprecated for prod UX | `bundled_json`; excluded when `prefer_open_data=true` |

### 2.3 Company / deal signals (in app today)

| Signal | Endpoint / feature | License | Notes |
|--------|-------------------|---------|-------|
| US contract awards | `/api/gov-procurement`, deal room agents | US govt open data | Company name match; not global |
| Deal rooms | `/api/deal-rooms` | App data | Export JSON/Markdown; agent jobs |
| Agent intelligence | `/api/agent-intelligence/*` | LLM + public web | Requires human review; not a registry |
| Company intel | `GET /company-intel` | Heuristic aggregation | No OpenCorporates API (paid) wired |
| SEC EDGAR | `GET /api/companies/{name}/sec-filings` | Free (US issuers) | CIK + browse-edgar link (US listed cos only) |
| EU beneficial ownership | Not wired | Varies by MS | **Thin** open API coverage |

### 2.4 Oil Live / Live Data (unified commercial graph)

Meridian **Live Data** merges free sources into `mining_db` via `POST /api/admin/oil-live/graph-sync` (`backend/services/oil_live_graph_sync.py`) and the Go **synthetic BOL** rebuild. Operational onboarding: **[LIVE_DATA.md](./LIVE_DATA.md)**.

| Source | Module / worker | Env / tier | In `oil_trade_flows` / graph |
|--------|-----------------|------------|------------------------------|
| **UN Comtrade** | `comtrade_scheduled_sync.py`, graph-sync trade mirror | `COMTRADE_API_KEY` (free tier) | `data_source=comtrade`; macro HS 2709/2710/2711 |
| **EIA** | `opec_gulf_sync.py` + graph-sync enrichment | `EIA_API_KEY` (optional) | Production / reference context; not row-level BOL |
| **U.S. Census** | `census_trade.py` | `CENSUS_API_KEY` | `data_source=census_api`; macro bilateral HS27 |
| **USITC DataWeb** | `usitc_dataweb.py` | `USITC_DATAWEB_API_KEY` | `data_source=usitc_dataweb`; U.S. import/export HS flows |
| **EIA crude imports** | `eia_imports.sync_eia_crude_imports` (graph-sync step) | `EIA_API_KEY` | `oil_trade_flows.data_source='eia'`, HS 2709, partner=origin country; aggregated last-12-months macro tier |
| **EIA refinery throughput (PADD)** | `eia_imports.sync_eia_refinery_throughput` | `EIA_API_KEY` | `oil_refinery_throughput` (PADD, week_ending, utilization_pct, crude_input_mbbl_d); feeds **Recipe G** in `engine.go` |
| **EIA historic company imports (files)** | `eia_historic_imports.ingest_eia_downloads_folder` | `EIA_DOWNLOADS_DIR` (local folder of `impa*.xls/xlsx`; **no** web scrape); graph-sync step `eia_historic_imports` | `eia_historic_imports` — company-level U.S. imports by origin/product/port; Live Data + Oil/Gas map arcs |
| **Eurostat COMEXT (macro)** | `eurostat_trade.sync_eurostat_hs27` | `EUROSTAT_SYNC_ENABLED`; dataset `EUROSTAT_DATASET` | `oil_trade_flows.data_source=eurostat`; macro tier; dedupe `UNIQUE (reporter_m49, partner_m49, hs_code, flow_type, year, data_source)` via migration `018` + `ingest_oil_trades.upsert_rows` |
| **JODI oil snapshots** | `jodi_oil.sync_jodi_snapshots` | `JODI_CSV_URL` or `JODI_CSV_PATH` (public export) | `jodi_oil_snapshots`; validates corridors / benchmarks |
| **Mining HS Comtrade** | `commodity_trade_flows.sync_mining_hs_comtrade` | `COMTRADE_API_KEY`; `COMMODITY_COMTRADE_SYNC_ENABLED` | `commodity_trade_flows` (HS 26xx/71xx/74xx); license dossier trade panel |
| **UK / user trade manifests** | `trade_manifest_ingest.sync_uk_open_trade_rows` | `UK_MANIFEST_CSV_DIR`, `USER_MANIFEST_CSV_DIR`; admin `POST /api/admin/trade-manifests/upload`; sample CSV in `data/uk_trade_manifests/`; `uk-trade-manifest-sync-worker` | `trade_manifest_rows` (`customs_open`, `user_upload`, `macro`) |

**Dev verify (Phase 1):** drop HMRC-style `*.csv` under `data/uk_trade_manifests/`, then run `./scripts/ingest_uk_manifests_dev.sh` (or graph-sync step `trade_manifest_uk`). Confirm `GET /api/oil-live/trade-manifests?bol_tier=customs_open` and `sync-status.manifest_by_tier` show `customs_open` counts. Live Data intel panel surfaces the tier badge — not paid BOL.

**Brazil (MAD-4x-c2):** `BRAZIL_MANIFEST_CSV_DIR` → graph-sync `trade_manifest_brazil` → same table with `data_source=brazil_comex_open`. Sample: `data/brazil_trade_manifests/sample_open_trade.csv`.
| **AIS (live)** | `oil-live-intel-worker` (Go) | `AISSTREAM_API_KEY` | `oil_ais_positions`, `oil_vessels`, `oil_port_calls`, `maritime_source_health`; `/api/oil-live/vessels/live`. Partial open/community coverage, not global truth |
| **Vessel positions (multi-source merge)** | `oil-live-intel` map API | `OIL_LIVE_MERGED_VESSEL_POSITIONS` optional | `oil_vessel_position_observations` — per-source rows; **`GET /api/oil-live/vessels/live`** is primary map path |
| **Maritime Redis snapshot (retired)** | — | — | **Removed** — was Python `maritime-worker` → Redis; graph-sync mirror retired. Historical `data_source=maritime_redis` rows may remain in DB |
| **Open AIS coverage + gaps** | `oil-live-intel` `/coverage`, `/source-health`, `/sync-status` AIS fields; migration `017_open_ais_coverage.sql` | No paid source; AISHub requires contributed receivers | `coverage_cells`, `maritime_watch_zones`, `maritime_source_health`, `port_event_observations`; `/coverage` is bbox-only (no global dump); sync-status exposes `live_vessel_count`, `live_ais_port_call_count`, watch-zone gap counts for Live Data panels |
| **AISHub contributor path** | Future adapter after station contribution | AISHub free API requires sharing receiver data | Planned source in `maritime_source_health`; priority for Fujairah/UAE, Oman, Suez/Red Sea, Durban/Richards Bay, Lagos/Tema, Mombasa/Dar, Tangier |
| **Government AIS (BarentsWatch)** | `barentswatch_ais_sync.sync_barentswatch_ais` (graph-sync step) | `BARENTSWATCH_CLIENT_ID`, `BARENTSWATCH_CLIENT_SECRET` from [barentswatch.no](https://developer.barentswatch.no/docs/AIS/live-ais-api/); `BARENTSWATCH_AIS_SYNC_ENABLED` | `oil_vessel_position_observations` with `data_source=barentswatch`, `source_type=government_ais`; regional Norway EEZ only — **not** Gulf/Africa. Live Data dev toggle filters `/coverage?sources=barentswatch`. Verify bbox `4,58,31,71`. |
| **Government AIS / SAR validation (other)** | Denmark AIS, Sentinel-1 monitor (planned) | Public/regional; SAR is unidentified vessel detection only | Planned source health rows; Sentinel-1 must be `source_type=satellite_detected_unidentified` |
| **OSM storage** | Overpass + `petroleum_osm_features` + bulk seed | ODbL | `oil_terminals` (~12k after dedup); map bbox API |
| **EU TED** | `ted_procurement_sync.py` | EU open | `eu_procurement_notices`; Recipe C tender signals |
| **USAspending** | `gov_procurement_sync.py` | US open | Awards → Recipe E government offtake hints |
| **OpenSanctions** | `opensanctions_screening.py` (graph-sync step) | Public API; `OPENSANCTIONS_API_KEY` optional for higher quota | `oil_companies.sanctions_status` + `sanctions_matches`; non-blocking UI chip only |
| **Elasticsearch (search index)** | `oil-live-intel/cmd/oil-live-search-indexer` (Go) | `ELASTICSEARCH_URL` (`http://elasticsearch:9200` in compose); single-node 8.13.4 image; volume `meridian_elasticsearch_data` | **Not a data source** — indexes Postgres (`meridian_cargo_records`, `oil_companies`, `oil_terminals`, `oil_vessels`) for full-text search via `/api/oil-live/search`. Full sync on boot, incremental on `updated_at`. UI degrades to "Search unavailable" when ES is down. |
| **GLEIF LEI batch** | `gleif_batch.enrich_companies_with_lei` (graph-sync step) | Public API, no key | `oil_companies.lei` + `lei_record_id`; denormalised onto `meridian_cargo_records.shipper_lei` / `consignee_lei` |
| **Wikidata company facts** | `wikidata_company_enrichment.py` (graph-sync step) | Public MediaWiki API; polite `User-Agent` | `oil_companies.wikidata_qid` + `wikidata_facts` JSONB (industries, hq, country, website, freebase id) |
| **Licenses / suppliers** | App licenses + [LICENSE_BULK_IMPORT.md](../LICENSE_BULK_IMPORT.md) | User / admin CSV | `oil_companies` index on graph-sync step 2 |

**Synthetic Meridian Cargo Records (MCR)** — not paid Bill of Lading data. Triangulation recipes **A–F** in `oil-live-intel/internal/services/syntheticbol/engine.go`.

| `bol_tier` / UI label | Meaning |
|-----------------------|---------|
| `synthetic` (default DB) | MCR built from public signals; amber **Synthetic cargo** badge |
| `inferred` | Shown when tier omitted in API/UI; same honesty — no confirmed private deal |
| Provenance `seed_port_calls` | Demo AIS-style port calls when live AIS sparse; **Include seed data** toggle |
| Provenance `live_ais` | Geofenced port calls from AISStream worker |

Paid BOL vendors (e.g. ImportYeti) are **explicitly excluded** — see roadmap in [LIVE_DATA.md](./LIVE_DATA.md) and `.cursor/plans/live_data_unification_1ae1516a.plan.md`.

---

## 3. Free data catalog (target & gap)

**Legend — Ingest method:** `arcgis` = `open_data_sync`; `csv` = admin/user import; `static` = curated seed; `api` = REST job; `overpass` = OSM Overpass (recommended Mapbox alt).

| Region | Dataset | URL | License | Ingest method | Verification (in-app) |
|--------|---------|-----|---------|---------------|------------------------|
| **Kazakhstan** | Register of solid mineral exploration/extraction licences | https://data.egov.kz/datasets/view?index=reestr_vydannyh_licenzii_na_ne1 | Open Government KZ | **Gap** → `api`/csv | Match licence number on egov; export row `source_record_url` |
| **Kazakhstan** | Unified subsoil e-service (contracts, users) | https://minerals.e-qazyna.kz/ | Government portal | **Gap** (portal) | Contract ID search on portal |
| **Kazakhstan** | Contract areas GIS (Terra / Committee of Geology) | https://gis-terra.kz/ | Government | **Gap** (verify ArcGIS) | Map compare + contract number |
| **Kazakhstan** | National GIS center ArcGIS REST | https://arcgis.gis-center.kz/server/rest/services | Government | **Research** | `.../query?where=1=1&returnCountOnly=true` |
| **Global mining** | USGS MRDS | ArcGIS (in repo) | USGS public domain | `arcgis` (fallback) | USGS site ID / `DEP_ID` |
| **Global mining** | OneGeology / national surveys | https://onegeology.org/ | CC-BY (layers vary) | **Gap** | WMS layer metadata |
| **United States** | BLM MLRS claims & O&G leases | In repo | US federal open | `arcgis` | BLM case number → MLRS |
| **EU** | Norway NPD production licences | In repo | NPD open | `arcgis` | `prlFactPageUrl` |
| **EU** | Finland Tukes mining areas | In repo | Open gov | `arcgis` | `ALUETUNNUS` on Tukes register |
| **Africa** | Zambia/Kenya/SA petroleum & mining | In repo | Official cadastre | `arcgis` | Source layer URL + external id |
| **Middle East** | OPEC Gulf reference + Megagiant | In repo + `opec_gulf_sync` | Reference / open layer | `static` + `arcgis` | Flag as fallback; NOC website |
| **Latin America** | ANM Colombia, INGEMMET Peru, INECC Mexico concessions | In repo (see §2.1) | Open gov (varies) | `arcgis` | `TITULO` / `CG_CODIGO` / `CODIGO_EXPEDIENTE` |
| **Petroleum infra** | OSM pipelines (`man_made=pipeline`) | Overpass API | ODbL | **`overpass`** (opt-in map layers) | OSM way ID + tag inspection |
| **Petroleum infra** | oilmap / Mapbox tilesets | Mapbox | Third-party | **Paid** — `petroleum_infrastructure` | Document token; not official |
| **Trade** | UN Comtrade HS 2709/2710 | https://comtrade.un.org/ | UN terms (free tier) | `api` (partial in repo) | Reporter/partner/year in response |
| **US deals** | USAspending | https://api.usaspending.gov/ | US open data | `api` | `award_id` link |
| **US companies** | SEC EDGAR full-text search | https://www.sec.gov/edgar | US public | **Roadmap** `api` | CIK + filing accession |
| **Companies** | OpenCorporates | https://opencorporates.com | **Paid API** | Do not use API | Manual web check only |
| **Companies** | GLEIF LEI | https://www.gleif.org/en/lei-data | Open LEI | **Roadmap** | LEI record match |
| **EU contracts** | TED / EU procurement | https://ted.europa.eu/ | EU open | `api` (TED Search) | Notice ID (`ND`) |

---

## 4. Mapbox vs open alternatives (petroleum geometry)

| Layer in app | Current source | Free alternative |
|--------------|----------------|------------------|
| Exploration / production polygons | Mapbox oilmap MVT | Government cadastre per country; or skip layer |
| Bid rounds | Mapbox oilmap | IHS-style data **not free** — show “unavailable” or national round PDFs |
| Refineries | Mapbox oilmap | OSM `industrial=refinery` via Overpass; EIA refinery list (US) |
| Oil/gas pipelines | Mapbox oilmap | OSM `man_made=pipeline` + `substance=*` Overpass; national regulators |

**Policy:** Production UX should not imply Mapbox/oilmap layers are official. Keep layers **opt-in** (already default: refineries only). Set `MAPBOX_ACCESS_TOKEN` only if you accept Mapbox ToS; otherwise return empty layer with explicit `limitations` message.

---

## 5. Architecture recommendation

### 5.1 Tables (implemented / stubbed)

- **`license_sync_runs`** — one row per `open_data_sync` / source run: `source_id`, `started_at`, `finished_at`, `status`, `records_fetched`, `records_written`, `records_skipped_manual`, `error`.
- **`comtrade_sync_runs`** — one row per scheduled HS27 Comtrade refresh: `year`, `requests_made`, `rows_upserted`, `errors`.
- **`petroleum_osm_features`** — nightly OSM pipeline/refinery snapshots (geometry + tags); `GET /api/petroleum/osm-layers/{id}` reads DB first, Overpass fallback.
- **`licenses.manually_edited`** — when `TRUE`, automated upsert (ArcGIS sync, bulk CSV) must **not** overwrite the row (`UPSERT ... WHERE manually_edited IS NOT TRUE`).

### 5.2 Verification UI (roadmap)

1. **Coverage panel** — already: `/api/open-data/coverage/world` with `status`, `references[]`, `source_ids[]`.
2. **Row dossier** — show `source_record_url`, `last_synced_at`, `record_origin`, link “Verify at source”.
3. **Sync health** — admin list of `license_sync_runs` + last success per `source_id`.
4. **Scheduled verify** — cron: `POST /api/admin/open-data/sync` + compare counts vs previous run; alert on >20% drop.

### 5.3 Export / import

| Audience | Endpoint | Behavior |
|----------|----------|----------|
| User | `GET /licenses/export` | CSV without provenance; `?include_provenance=true` adds source columns (auth required) |
| Admin | `GET /api/admin/licenses/export` | Full provenance + `manually_edited` |
| Admin | `POST /api/admin/licenses/import` | Upsert by `id`; skip updates when `manually_edited=true` |
| Admin | `POST /api/admin/import/extracted-csv` | Country-filtered fallback CSV |

---

## 6. Phased roadmap

### Weeks 1–4 (foundation)

| Workstream | Tasks |
|------------|-------|
| **Inventory & honesty** | Keep `global_open_fallback` hidden for unknown names; document Mapbox as non-official. |
| **Schema** | `license_sync_runs`, `manually_edited`; protect upsert. |
| **Kazakhstan mining** | Ingest egov JSON/Excel into csv or dedicated `api` adapter; geocode from register fields. |
| **Sync observability** | Log runs; admin dashboard for last sync per source. |
| **Verification v1** | Dossier “Open source” block links `source_record_url`; coverage API linked from UI. |

### Weeks 9–12 (breadth) — Phase 3 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **Central Asia hydrocarbons** | Done | KZ ArcGIS hub unverified (timeout); TM/UZ `WORLD_COVERAGE_OVERRIDES`. |
| **EU mining** | Done | Sweden SGU OGC + Poland PGI portal refs in `WORLD_COVERAGE_OVERRIDES` (no ArcGIS sync). |
| **LatAm mining** | Done | `colombia_anm_titulo_vigente`, `mexico_inecc_concesiones_mineras`, `peru_ingemmet_derechos_mineros` (Mexico/Peru capped ~2k/run). |
| **Comtrade HS27** | Done | Daily worker + admin endpoints; 429/503 backoff in `ingest_oil_trades._fetch_comtrade_bulk`. |
| **GLEIF LEI** | Done | Free public API lookup endpoint. |
| **OSM petroleum DB** | Done | `petroleum-osm-worker` + `POST /api/admin/petroleum-osm/sync`; API reads DB first. |

### Weeks 25–28 (operations) — Phase 7 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **Philippines MGB probe** | Done | `philippines_mgb_arcgis_probe.py`; `open_data_probe_results`; coverage `official_api_restricted`; data-health + `PH_MGB_ARCGIS_TOKEN`. |
| **Norway / Finland breadth** | Done | NPD + Tukes documented in coverage; data-health `nordic_source_admin_notes` + per-`source_id` row counts. |
| **GLEIF dossier header** | Done | `GleifLeiLink` compact chip next to company name on Overview header (Raw Evidence card unchanged). |
| **Deal room export enrichment** | Done | Export package includes `relatedUsaAwards` + `relatedEuNotices` (fuzzy party match). |
| **Sync SLA dashboard** | Done | `source_sync_sla` on data-health; env `SYNC_SLA_*_HOURS`; `POST /api/admin/open-data/sync?source_id=X`. |
| **Poland złoża layer** | Done | `poland_pgi_deposits` (MIDAS layer 0); capped via `PGI_SYNC_MAX_PER_LAYER`. |
| **Drift alert deep links** | Done | Webhook/email include `source_id`, `drop_pct`, `admin_ui_url` from `APP_PUBLIC_URL`. |

### Weeks 33–36 (operations) — Phase 9 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **Kazakhstan ArcGIS hub probe** | Done | Lists services + hydrocarbon name matches; `KZ_ARCGIS_HYDROCARBON_LAYER_URL` + `KZ_ARCGIS_SYNC_ENABLED=1` appends `kazakhstan_petroleum_arcgis` to `OPEN_DATA_SOURCES`; honest timeout messaging. |
| **TED CPV ↔ license commodity** | Done | `license_commodity_to_cpv_bucket`; dossier Gov Tenders shows CPV bucket + link to Investigations with pre-selected facet. |
| **Deal room true PDF** | Done | `reportlab` in `requirements.txt`; `GET /api/deal-rooms/{id}/export.pdf` returns `application/pdf` (HTML fallback if lib missing). |
| **Probe status alerts** | Done | `record_probe_status_change` → `sync_alert_events` + optional `SYNC_ALERT_WEBHOOK_URL` POST (`probe_status_change`). |
| **Global company registers** | Done | `company_registers.py` — Ghana, South Africa, Colombia, Peru, Brazil, Chile, Mexico, Australia, Canada (+ EU via `eu_company_registers.py`). |
| **Trade-flow charts** | Done | `TradeFlowsChart` SVG bar chart in dossier `EntityTradeFlowsPanel` (export/import by year from `oil_trade_flows`). |

### Weeks 29–32 (operations) — Phase 8 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **OpenCorporates manual UX** | Done | `GET /api/companies/{name}/registry-links`; dossier `CompanyRegistryLinks` chip + disclaimer (not API-backed). |
| **EU national registers** | Done | `eu_company_registers.py` — UK Companies House, DE Unternehmensregister, FR INPI, NL KVK, etc.; shown next to GLEIF. |
| **Scheduled probe workers** | Done | `arcgis-probe-worker` weekly KZ + PH → `open_data_probe_results`; `PROBE_SYNC_INTERVAL_SECONDS` (default 604800). |
| **Deal room export HTML/PDF** | Done | `GET /api/deal-rooms/{id}/export?format=html` and `/export.pdf` (printable HTML; includes Phase 7 USA + EU enrichment). |
| **Comtrade ↔ license linkage** | Done | `GET /entities/{id}/trade-flows`; `EntityTradeFlowsPanel` on exports-imports tab (country + HS27 from commodity). |
| **Mapbox-off OSM mode** | Done | `PETROLEUM_DISABLE_MAPBOX=1` + `VITE_PETROLEUM_DISABLE_MAPBOX=1`; catalog empty; OSM pipelines default on. |
| **Comtrade deploy failover** | Done | `COMTRADE_API_KEY` + `COMTRADE_API_KEY_SECONDARY` in GitHub workflow + docker-compose (429/403 retry). |

### Weeks 21–24 (operations) — Phase 6 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **Poland PGI mining** | Done | `poland_pgi_mining_sync.py` (MIDAS ArcGIS MapServer); `POST /api/admin/poland-mining/sync`; `source_id=poland_pgi_midas_layer*`. |
| **Sync alert read/dismiss** | Done | `PATCH /api/open-data/sync-alerts/{id}/read`, `POST .../mark-all-read`; Admin Open Data dismiss + mark all. |
| **TED → dossier linking** | Done | `GET /entities/{id}/eu-procurement`; fuzzy buyer/title match; Gov tenders tab shows EU + USAspending. |
| **Coverage `?country=`** | Done | `GET /api/open-data/coverage/world?country=Ghana` returns server-filtered row(s). |
| **Kazakhstan egov worker** | Done | `kazakhstan-mining-worker` in docker-compose; skips when `KZ_EGOV_API_KEY` unset. |
| **Drift email alerts** | Done | `smtplib` when `SMTP_HOST`, `SMTP_FROM`, `SMTP_TO` set; log-only otherwise. |
| **Sweden sync worker** | Done | `sweden-mining-worker` weekly default (`SGU_SYNC_INTERVAL_SECONDS=604800`). |
| **EU procurement CPV facets** | Done | `cpv_commodity.py`; `?cpv_bucket=` on notices API; Admin + Investigations UI. |

### Weeks 17–20 (operations) — Phase 5 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **Sweden SGU OGC mining** | Done | `sweden_sgu_mining_sync.py`; `POST /api/admin/sweden-mining/sync`; `source_id=sweden_sgu_*`, `record_origin=open_data`. |
| **EU TED procurement** | Done | `ted_procurement_sync.py`, `eu_procurement_notices`; `GET /api/eu-procurement/notices`; weekly `ted-procurement-worker`. |
| **OSM sync run logging** | Done | `petroleum_osm_sync_runs` + worker/admin sync logging; shown in data-health. |
| **Dossier coverage panel** | Done | `CountryCoveragePanel` in Raw Evidence tab (world coverage, client-filtered). |
| **Kazakhstan ArcGIS probe** | Done | `kazakhstan_arcgis_probe.py`; timeout logged in data-health; **not** added to `OPEN_DATA_SOURCES`. |
| **Drift alert events** | Done | `sync_alert_events` on drift; `unread_count` on `GET /api/open-data/sync-alerts`; Admin Open Data badge; optional `SYNC_ALERT_WEBHOOK_URL`. |

### Weeks 13–16 (operations) — Phase 4 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **OSM petroleum persistence** | Done | `petroleum_osm_store.py`, `petroleum-osm-worker`, tile sleep + Overpass fallback. |
| **Frontend Phase 2–3** | Done | `GleifLeiLink` in dossier; Admin Comtrade + Data health tabs; coverage link passes `country`. |
| **EU mining ingest** | Doc + CSV | `docs/eu_mining_import_template.csv`; Sweden SGU OGC + Poland PGI portal refs (no broken ArcGIS). |
| **Data health dashboard** | Done | `GET /api/admin/data-health`; Admin Panel tab. |
| **Export / import UX** | Done | `GET /licenses/export?include_provenance=true`; import 422 includes `message` summary. |

### Weeks 5–8 (breadth) — Phase 2 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **Annotations persistence** | Done | `GET/PUT /api/licenses/{id}/annotations`, bulk `GET /api/licenses/annotations`; frontend hydrates from server when logged in, one-time localStorage merge. |
| **Sync drift alerts** | Done | `SYNC_DRIFT_ALERT_PCT` (default 20); `drift_warning` on `license_sync_runs`; `GET /api/open-data/sync-alerts`; admin Open Data drift badges. |
| **Kazakhstan mining** | Done (starter) | `KZ_EGOV_API_KEY` in `.env.example`; robust `normalize_egov_row`; `POST /api/admin/kazakhstan-mining/sync`; mocked HTTP tests. |
| **OSM petroleum** | Done (starter) | `GET /api/petroleum/osm-layers/{pipelines\|refineries}`; Overpass tile cache; opt-in map layers labeled “OpenStreetMap (community)”. |
| **SEC EDGAR linker** | Done (starter) | `GET /api/companies/{name}/sec-filings`; dossier SEC link; `SEC_EDGAR_USER_AGENT`; mocked ticker JSON tests. |
| **Central Asia hydrocarbons** | Done (honest gaps) | KZ oil: `official_portal_only` + arcgis.gis-center.kz timeout note; TM/UZ portal refs in `WORLD_COVERAGE_OVERRIDES`. |
| **EU mining / LatAm** | Done (partial) | Sweden SGU OGC documented (not ArcGIS sync); Colombia ANM + Mexico INECC + Peru INGEMMET in `OPEN_DATA_SOURCES` (verified 2026-05). |
| **Comtrade refresh** | Done | `comtrade_scheduled_sync.py`, `comtrade_sync_runs`, admin sync + sync-runs, `comtrade-sync-worker` in docker-compose. |
| **GLEIF LEI** | Done (starter) | `GET /api/companies/{name}/lei` via GLEIF public API. |
| **OSM petroleum persist** | Stub | `petroleum_osm_features` table on init; nightly worker deferred. |

### Parallel agents (if splitting work)

1. ArcGIS source hunter + URL verifier  
2. CSV/JSON national portal adapters  
3. Sync runs + admin UI  
4. OSM/Overpass petroleum layers  
5. Company/deal intel (EDGAR, GLEIF, procurement)  
6. Frontend verification & export UX  

---

## 7. Production data hygiene (no demo junk)

- Do **not** seed synthetic companies in production (`bundled_json` off by default; `include_bundled_fallback` admin-only).
- Treat **`global_open_fallback`** as screening-only; hidden when company name unknown.
- Treat **`opec_gulf_reference`** static rows as reference — require compliance review for sanctioned jurisdictions.
- User CSV imports must set `record_origin=user_import_csv` and appear in coverage as fallback, not official sync.

---

## 8. Quick verification commands

```bash
# World coverage (includes Kazakhstan status)
curl -s "http://localhost:8000/api/open-data/coverage/world?region=asia_pacific" | jq '.countries[] | select(.country=="Kazakhstan")'

# Trigger official sync (admin token)
curl -X POST "http://localhost:8000/api/admin/open-data/sync" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}'

# Admin export with provenance
curl -s "http://localhost:8000/api/admin/licenses/export" -H "X-Admin-Token: $ADMIN_TOKEN" -o licenses_admin_export.csv

# Comtrade HS27 sync (requires COMTRADE_API_KEY)
curl -X POST "http://localhost:8000/api/admin/comtrade/sync" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"year": 2023}'
curl -s "http://localhost:8000/api/admin/comtrade/sync-runs" -H "X-Admin-Token: $ADMIN_TOKEN" | jq .

# GLEIF LEI lookup
curl -s "http://localhost:8000/api/companies/Newmont/lei" | jq .

# Data health (admin token)
curl -s "http://localhost:8000/api/admin/data-health" -H "X-Admin-Token: $ADMIN_TOKEN" | jq .

# OSM petroleum DB refresh (admin; or wait for petroleum-osm-worker)
curl -X POST "http://localhost:8000/api/admin/petroleum-osm/sync" -H "X-Admin-Token: $ADMIN_TOKEN"

# User export with provenance (Bearer token)
curl -s "http://localhost:8000/licenses/export?include_provenance=true" -H "Authorization: Bearer $JWT" -o licenses_provenance.csv

# Sweden SGU OGC mining sync (admin token)
curl -X POST "http://localhost:8000/api/admin/sweden-mining/sync" -H "X-Admin-Token: $ADMIN_TOKEN"

# EU TED procurement (admin sync + public read)
curl -X POST "http://localhost:8000/api/admin/eu-procurement/sync" -H "X-Admin-Token: $ADMIN_TOKEN"
curl -s "http://localhost:8000/api/eu-procurement/notices?country=Sweden&limit=10" | jq .

# Sync drift alerts (admin JWT or X-Admin-Token)
curl -s "http://localhost:8000/api/open-data/sync-alerts" -H "X-Admin-Token: $ADMIN_TOKEN" | jq '.unread_count'
curl -X PATCH "http://localhost:8000/api/open-data/sync-alerts/1/read" -H "X-Admin-Token: $ADMIN_TOKEN"
curl -X POST "http://localhost:8000/api/open-data/sync-alerts/mark-all-read" -H "X-Admin-Token: $ADMIN_TOKEN"

# Poland PGI MIDAS mining sync
curl -X POST "http://localhost:8000/api/admin/poland-mining/sync" -H "X-Admin-Token: $ADMIN_TOKEN"

# Philippines MGB probe (stored in open_data_probe_results; refresh via data-health)
curl -s "http://localhost:8000/api/admin/data-health?refresh_probes=true" -H "X-Admin-Token: $ADMIN_TOKEN" | jq '.philippines_mgb_arcgis_probe'

# Single-source open-data sync
curl -X POST "http://localhost:8000/api/admin/open-data/sync?source_id=kenya_mining_cadastre" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}'

# Mexico INECC mining concessions (MAD-77)
curl -X POST "http://localhost:8000/api/admin/open-data/sync?source_id=mexico_inecc_concesiones_mineras" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}'
# Sample row count + licence id
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM licenses WHERE source_id='mexico_inecc_concesiones_mineras';"
psql "$DATABASE_URL" -c "SELECT id, company, region FROM licenses WHERE source_id='mexico_inecc_concesiones_mineras' LIMIT 3;"

# Coverage single country (server-side filter)
curl -s "http://localhost:8000/api/open-data/coverage/world?country=Ghana" | jq '.countries'

# EU procurement for a license entity
curl -s "http://localhost:8000/entities/YOUR_LICENSE_ID/eu-procurement?entity_kind=license" | jq .
curl -s "http://localhost:8000/api/eu-procurement/notices?cpv_bucket=mining&limit=10" | jq .

# Company registry links (manual OpenCorporates + EU MS register)
curl -s "http://localhost:8000/api/companies/Newmont/registry-links?country=United%20Kingdom" | jq .

# Stored Comtrade rows for a license (oil_trade_flows)
curl -s "http://localhost:8000/entities/YOUR_LICENSE_ID/trade-flows?entity_kind=license" | jq .

# Deal room PDF export (application/pdf when reportlab installed)
curl -s "http://localhost:8000/api/deal-rooms/ROOM_ID/export.pdf" -o deal-room.pdf

# Entity EU procurement with auto CPV bucket from license commodity
curl -s "http://localhost:8000/entities/YOUR_LICENSE_ID/eu-procurement?entity_kind=license" | jq '.cpvBucket,.cpvBucketLabel'

# Ghana company register (manual link)
curl -s "http://localhost:8000/api/companies/Gold%20Fields/registry-links?country=Ghana" | jq .

# Petroleum Mapbox-off catalog (OSM-only mode)
PETROLEUM_DISABLE_MAPBOX=1 curl -s "http://localhost:8000/api/petroleum/layers" | jq '.mapbox_disabled,.layers'
```

---

## 9. Related files

| File | Role |
|------|------|
| `backend/services/ingest/open_data_sync.py` | `OPEN_DATA_SOURCES`, coverage overrides |
| `backend/services/ingest/opec_gulf_sync.py` | Gulf/OPEC reference |
| `backend/services/petroleum_infrastructure.py` | Mapbox oilmap layers |
| `backend/services/ingest/gov_procurement_sync.py` | USAspending + `gov_procurement_sync_runs` |
| `backend/services/ingest/comtrade_scheduled_sync.py` | Comtrade HS27 + `comtrade_sync_runs` |
| `backend/services/gleif_lookup.py` | GLEIF LEI public API |
| `backend/services/petroleum_osm_store.py` | OSM petroleum DB read/write + tile sync |
| `backend/petroleum_osm_sync_worker.py` | Nightly Overpass → `petroleum_osm_features` |
| `backend/services/admin_data_health.py` | Admin data-health aggregation |
| `docs/eu_mining_import_template.csv` | Sweden/Poland manual import template |
| `backend/services/ingest/sweden_sgu_mining_sync.py` | Sweden SGU OGC mineral permits |
| `backend/services/ingest/ted_procurement_sync.py` | EU TED procurement (CPV 091*) |
| `backend/services/eu_procurement_store.py` | `eu_procurement_notices` persistence |
| `backend/services/ingest/kazakhstan_arcgis_probe.py` | KZ ArcGIS hub reachability probe |
| `backend/services/ingest/philippines_mgb_arcgis_probe.py` | PH MGB ControlMap token probe |
| `backend/services/sync_sla.py` | Per-source sync SLA (green/yellow/red) |
| `backend/services/deal_room_export_enrichment.py` | Deal export USAspending + TED fuzzy match |
| `backend/services/company_registry_links.py` | OpenCorporates + EU MS manual registry links |
| `backend/services/company_registers.py` | EU + Africa/LatAm/Oceania manual register URLs |
| `backend/services/eu_company_registers.py` | EU member-state register URL mapping (legacy import) |
| `backend/services/deal_room_export_pdf.py` | Reportlab PDF deal export (+ HTML fallback) |
| `mining-viz/src/components/dossier/TradeFlowsChart.tsx` | Comtrade year bar chart in dossier |
| `backend/services/entity_trade_flows.py` | License → `oil_trade_flows` HS27; reporter fuzzy + Eurostat `partner` match |
| `backend/services/deal_room_export_html.py` | Printable HTML deal export |
| `backend/arcgis_probe_sync_worker.py` | Weekly KZ + PH ArcGIS probes |
| `mining-viz/src/components/dossier/CompanyRegistryLinks.tsx` | Dossier OC + national register chips |
| `mining-viz/src/components/dossier/EntityTradeFlowsPanel.tsx` | Stored macro trade rows (Comtrade + Eurostat) in dossier |
| `backend/services/sync_alert_store.py` | Drift `sync_alert_events` + webhook stub |
| `backend/services/petroleum_osm_sync_store.py` | OSM sync run logging |
| `backend/ted_procurement_sync_worker.py` | Weekly TED refresh worker |
| `backend/services/ingest/poland_pgi_mining_sync.py` | Poland PGI MIDAS mining areas |
| `backend/services/cpv_commodity.py` | CPV bucket facets (mining/metals/petroleum) |
| `backend/services/eu_procurement_intel.py` | TED → entity fuzzy match |
| `backend/kazakhstan_mining_sync_worker.py` | Daily KZ egov register (key required) |
| `backend/sweden_mining_sync_worker.py` | Weekly SGU OGC sync |
| `mining-viz/src/components/EuProcurementFacets.tsx` | EU TED browse + CPV filter UI |
| `mining-viz/src/components/dossier/CountryCoveragePanel.tsx` | Per-country coverage in dossier |
| `backend/comtrade_sync_worker.py` | Daily Comtrade refresh worker |
| `backend/services/license_sync_store.py` | License sync run helpers |
| `mining-viz/src/lib/licenseVisibility.ts` | Hide junk fallbacks in UI |
| `backend/services/oil_live_graph_sync.py` | Live Data graph-sync orchestrator |
| `backend/services/vessel_position_observations.py` | Multi-source vessel position upsert + Redis maritime mirror |
| `backend/services/ingest/barentswatch_ais_sync.py` | BarentsWatch government AIS graph-sync step (`barentswatch_ais`) |
| `oil-live-intel/internal/services/vesselmerge/` | Map API merge reader (precedence: live_ais > aisstream/aishub > government AIS > maritime_redis > inferred > SAR) |
| `oil-live-intel/migrations/014_vessel_position_sources.sql` | Base `oil_vessel_position_observations` table |
| `oil-live-intel/migrations/017_open_ais_coverage.sql` | Source/freshness columns, `coverage_cells`, `port_event_observations`, watch zones, source health |
| `backend/services/census_trade.py` | U.S. Census HS27 macro flows |
| `backend/services/usitc_dataweb.py` | USITC DataWeb macro flows |
| `oil-live-intel/internal/services/syntheticbol/` | MCR recipes A–F + rebuild |
| `oil-live-intel/internal/services/search/` | Elasticsearch indexer + query builder for MCRs, companies, terminals, vessels |
| `oil-live-intel/cmd/oil-live-search-indexer/` | Worker syncing Postgres → ES on a ticker (default 300s) |
| `docs/LIVE_DATA.md` | Live Data onboarding, env keys, trader workflows |
