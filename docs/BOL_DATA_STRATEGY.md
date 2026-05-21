# BOL / ImportYeti-style data strategy

**Last reviewed:** 2026-05-21

Meridian does **not** replicate ImportYeti’s proprietary Bill of Lading (BOL) database. Instead we run a **combined-source BOL synthesis**: every Meridian Cargo Record (MCR) is built by triangulating multiple **free, attributable public signals** — AIS port calls, OSM storage terminals, Comtrade / U.S. Census / EIA macro trade, EU TED & USAspending procurement, licenses, GLEIF LEI, OpenSanctions, and Wikidata — under triangulation recipes **A–G**. No single source is presented as a confirmed BOL; the synthesis (and its evidence chain + tier label) is the product.

This document explains how products like ImportYeti typically obtain trade intelligence, what Meridian builds instead (**Synthetic Meridian Cargo Records — MCR**), and which **legal, free** ingest paths we use or may add.

Related: [DATA_SOURCES.md](./DATA_SOURCES.md), [LIVE_DATA.md](./LIVE_DATA.md), `.cursor/plans/live_data_unification_1ae1516a.plan.md`, `.cursor/plans/bol-corridors-enrichment_650897c2.plan.md`.

---

## 1. How ImportYeti-like products typically get data

ImportYeti and similar “US import search” tools surface **company-level shipment rows** (shipper, consignee, HS code, weight, port, vessel). They are **not** built from a single free government “download all BOLs” API.

| Source class | What it is | Typical access | Legal / cost notes |
|--------------|------------|----------------|-------------------|
| **US customs manifest / AMS data** | Ocean carrier manifests filed with CBP (Automated Manifest System) | Licensed data brokers, aggregators, or FOIA-style bulk purchases | **Not free**; redistribution restricted; CBP does not publish full searchable BOLs for commercial scraping |
| **Freight forwarder / NVOCC feeds** | Operational shipment files from logistics partners | Paid contracts, EDI/API with partners | Contract-bound; not redistributable as open data |
| **Scraped public filings** | Court records, occasional partial disclosures, third-party leak sites | Web scraping / OCR | **High legal risk** (CFAA, ToS, privacy); unreliable; **do not use** |
| **Paid broker networks** | Panjiva (S&P), ImportGenius, Descartes Datamyne, etc. | Enterprise subscription | Licensed; expensive; terms prohibit re-scraping their UI |
| **User submissions** | Importers/exporters upload documents | Crowdsourcing | Consent-based; still not “all US trade” |
| **Macro trade statistics** | Comtrade, Census, Eurostat — **country/HS aggregates** | Free APIs | **Legal and free** but **not** company-level BOL rows |

**Important:** There is **no** legitimate path to “free unpaid BOLs at ImportYeti scale.” Marketing that suggests otherwise usually means scraped broker data, stale samples, or aggregated stats mislabeled as manifests.

---

## 2. What Meridian does instead — legal stack

**Product decision:** “ImportYeti replication” = **synthetic MCR at scale** from **triangulated public signals**, not copying ImportYeti’s DB or scraping CBP.

### 2.1 Already wired (graph sync + oil-live-intel)

| Layer | Module / service | Output | BOL-like? |
|-------|------------------|--------|-----------|
| **AIS port calls** | `maritime-worker`, `oil-live-intel-worker` | `oil_port_calls`, vessel ↔ terminal timing | Movement evidence, not consignee |
| **UN Comtrade** | `comtrade_scheduled_sync.py`, graph-sync mirror | `oil_trade_flows` (`data_source=comtrade`) | Macro corridor validation |
| **U.S. Census trade** | `census_trade.py` → graph-sync step `census_trade` | `oil_trade_flows` (`data_source=census_api`) | U.S. bilateral HS 2709/2710/2711 |
| **USITC DataWeb** | `usitc_dataweb.py` | `oil_trade_flows` (`data_source=usitc_dataweb`) | U.S. HS flows + tariff context |
| **EU TED** | `ted_procurement_sync.py` | Procurement notices → Recipe **C** | Buyer intent, not shipment |
| **USAspending** | `gov_procurement_sync.py` | Awards → Recipe **E** | Government offtake hint |
| **License / supplier graph** | `oil_live_graph_sync.py` | `oil_companies`, commercial events | Counterparty candidates |
| **Synthetic BOL engine** | `oil-live-intel/internal/services/syntheticbol/engine.go` | `meridian_cargo_records` | **MCR** — labeled synthetic, scored, sourced |
| **Recipe G — refinery_driven** | `engine.go` (Worker B); EIA-feedstock inputs from `eia_imports.py` | `meridian_cargo_records` rows tagged `recipe='refinery_driven'` | Macro tier; baseline confidence 0.7 with +1 score when a vessel port-call corroborates |

