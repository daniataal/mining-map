# Live Data — user onboarding

**Last reviewed:** 2026-05-21

## What's implemented (2026-05)

| Area | Status | Notes |
|------|--------|-------|
| **Unified map** | Done | Terminals, vessels, corridors, opportunity markers on main map. Default fly-to Gulf hub bbox (24–55°E, 12–32°N) on tab entry. |
| **Intel drawer** | Done | Tabs: Intelligence, Opportunities, Cargo, Companies, Alerts. Product filter. Coverage health banner. |
| **Meridian Cargo Records (MCR)** | Done | Cargo ledger; row click opens left drawer with full MCR + evidence. CSV export. Seed-data toggle. |
| **Deal Execution Pack** | Done | Left drawer from map/opportunity/cargo. Deal-pack API + inline economics/margin sheet. |
| **Companies + contacts** | Done | Save to Suppliers, per-company agent, batch enrich via `POST /api/admin/oil-live/enrich-contacts?limit=20`. |
| **Graph sync CTA** | Done | Empty states link to admin graph-sync. |
| **Performance** | Done | Debounced map bbox (450ms, keepPreviousData). Shared opportunities cache; no refetch on pan for opps list. |
| **Live AIS** | Done | WebSocket positions; optional workers. |
| **Dedup** | Done | Client + server opportunity dedup/diversify. |
| **Trader workflows** | Done | Save to Suppliers (cargo/entity drawers), watch opportunity → `oil_watchlists` / `oil_alerts`, terminal search, commodity map filter, CSV export (cargo + opportunities). |
| **Route planner deep link** | Done | Deal pack + cargo drawer → **Open in Route Planner** pre-fills load/discharge from MCR port names. |
| **Company dossier link** | Done | Shipper/consignee + saved companies → opens existing license dossier when `supplier_id` is set. |
| **USITC macro trade** | Done | `backend/services/usitc_dataweb.py` on graph-sync (`USITC_DATAWEB_API_KEY`). |
| **EIA crude imports + refinery throughput** | Done | `backend/services/eia_imports.py` on graph-sync; new `oil_refinery_throughput` table; `EIA_API_KEY` optional (step skipped if unset). |
| **OpenSanctions screening** | Done | `backend/services/opensanctions_screening.py` on graph-sync; non-blocking UI chip; key optional. |
| **GLEIF LEI batch + Wikidata enrichment** | Done | `backend/services/gleif_batch.py` + `backend/services/wikidata_company_enrichment.py` populate `oil_companies.lei` + `wikidata_qid`. LEI/sanctions denormalised onto `meridian_cargo_records` post-rebuild via `oil_live_mcr_denormalize.py`. |

**Not yet / optional:** paid BOL ingestion, automated deal-room from opportunities, MCP CI smoke.

---

Live Data is Meridian’s **commercial intelligence mode**: a unified map plus intel drawer that fuses public AIS movement, OSM storage terminals, macro trade (Comtrade, Census, EIA), EU/US procurement, licenses, and a **synthetic cargo ledger** (BOL-shaped records built from triangulation — not paid Bill of Lading documents).

---

## Synthetic vs live

| Layer | What it is | How to tell in UI |
|-------|------------|-------------------|
| **Live** | Real-time AIS positions, open/closed port calls, WebSocket vessel updates | Vessel markers move; port calls tagged `live_ais` |
| **Synthetic / inferred** | Meridian Cargo Records (MCR), opportunities, intelligence cards | Amber “Synthetic cargo” badges, confidence %, triangulation source count |
| **Macro / seed** | Comtrade/Census country flows, OSM terminals, demo seed corridors | Coverage banner counts; `bol_tier=inferred`; disclaimer on every card |
| **Demo seed** | Curated hubs + graph-sync seed port calls when AIS is sparse | `source=seed_port_calls` in evidence; works without AIS key |

**We do not claim confirmed private deals.** Every row shows confidence, sources, and a disclaimer.

---

## Quick start (Docker)

