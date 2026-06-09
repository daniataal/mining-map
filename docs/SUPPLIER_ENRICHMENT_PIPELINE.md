# Supplier enrichment pipeline (open-data, deal execution)

Meridian's goal: when a trader finds an opportunity on the map, answer **"who can I talk to, and how do I verify they're real?"** without paid ZoomInfo/D&B at global scale.

This doc maps the enrichment strategy (OSM → Wikidata → GLEIF → registries → contact pages) onto **existing Postgres tables** — not a parallel CRM.

## Design principle

Commercial vendors use a **pipeline**, not one API:

```
Discover → Normalize name → Website → Contact extract → Legal verify → Geocode → Classify → Score
```

Meridian stores **source-attributed facts** with confidence — never fabricated phones.

## Where data lives today (reuse, don't duplicate)

| Layer | Table / API | Role |
|-------|-------------|------|
| Company identity | `oil_companies` | Name, country, type, LEI, Wikidata, sanctions, `metadata` |
| Public contacts | `oil_company_contacts` | Phone/email/website from registries (Go `GET /api/oil-live/companies/{id}/contacts`) |
| License bridge | `oil_companies.supplier_id` → `licenses.id` | Save-to-Suppliers workflow |
| License contacts | `entity_contacts` | Open-data phones from license `raw_payload` |
| Port tenants | `port_authority_directories.json` → graph-sync | Tank/storage operators at hubs |
| Bunker suppliers | `bunker_fuel_suppliers_seed.json` → graph-sync | **Licensed fuel/bunker sellers** |
| Infrastructure | GEM / OSM / curated storage | Operators & capacity (not always sellers) |

### Important distinction (from fuel-trader research)

| Role | Holds product? | Example |
|------|----------------|---------|
| `bunker_supplier` | Often yes (licensed seller) | Fujairah licensed bunker list |
| `terminal_operator` | Usually no (storage only) | Vopak, Oiltanking |
| `trader` | Sometimes (principal) | Vitol bunker desk |
| `refinery` | Produces | ADNOC Ruwais |

UI must **not** label a tank farm operator as a diesel seller unless registry tier supports it.

## Phased workers (minimum cost → maximum value)

### Phase 1 — Free, high signal (implemented / in progress)

| Worker | Source | Writes to | Status |
|--------|--------|-----------|--------|
| `bunker_fuel_suppliers` graph-sync | `data/bunker_fuel_suppliers_seed.json` | `oil_companies`, `oil_company_contacts`, geocode metadata | **Go (default)** |
| Port authority tenants | `port_authority_directories.json` | `oil_companies` | Existing |
| GLEIF batch | GLEIF public API | `oil_companies.lei` | Existing graph-sync |
| Wikidata batch | Wikidata | `oil_companies.wikidata_*` | Existing |
| OSM petroleum sync | Overpass | `licenses` / OSM features | Existing |
| Company resolve | Fuzzy match | `/api/companies/resolve` | Existing |

**Sync (Go):** `OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS=true` on `oil-live-intel-worker` (writes `display_lat/lng`, `geocode_tier` via Nominatim + OSM fallback). Legacy Python admin sync when flag is false.  
**Map read:** `GET /api/suppliers/nearby?locode=SGSIN` returns `lat`, `lng`, `geocode_tier`, `geocode_disclaimer`  
**UI:** `NearbySuppliersMapLayer` (tier-styled markers) + `NearbySuppliersPanel` on Oil Logistics map

**Expansion plan (more hubs / MPA / UK / ILT):** [runbooks/BUNKER_REGISTER_EXPANSION.md](runbooks/BUNKER_REGISTER_EXPANSION.md)

### Phase 1b — Bunker register expansion (planned)

