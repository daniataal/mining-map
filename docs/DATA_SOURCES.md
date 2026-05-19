# Data sources catalog (free & open only)

This document is the operational source-of-truth for **what** Meridian ingests, **why** gaps exist (e.g. Kazakhstan), and **how** to verify rows in production. Paid APIs (Mapbox tilesets, commercial company registries) are called out explicitly so we do not mistake them for official cadastre data.

**Last reviewed:** 2026-05-19

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
| Australia (QLD) | mining | `australia_queensland_mineral_tenement` | State only, capped |
| Global | mining | `usgs_mrds_global` | **Fallback** — sites/deposits, not licences; updates ceased ~2011 |
| Global | oil_and_gas | `megagiant_oil_gas_fields_world` | **Fallback** — giant fields only |

### 2.2 Other backend ingest (not ArcGIS list)

| Module | Data | Free? | Verification |
|--------|------|-------|--------------|
| `opec_gulf_sync.py` | Gulf/OPEC NOCs, major fields, terminals | Static + optional EIA API key | `record_origin` → `opec_gulf_reference` / open_data; compare to national NOC sites |
| `gov_procurement_sync.py` | USAspending contract awards | Yes (US federal) | Award ID on USAspending.gov |
| `csv_fallback_import.py` | User/admin CSV (e.g. SA/Ghana mining) | User-provided | `user_import_csv`; source file + row hash |
| `petroleum_infrastructure.py` | Exploration polygons, pipelines, refineries | **Mapbox** (oilmap tilesets) | Layer catalog `limitations`; token env `MAPBOX_ACCESS_TOKEN` |
| `petroleum_trade.py` / Comtrade | Bilateral HS27 trade flows | UN Comtrade (free tier limits) | Reporter/partner codes in API response |
| `ingest_oil_trades.py` | Static Comtrade-style seeds | Reference | Documented M49/HS codes |
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
| **Latin America** | ANM Colombia, ANM-style portals | National URLs vary | Open gov (varies) | **Gap** | Per-country licence ID |
| **Petroleum infra** | OSM pipelines (`man_made=pipeline`) | Overpass API | ODbL | **`overpass`** (opt-in map layers) | OSM way ID + tag inspection |
| **Petroleum infra** | oilmap / Mapbox tilesets | Mapbox | Third-party | **Paid** — `petroleum_infrastructure` | Document token; not official |
| **Trade** | UN Comtrade HS 2709/2710 | https://comtrade.un.org/ | UN terms (free tier) | `api` (partial in repo) | Reporter/partner/year in response |
| **US deals** | USAspending | https://api.usaspending.gov/ | US open data | `api` | `award_id` link |
| **US companies** | SEC EDGAR full-text search | https://www.sec.gov/edgar | US public | **Roadmap** `api` | CIK + filing accession |
| **Companies** | OpenCorporates | https://opencorporates.com | **Paid API** | Do not use API | Manual web check only |
| **Companies** | GLEIF LEI | https://www.gleif.org/en/lei-data | Open LEI | **Roadmap** | LEI record match |
| **EU contracts** | TED / EU procurement | https://ted.europa.eu/ | EU open | **Gap** | Notice ID |

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
- **`licenses.manually_edited`** — when `TRUE`, automated upsert (ArcGIS sync, bulk CSV) must **not** overwrite the row (`UPSERT ... WHERE manually_edited IS NOT TRUE`).

### 5.2 Verification UI (roadmap)

1. **Coverage panel** — already: `/api/open-data/coverage/world` with `status`, `references[]`, `source_ids[]`.
2. **Row dossier** — show `source_record_url`, `last_synced_at`, `record_origin`, link “Verify at source”.
3. **Sync health** — admin list of `license_sync_runs` + last success per `source_id`.
4. **Scheduled verify** — cron: `POST /api/admin/open-data/sync` + compare counts vs previous run; alert on >20% drop.

### 5.3 Export / import

| Audience | Endpoint | Behavior |
|----------|----------|----------|
| User | `GET /licenses/export` | CSV without provenance columns |
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

### Weeks 5–8 (breadth) — Phase 2 implemented (2026-05-19)

| Workstream | Status | Notes |
|------------|--------|-------|
| **Annotations persistence** | Done | `GET/PUT /api/licenses/{id}/annotations`, bulk `GET /api/licenses/annotations`; frontend hydrates from server when logged in, one-time localStorage merge. |
| **Sync drift alerts** | Done | `SYNC_DRIFT_ALERT_PCT` (default 20); `drift_warning` on `license_sync_runs`; `GET /api/open-data/sync-alerts`; admin Open Data drift badges. |
| **Kazakhstan mining** | Done (starter) | `KZ_EGOV_API_KEY` in `.env.example`; robust `normalize_egov_row`; `POST /api/admin/kazakhstan-mining/sync`; mocked HTTP tests. |
| **OSM petroleum** | Done (starter) | `GET /api/petroleum/osm-layers/{pipelines\|refineries}`; Overpass tile cache; opt-in map layers labeled “OpenStreetMap (community)”. |
| **SEC EDGAR linker** | Done (starter) | `GET /api/companies/{name}/sec-filings`; dossier SEC link; `SEC_EDGAR_USER_AGENT`; mocked ticker JSON tests. |
| **Central Asia hydrocarbons** | Not started | KZ ArcGIS verify; Turkmenistan/Uzbekistan portal research → Phase 3. |
| **EU mining / LatAm** | Not started | INSPIRE WFS, Colombia ANM, Peru INGEMMET → Phase 3. |
| **Comtrade refresh** | Not started | Scheduled HS27 with quota backoff → Phase 3. |

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
```

---

## 9. Related files

| File | Role |
|------|------|
| `backend/services/ingest/open_data_sync.py` | `OPEN_DATA_SOURCES`, coverage overrides |
| `backend/services/ingest/opec_gulf_sync.py` | Gulf/OPEC reference |
| `backend/services/petroleum_infrastructure.py` | Mapbox oilmap layers |
| `backend/services/ingest/gov_procurement_sync.py` | USAspending + `gov_procurement_sync_runs` |
| `backend/services/license_sync_store.py` | License sync run helpers |
| `mining-viz/src/lib/licenseVisibility.ts` | Hide junk fallbacks in UI |