From repo root with `.env` configured (see [Required env keys](#required-env-keys)):

```bash
# 1) Database + backend + oil-live-intel (applies migrations 001–011)
docker compose up -d db backend oil-live-intel

# 2) Health checks
curl -sf http://localhost:8095/api/oil-live/health | jq .
curl -sf http://localhost:8000/api/health | jq .

# 3) Populate the commercial graph (OSM terminals, trade mirror, synthetic cargo rebuild)
curl -sf -X POST "http://localhost:8000/api/admin/oil-live/graph-sync" \
  -H "X-Admin-Token: $ADMIN_TOKEN" | jq .

# 4) Optional: live AIS + port-call geofence
docker compose up -d maritime-worker oil-live-intel-worker

# 5) Verify coverage
curl -sf http://localhost:8095/api/oil-live/sync-status | jq .
curl -sf "http://localhost:8095/api/oil-live/cargo-records?limit=5" | jq .
```

Open the app → **Live Data** tab. You should see terminals on the main map (not a separate mini-map), intel drawer on the right, and cargo/opportunities after graph-sync.

---

## How to populate data

### Graph sync (primary — run this first)

Merges free sources into `mining_db` and triggers synthetic BOL rebuild:

```bash
curl -X POST "http://localhost:8000/api/admin/oil-live/graph-sync" \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

Optional query param: `rebuild_synthetic_bol=false` to skip the hourly MCR rebuild (faster, no new cargo rows).

**What graph-sync does:**

1. Import OSM storage terminals (up to `OIL_GRAPH_STORAGE_IMPORT_CAP`, default 15k)
2. Index petroleum licenses → companies + events ([LICENSE_BULK_IMPORT.md](../LICENSE_BULK_IMPORT.md) for CSV bulk ingest)
3. Mirror Comtrade/EIA/Census trade → commercial events
4. Mirror port calls, TED notices, USAspending awards
5. Seed demo corridors if port-call data is sparse
6. POST synthetic BOL rebuild to oil-live-intel

Scheduled worker (daily):

```bash
docker compose up -d oil-live-graph-sync-worker
```

### Synthetic cargo only (no full sync)

```bash
curl -X POST "http://localhost:8095/api/oil-live/internal/synthetic-bol-rebuild" \
  -H "X-Oil-Intel-Internal: $OIL_INTEL_INTERNAL_KEY"
```

### Live AIS (optional)

Requires `AISSTREAM_API_KEY` and both workers:

```bash
docker compose up -d maritime-worker oil-live-intel-worker
```

- **maritime-worker** → Redis snapshot → canvas vessel layer
- **oil-live-intel-worker** → terminal geofence port calls → intelligence cards + WebSocket

### Other admin syncs (optional)

```bash
# EU TED procurement
curl -X POST "http://localhost:8000/api/admin/eu-procurement/sync" \
  -H "X-Admin-Token: $ADMIN_TOKEN"

# Comtrade HS27 (Go worker, daily when enabled)
docker compose up -d oil-live-intel-worker
```

---

## Required env keys

| Variable | Required for | Notes |
|----------|--------------|-------|
| `ADMIN_TOKEN` | Graph-sync, admin ingest | Header `X-Admin-Token`. If unset in dev, admin routes are open (logged warning). |
| `AISSTREAM_API_KEY` | Live vessel positions + port calls | Free at [AISStream](https://aisstream.io/). Without it: seed/demo data only. |
| `CENSUS_API_KEY` | U.S. bilateral HS27 macro trade on graph-sync | Free at [Census API signup](https://api.census.gov/data/key_signup.html). Step skipped if unset. |
| `OIL_INTEL_INTERNAL_KEY` | Synthetic BOL rebuild from Python | Default `oil-intel-dev`; must match between backend and oil-live-intel. |
| `DATABASE_URL` | All services | Shared Postgres `mining_db`. |

**Commonly useful (optional):**

| Variable | Purpose |
|----------|---------|
| `COMTRADE_API_KEY` | Higher Comtrade quota |
| `EIA_API_KEY` | U.S. EIA petroleum volumes; also drives the new **EIA crude imports** + **refinery throughput** graph-sync steps (`backend/services/eia_imports.py`). Both skip cleanly when unset. |
| `OPENSANCTIONS_API_KEY` | Optional — higher-rate-limit OpenSanctions tier. Public API works without it. The graph-sync screening step (`backend/services/opensanctions_screening.py`) writes `oil_companies.sanctions_status` + `sanctions_matches` and never auto-blocks the UI. |
| `OPENSANCTIONS_BATCH_LIMIT` | Rows screened per graph-sync run (default 50). |
| `GLEIF_BATCH_LIMIT` | Rows enriched per graph-sync run by `backend/services/gleif_batch.py` (default 100); writes `oil_companies.lei` + `lei_record_id`. |
| `WIKIDATA_BATCH_LIMIT` | Rows enriched per graph-sync run by `backend/services/wikidata_company_enrichment.py` (default 50); writes `oil_companies.wikidata_qid` + `wikidata_facts`. |
| `WIKIDATA_USER_AGENT` | Override the polite contact string sent to Wikimedia per their User-Agent policy. |
| `OIL_GRAPH_SYNC_ENABLED` | `false` disables graph sync |
| `OIL_GRAPH_STORAGE_IMPORT_CAP` | Max OSM terminals per sync (default 15000) |
| `CENSUS_TRADE_SYNC_YEAR` | Census year (default: current year − 2) |
| `VITE_OIL_INTEL_BASE` | Frontend proxy base (empty = same origin `/api/oil-live`) |

See `.env.example` for the full list.

---

## Troubleshooting empty map

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Only 6 terminal dots (Ras Tanura, Fujairah, …) | Graph-sync never run | Run `POST /api/admin/oil-live/graph-sync` |
| No terminals at all | oil-live-intel not started / migrations missing | `docker compose up -d oil-live-intel`; check logs |
| No vessels | No AIS key or workers stopped | Set `AISSTREAM_API_KEY`; start `maritime-worker` + `oil-live-intel-worker` |
| Terminals but no cargo records | No closed port calls or rebuild skipped | Re-run graph-sync; check `curl …/sync-status` for `cargo_record_count` |
| Cargo tab empty, sync-status shows port calls | Synthetic rebuild failed | Check `OIL_INTEL_INTERNAL_KEY`; manual synthetic-bol-rebuild curl above |
| Live Data tab errors in console | Backend/intel not reachable | Verify `curl …/api/oil-live/health`; check Vite proxy / `VITE_OIL_INTEL_BASE` |
| Overpass timeout in Docker | Live OSM fetch blocked | Set `STORAGE_SKIP_LIVE_OVERPASS=true` (uses DB cache + bulk seed) |

**Coverage banner** (intel drawer header) shows: terminal count, live vessels, open opportunities, last graph-sync time. Ops endpoint:

```bash
curl -sf http://localhost:8095/api/oil-live/health | jq .
curl -sf http://localhost:8095/api/oil-live/sync-status | jq .
```

Expect `terminal_count` ≫ 6 after graph-sync; `cargo_record_count` > 0 when port calls + rebuild succeeded.

---

## Trader workflows

Actions available in the Live Data intel drawer and left entity drawer (no separate admin step).

| Action | Where | API / behavior |
|--------|--------|----------------|
| **Save to Suppliers** | Cargo drawer (MCR tab): shipper/consignee when `shipper_company_id` / `consignee_company_id` exist. Companies tab: per-row button. | `POST /api/oil-live/companies/{id}/save-to-suppliers` → Python license + Deal-signal annotation |
| **Watch opportunity** | Opportunities tab card + entity drawer header (bell). Watches terminal ID if linked, else `opportunity_type`. | `POST /api/oil-live/watchlists` → matcher fills `oil_alerts` on new opps/cards |
| **Terminal search** | Intel drawer search box (name / country / port / operator). | Client filter on map bbox terminals + index hint count |
| **Commodity filter** | Product chips (crude / refined / gas / sulfur / all). | Map: terminal `products[]` + corridor `commodity_family`; Cargo tab uses same filter on API |
| **Export CSV** | Cargo tab and Opportunities tab **Export CSV**. | Client download (`meridian-cargo-records-*.csv`, `meridian-opportunities-*.csv`) |
| **Open in Route Planner** | Deal pack + cargo drawer (MCR). | Pre-fills supplier (load) and buyer (discharge) from MCR port names + corridor coords |
| **Open dossier** | Cargo shipper/consignee links; Companies tab when saved. | Resolves `supplier_id` → map license dossier (`DossierView`) |

**License-driven suppliers:** Bulk CSV import format and API are documented in [LICENSE_BULK_IMPORT.md](../LICENSE_BULK_IMPORT.md). Graph-sync step 2 indexes those licenses into `oil_companies`; **Save to Suppliers** creates a Deal-signal license for outreach.

**Alerts tab:** lists `oil_alerts` as readable cards (same typography as Intelligence/Opportunities), watchlist section, mark-read / assign. Requires graph-sync + watch actions for meaningful matches.

---

## End-to-end test checklist

1. Start stack: `docker compose up -d db backend oil-live-intel`
2. Graph-sync with admin token → `terminal_count` in sync-status increases
3. Open app → Live Data → map shows terminal clusters (zoom to Rotterdam, Houston, Singapore)
4. Intel drawer → **Cargo** tab → synthetic records with shipper/consignee
5. Click terminal or vessel → **Deal Execution Pack** drawer
6. (With AIS) Vessel markers update; intelligence feed gets new cards
7. Export CSV from Cargo tab → opens download with current filters
8. Opportunities tab → **Watch** → row appears under Alerts → Watchlists
9. Open cargo record on map → **Save shipper/consignee to Suppliers** when company IDs present
10. Terminal search (e.g. `Rotterdam`) → map terminal markers filter in view
11. Commodity chip **crude** → corridors and terminals narrow to crude family
12. Opportunities **Export CSV** → `meridian-opportunities-YYYY-MM-DD.csv`

---

## Architecture (one paragraph)

External free APIs (OSM, AISStream, Comtrade, Census, TED, USAspending, licenses) are ingested by Python schedulers and Go workers into **mining_db**. The unified map reads `/api/oil-live/map`; the intel drawer reads cargo, companies, opportunities, and deal-pack APIs. Users interact with **Meridian’s merged graph**, not raw source feeds.

Further detail: [oil-live-intel/README.md](../oil-live-intel/README.md), [DATA_SOURCES.md](./DATA_SOURCES.md), plan `.cursor/plans/live_data_unification_1ae1516a.plan.md`.

---

## Routing (Caddy + Vite)

Browser requests to `/api/oil-live/*` must reach **oil-live-intel** on port **8095** (not the Python backend).

| Environment | Proxy |
|-------------|-------|
| **Docker (production-like)** | `Caddyfile` line 5: `reverse_proxy /api/oil-live/* oil-live-intel:8095` — Caddy listens on host `:8080`. |
| **Vite dev server** | `mining-viz/vite.config.ts`: `/api/oil-live` → `http://oil-live-intel:8095` (WebSocket enabled). |
| **Direct API** | `curl http://localhost:8095/api/oil-live/health` bypasses Caddy. |

Leave `VITE_OIL_INTEL_BASE` empty so the frontend uses same-origin `/api/oil-live` (Caddy or Vite proxy). Set it only when oil-live-intel runs on a different host.

**Smoke:**

```bash
curl -sf http://localhost:8080/api/oil-live/health | jq '.sync'
curl -sf http://localhost:8095/api/oil-live/health | jq '.sync'
```

Both should return a `sync` object with `terminal_count`, `cargo_record_count`, etc.

---

## Cargo seed data filter

Graph-sync may insert demo **seed port calls** (`source=seed_port_calls`) when AIS data is sparse. Cargo rows derived from those port calls show an amber **Demo seed** badge.

- **Default (production feel):** Cargo tab hides seed-derived rows. Toggle **Include seed data** to show them.
- **API:** `GET /api/oil-live/cargo-records?exclude_seed=true` (used by the UI when the toggle is off).

---

## Production checklist

Use this before shipping Live Data to users or a demo environment.

### Infrastructure

- [ ] `docker compose up -d db backend oil-live-intel oil-live-graph-sync-worker`
- [ ] Optional live AIS: `AISSTREAM_API_KEY` set; `maritime-worker` + `oil-live-intel-worker` running
- [ ] Caddy proxies `/api/oil-live/*` → `oil-live-intel:8095` (see [Routing](#routing-caddy--vite))
- [ ] `OIL_INTEL_INTERNAL_KEY` matches between backend and oil-live-intel

### Security & secrets

- [ ] `ADMIN_TOKEN` set in production (admin routes reject requests without `X-Admin-Token`)
- [ ] No demo seeds in production UI unless intentional (`MARITIME_GULF_DEMO_SEED=0`, Cargo **Include seed data** off by default)
- [ ] API keys (AIS, Census, Comtrade) in env / secrets — not committed

### Data population

- [ ] `POST /api/admin/oil-live/graph-sync` completed successfully
- [ ] `curl …/api/oil-live/health` → `sync.terminal_count` ≫ 6
- [ ] `sync.cargo_record_count` > 0 after synthetic BOL rebuild
- [ ] `sync.last_graph_sync_at` is recent

### Frontend

- [ ] Rebuild frontend after env changes: `docker compose up -d --build frontend` (or Vite dev reload)
- [ ] Live Data tab loads without console errors
- [ ] Map shows terminal clusters; intel drawer coverage banner matches sync-status counts
- [ ] Cargo tab lists records (with seed toggle off for production demos)

### MCP (optional)

- [ ] `.cursor/mcp.json` includes `oil-live-intel` server pointing at `mining-map-oil-live-intel:latest` on Docker network `mining-map_default`
- [ ] Image built: `docker compose build oil-live-intel`

### Monitoring

- [ ] `GET /api/oil-live/health` and `GET /api/oil-live/sync-status` return 200
- [ ] `docker compose logs oil-live-intel --tail 50` shows no repeated panics or DB connection errors