| Hub | Source | Target count | Status |
|-----|--------|--------------|--------|
| Fujairah | [Port licensed bunker table](https://fujairahport.ae/marine-centre/fujairah-offshore-anchorage-area/service-providers/bunkering-companies/) | 14 | **In seed** (13 with tel+email) |
| Singapore | [MPA licensed suppliers PDF](https://www.mpa.gov.sg/port-marine-ops/marine-services/bunkering/bunkering-service-providers) | ~39 | Pending transcription |
| Netherlands | ILT marine fuel oil suppliers | TBD | Pending |
| UK | MARPOL local fuel oil suppliers (gov.uk) | TBD | Pending |
| Gibraltar, Malta, Houston, Piraeus, Istanbul | Port/regulator directories | 5–20 each | Pending |

See full backlog and todos in **BUNKER_REGISTER_EXPANSION.md**.

### Phase 2 — More work, still free

| Worker | Source | Target |
|--------|--------|--------|
| `worker_osm_discovery` | Overpass `phone=*`, `contact:phone=*`, `operator`, `website` on industrial POIs | `entity_contacts` via license rows or `oil_company_contacts` |
| `worker_wikidata_enrichment` | SPARQL official website, HQ | `oil_companies.website`, metadata |
| MPA / ILT / UK bunker registers | Scrape/transcribe official PDF/HTML lists | Expand `bunker_fuel_suppliers_seed.json` |
| Petroleum import licence registers | National energy ministries | New seed rows `fuel_importer` |

### Phase 3 — Contact enrichment (lead-grade)

| Source | Contact type | Tier |
|--------|--------------|------|
| Official company website `/contact` | Business phone/email | High if on official site |
| Common Crawl index | Contact page discovery | Medium — requires crawl job |
| SEC EDGAR | IR / filing links | US issuers |
| Companies House | Officers, registered address | UK only |
| EU VIES | VAT validation | EU |
| User annotations | Private lead phone | User tier — dossier only |

**Product flow:** Operator → Resolve → Open dossier → `CompanyContactEnvelope` (GLEIF + registry + manual Wikidata/SEC) → Save to Suppliers.

### Phase 4 — Paid bridges (explicit approval only)

OpenCorporates API, ImportYeti/manifest consignees, paid registry APIs.

## Confidence scoring (simple MVP)

| Signal | Score bump |
|--------|------------|
| Licensed bunker register | +0.40 |
| Government petroleum licence | +0.35 |
| GLEIF legal entity match | +0.25 |
| OSM `phone` on tagged facility | +0.20 |
| Same phone in 2+ sources | +0.25 |
| Only random directory | −0.20 |
| No official website | −0.15 |

Store as `oil_companies.confidence` + per-contact notes in `oil_company_contacts.notes`.

## Hub playbook (expand seed first)

Start with 10 hubs (not global crawl):

Singapore · Fujairah · Rotterdam · Antwerp · Houston · Gibraltar · Malta · Istanbul · Jebel Ali · Piraeus

For each hub, collect:

1. Licensed bunker suppliers list (port/regulator URL)
2. Marine fuel oil supplier register (MARPOL Annex VI where published)
3. Petroleum wholesale/import licence register (national energy ministry)
4. Cross-link to curated storage terminals (operator ≠ seller)

## Deal execution UX (why users pay)

| Map click | Minimum bar | Platform action |
|-----------|-------------|-----------------|
| Tank farm | Operator + capacity + source URL | Storage popup + port tenants |
| Pipeline | Owner/operator/capacity (GEM) | Drawer + dossier lead |
| Port / bbox | Nearby bunker suppliers | `NearbySuppliersPanel` |
| Any operator | LEI + registry links | `CompanyContactEnvelope` in dossier |

Future: **Deal Pack generator** — commodity + quantity + route → matched suppliers, storage, inspection, risk flags.

## Ops

```bash
# After editing data/bunker_fuel_suppliers_seed.json (proxies to Go when OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS=true)
curl -X POST http://localhost:8080/api/admin/bunker-fuel-suppliers/sync \
  -H "X-Admin-Token: $ADMIN_TOKEN"

# Direct Go internal (from backend container network)
curl -X POST http://oil-live-intel:8095/api/oil-live/internal/bunker-fuel-suppliers/sync \
  -H "X-Oil-Intel-Internal: $OIL_INTEL_INTERNAL_KEY"

# Or wait for oil-live-intel-worker graph-sync cold step (daily)

# Verify (Caddy → Go read path)
curl "http://localhost:8080/api/suppliers/nearby?locode=SGSIN" | jq '.suppliers[:3] | .[] | {name, lat, geocode_tier}'

bash oil-live-intel/scripts/validate_graphsync_bunker_fuel_suppliers.sh
```

**Rollback:** set `OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS=false` and restart workers; Python `sync_bunker_fuel_suppliers_to_companies` resumes on admin sync.

## Legal / product guardrails

- Only **public business** phones/emails from official sites or government registers.
- No private mobile scraping, no WhatsApp harvesting, no paywall bypass.
- Always show **source URL + tier badge**; disclaim tank lessor vs seller confusion.

## Related docs

- `docs/DATA_SOURCES.md` — open-data tiers
- `docs/runbooks/GEM_GULF_VM_INGEST.md` — infrastructure ingest
- Map UX plan — commercial envelope on pipeline/tank clicks