Triangulation recipes **A–G** combine the above (port call + draft + Comtrade corridor + tender + repeat visit + refinery feedstock). Every MCR carries `bol_tier`, `triangulation_score`, `evidence_chain`, and `sources[]` with URLs where applicable.

### 2.2 Env keys (macro tier — not company BOL)

```bash
COMTRADE_API_KEY=          # UN Comtrade (free tier)
CENSUS_API_KEY=            # https://api.census.gov/data/key_signup.html
USITC_DATAWEB_API_KEY=     # https://dataweb.usitc.gov/
AISSTREAM_API_KEY=         # live port calls
OIL_GRAPH_SYNC_ENABLED=true
```

Run graph sync: `POST /api/admin/oil-live/graph-sync` or `oil-live-graph-sync-worker`.

---

## 3. New ingest ideas we **can** add (legal only)

Only ingest when **`source` is a public API with a documented URL** and license permits storage/redisplay.

| Idea | Status | Notes |
|------|--------|-------|
| **Census import/export detail** | **Wired** | `backend/services/census_trade.py`; runs on every graph sync when `CENSUS_API_KEY` set |
| **EU trade stats (Eurostat COMEXT / TARIC reference)** | **Roadmap** | Eurostat REST (`ec.europa.eu/eurostat`) for EU27 HS27 aggregates — same macro tier as Comtrade; TARIC is nomenclature, not manifests |
| **Public manifest-style records** | **Conditional** | Only if tied to an **official open API** (e.g. future verified government bulk export with license). Never scrape ImportYeti/CBP portals |
| **OpenSanctions screening** | **Wired** (Phase 4a) | `backend/services/opensanctions_screening.py`; batches `oil_companies` per graph-sync run (≤50 by default). Status chip only — never auto-blocks the UI. Public API works without a key; `OPENSANCTIONS_API_KEY` enables the higher-rate-limit tier |
| **GLEIF LEI batch** | **Wired** (Phase 4c) | `backend/services/gleif_batch.py` writes `oil_companies.lei` + `lei_record_id`; per-run cap via `GLEIF_BATCH_LIMIT` (default 100). LEI also denormalised onto `meridian_cargo_records.shipper_lei` / `consignee_lei` |
| **Wikidata company enrichment** | **Wired** (Phase 4c) | `backend/services/wikidata_company_enrichment.py` resolves a Q-id then pulls P1278 (LEI), P452 (industry), P159 (HQ), P17 (country), P856 (website), P646 (Freebase). Throttled ≤1 req/s with `Meridian/1.0` User-Agent |
| **EIA crude imports** | **Wired** (Phase 4b) | `sync_eia_crude_imports` aggregates the last 12 months from `https://api.eia.gov/v2/crude-oil-imports/data/` and upserts macro rows into `oil_trade_flows` (`data_source='eia'`, HS 2709) |
| **EIA refinery throughput** | **Wired** (Phase 4b) | `sync_eia_refinery_throughput` reads weekly PADD utilisation from `/v2/petroleum/pnp/wiup/data/` into a new `oil_refinery_throughput` table (created inline via `CREATE TABLE IF NOT EXISTS`). Feeds **Recipe G** |

### 3.1 Manifest-style rule

Store a row as manifest-like **only when**:

1. `sources[].url` points to a **public API or open government dataset**;
2. License allows automated fetch and display;
3. UI labels tier (`synthetic` / `inferred` / `macro`) — never imply paid BOL confirmation.

---

## 4. Roadmap: “ImportYeti replication” definition

| Term | Meaning in Meridian |
|------|---------------------|
| **ImportYeti replication** | High-volume **MCR** ledger + company graph + deal packs from **free** sources |
| **Not in scope** | Scraping ImportYeti, CBP manifest portals, or broker UIs; buying Panjiva/ImportGenius and republishing |
| **Scale lever** | More AIS port calls, more graph-sync sources, richer recipes, user CSV suppliers ([LICENSE_BULK_IMPORT.md](../LICENSE_BULK_IMPORT.md)) |

Success metric: traders get **actionable hypotheses** (movement + macro corridor + counterparty hints + readiness checklist), not a clone of ImportYeti search.

---

## 5. What NOT to do

| Action | Why forbidden |
|--------|----------------|
| **Scrape ImportYeti (or any BOL SaaS UI/API)** | ToS violation; CFAA risk; not our data |
| **Scrape CBP / customs manifest portals** | Restricted data; no bulk public BOL API |
| **Present Comtrade/Census rows as company BOLs** | Misleading; macro ≠ consignee shipment |
| **Copy broker datasets** | License breach |
| **Hide synthetic provenance** | Product trust; always show MCR badges and disclaimers |

---

## 6. References

- CBP Automated Manifest System — operational filing system, not a free commercial BOL API
- U.S. Census International Trade API — https://api.census.gov/data/timeseries/intltrade/
- UN Comtrade — https://comtradeplus.un.org/
- Eurostat COMEXT — https://ec.europa.eu/eurostat/web/main/data/web-services
- U.S. EIA crude oil imports — https://api.eia.gov/v2/crude-oil-imports/data/
- U.S. EIA refinery utilisation by PADD — https://api.eia.gov/v2/petroleum/pnp/wiup/data/
- OpenSanctions default search — https://api.opensanctions.org/search/default
- GLEIF LEI public API — https://api.gleif.org/api/v1/lei-records
- Wikidata MediaWiki API — https://www.wikidata.org/w/api.php
- Meridian implementation — `oil-live-intel/internal/services/syntheticbol/`, `backend/services/oil_live_graph_sync.py`

---

## 7. What an arrow tells you (per-MCR vs aggregated Trade Flow)

Meridian renders trade movement in two map layers. Both are driven by the same `meridian_cargo_records` ledger; the difference is granularity.

### 7.1 Per-MCR arrow (default `corridors` layer)

Every Meridian Cargo Record becomes a directional arrow from `corridor_load_lat/lng` (origin) to `corridor_discharge_lat/lng` (destination). The arrow's visual properties carry meaning at a glance:

| Visual | Meaning | Source field |
|--------|---------|--------------|
| **Color** | Commodity family (crude / refined / gas / sulfur) — matches the chip palette in `LiveDataMapLayersPanel` | `commodity_family` |
| **Weight (line thickness)** | Volume — log-scaled `volume_best_estimate`, clamped to 1–6 px so small / large cargoes both stay readable | `volume_best_estimate` |
| **Opacity** | Recency — full opacity for events <30 days, fading to ~0.4 by 180 days; older events keep a minimum 0.3 so they remain selectable | `event_date` |
| **Dash pattern** | Tier — dashed for `bol_tier='synthetic'` and `data_provenance='seed_port_calls'`; solid for `live_ais`; double-stroke when `triangulation_score >= 4` | `bol_tier`, evidence chain, `triangulation_score` |
| **Arrowhead** | Direction (load → discharge), placed near the discharge end via `leaflet-arrowheads` / polyline decorator | `corridor_load_*` / `corridor_discharge_*` |
| **Curvature** | Small geodesic bend so overlapping origin↔destination pairs fan out instead of stacking | computed in `mining-viz/src/lib/corridorGeometry.ts` |
| **Popup** | Volume band (`volume_low – volume_best_estimate – volume_high`), recipe label A–G, top-2 `evidence_chain` lines, LEI + Sanctions chips for shipper/consignee, "Verify source" links, "View deal pack" CTA | `volume_*`, `recipe`, `evidence_chain`, `shipper_lei` / `consignee_lei`, `shipper_sanctions_status` / `consignee_sanctions_status`, `sources[]` |

**Per-MCR arrows are the honest view:** each one is one record. We cap to ≤200 visible arrows within the current bbox so Leaflet stays smooth — that's the same cap idea as the terminal cluster layer.

### 7.2 Aggregated Trade Flow layer (`tradeFlows` toggle, off by default)

A separate layer surfacing **trader-level patterns** by rolling MCRs up to:

* `company_pair` — `shipper_id → consignee_id` arcs (e.g. ARAMCO → RELIANCE for crude)
* `country_pair` — `load_country → discharge_country` arcs (e.g. Saudi Arabia → India)

Arcs are thicker (2–10 px weight) than per-MCR arrows and carry a cargo-count badge at the midpoint. Each arc's popup links to the top contributing MCRs ("Show contributing cargoes") and opens the `OilLiveEntityDrawer` for those companies. The aggregated layer is dedup-/diversification-aware (same idea as `dedupeOpportunities.ts`) so the biggest traders don't drown smaller corridors.

Visible aggregate-arc cap: ≤80 within bbox.

### 7.3 What an arrow does **not** tell you

* It is **not** a confirmed Bill of Lading. The `bol_tier` badge (`synthetic` / `inferred` / `macro`) is always shown next to every chip.
* Volumes are estimates from draft change / EIA macro flow / Comtrade rollup — see `volume_method` for which.
* LEI and Sanctions chips show **the operator's best public match**, not legal confirmation. We never auto-block on a sanctions chip; the trader reviews and decides.

For the full provenance ladder, see [LIVE_DATA.md § Synthetic vs live](./LIVE_DATA.md#synthetic-vs-live).
