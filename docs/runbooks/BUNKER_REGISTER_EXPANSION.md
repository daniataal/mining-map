# Bunker register expansion plan

Execution backlog for **licensed marine fuel / bunker suppliers** from the open-data sources identified in fuel-trader research (MPA, Port of Fujairah, UK MARPOL registers, ILT, etc.).

**Parent doc:** [SUPPLIER_ENRICHMENT_PIPELINE.md](../SUPPLIER_ENRICHMENT_PIPELINE.md)  
**Data file:** `data/bunker_fuel_suppliers_seed.json`  
**Sync:** Go graph-sync step `graphsync_bunker_fuel_suppliers` (`OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS=true`) or legacy `POST /api/admin/bunker-fuel-suppliers/sync` when flag false

---

## Goal

Grow from ~14 Fujairah companies to **500–2,000 registry-attributed bunker/fuel suppliers** across 10 hubs — with **source URL + confidence per field**, never fabricated contacts.

---

## Register source matrix (ChatGPT / open-data research)

| Priority | Hub / country | Official source | Format | Phone on register? | Status |
|----------|---------------|-----------------|--------|-------------------|--------|
| P0 | **Fujairah** (AEFJR) | [Port licensed bunker list](https://fujairahport.ae/marine-centre/fujairah-offshore-anchorage-area/service-providers/bunkering-companies/) + [PDF](https://fujairahport.ae/wp-content/uploads/2022/11/BUNKER-SUPPLIERS-PROVIDING-COMPLIANT-FUELS-IN-FUJAIRAH.pdf) | HTML/PDF table | **Yes** (tel+email only) | **Done — 13 licensed + Sea Master (agent PDF tel/email); `fuels_supplied` on all; no address/contact person on Port bunker register** |
| P0 | **Singapore** (SGSIN) | [MPA bunkering service providers](https://www.mpa.gov.sg/port-marine-ops/marine-services/bunkering/bunkering-service-providers) | PDF (Jun 2026, 39 suppliers) | **Yes** (address + contact) | **Done — 39 licensed; register addresses geocoded at sync** |
| P1 | **Netherlands** (NLRTM) | [ILT marine fuel oil suppliers](https://english.ilent.nl/documents/shipping/sustainability-at-sea/publications/marine-fuel-suppliers-in-the-netherlands) | Web (Feb 2026) | **No** (company names only) | **Done — 35 ILT-registered suppliers (09 Feb 2026)** |
| P1 | **United Kingdom** | [Local fuel oil suppliers register (gov.uk)](https://www.gov.uk/government/publications/local-fuel-oil-suppliers-register) | CSV annual | **Yes** (address + tel; no email) | **Done — 53 MCA-registered local suppliers (2025–2026 list, Nov 2025)** |
| P1 | **New Zealand** (NZ) | [Trading Standards MARPOL Reg 18.9.1 register](https://fuelquality.tradingstandards.govt.nz/marine/register-of-marine-fuel-suppliers/) | Web | **Yes** (phone only; no email/address) | **Done — 62 port-level register rows, 8 companies (Jun 2026)** |
| P2 | **Antwerp-Bruges** (BEANR) | [Port licensed bunker companies PDFs](https://www.portofantwerpbruges.com/en/shipping/regulations-and-procedures/dangerous-goods/recognised-organisations-dangerous-goods) | PDF (Dec 2025) | **No** (address + email only) | **Done — 37 register rows (20 maritime + 4 inland + 13 lube oil); Zeebrugge list not online** |
| P2 | **Rotterdam** bunkering | Port of Rotterdam bunker directory + ILT | Web | Rare | Pending |
| P2 | **Gibraltar** (GIGIB) | Gibraltar Port Authority | Web | Sometimes | Pending |
| P2 | **Houston** (USHOU) | Port Houston + Texas petroleum licensing | Web | Varies | Pending |
| P2 | **Malta** (MTMLA) | Transport Malta | Web | Varies | Pending |
| P2 | **Piraeus** (GRPIR) | Piraeus Port Authority | Web | Varies | Pending |
| P2 | **Istanbul** (TRIST) | Turkish bunkering licence lists | Web | Varies | Pending |

### Secondary sources (Phase 2+)

| Source | Use for | Tier |
|--------|---------|------|
| OSM Overpass `phone=*`, `contact:phone=*` on `industrial=*`, `amenity=fuel` | Corroborate business phone | Community |
| Wikidata SPARQL | Official website, LEI link | Open |
| GLEIF API | Legal entity verification | Registry |
| Companies House UK API | UK company officers/address | Free gov |
| SEC EDGAR | US listed operator IR | Free gov |
| EU VIES | VAT validation | Free gov |
| Common Crawl | `/contact` page discovery | Free, heavy |

---

## Hub playbook (10 hubs first)

Execute in this order (highest deal density / best registers):

1. Singapore ✅ (MPA PDF — 39 licensed suppliers, Jun 2026)
2. Fujairah ✅ (complete official table)
3. Rotterdam + Antwerp (EU bunkering hub)
4. Gibraltar + Malta (Med bunkering)
5. Houston (US Gulf)
6. Piraeus + Istanbul (East Med)
7. UK national MARPOL register ✅ (MCA CSV — 53 suppliers, Nov 2025)
8. New Zealand ✅ (Trading Standards MARPOL Reg 18.9.1 — 62 port-level rows, 8 companies)

---

## Per-hub ingest workflow

```
1. Fetch official register (HTML table or PDF)
2. Transcribe: company_name, phone, email, website (if listed)
3. Append to data/bunker_fuel_suppliers_seed.json with:
   - register_source_url (exact page)
   - register_tier: official_port_register | official_regulator_register
   - confidence_score: 0.85+ if on official register with contact
4. Re-run sync: `POST /api/admin/bunker-fuel-suppliers/sync` (Go when `OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS=true`) or wait for worker cold step
5. Verify `GET /api/suppliers/nearby?locode=...` — check `geocode_tier` and distinct `lat`/`lng` for Singapore
6. Map: `NearbySuppliersMapLayer` markers + `NearbySuppliersPanel` list
7. Dossier: oil_company_contacts surfaces phone/email after sync
```

**Do not** add phones from Google Places, LinkedIn, or scraped directories without source attribution.

---

## Implementation todos

| ID | Task | Owner | Acceptance |
|----|------|-------|------------|
| `bunker-sg-mpa` | Transcribe MPA licensed bunker suppliers PDF (~39 cos) | Data | **Done** — 39 in seed; sync then `SGSIN` nearby ≥35 |
| `bunker-nl-ilt` | ILT marine fuel oil suppliers → seed | Data | **Done** — 35 in seed; sync then `NLRTM` nearby ≥30 |
| `bunker-uk-marpol` | UK local fuel oil suppliers CSV → seed | Data | **Done** — 53 in seed; sync then `GB` nearby ≥50 |
| `bunker-gib-malta` | Gibraltar + Malta port bunker lists | Data | Each hub ≥5 suppliers |
| `bunker-med-gr-tr` | Piraeus + Istanbul registers | Data | Each hub ≥5 suppliers |
| `bunker-nz-marpol` | NZ Trading Standards MARPOL Reg 18.9.1 → seed | Data | **Done** — 62 port-level rows in seed (8 companies); sync then `NZ` nearby ≥8 |
| `bunker-be-antwerp` | Port of Antwerp-Bruges licensed bunker PDFs → seed | Data | **Done** — 37 in seed; sync then `BEANR` nearby ≥25 |
| `bunker-us-hou` | Houston / US Gulf bunker dealers | Data | `USHOU` nearby ≥10 |
| `bunker-ingest-worker` | Optional: PDF/HTML parser worker (not manual JSON) | Eng | Parses MPA + Fujairah HTML automatically |
| `bunker-osm-corroborate` | Overpass phone tag match → boost confidence | Eng | +0.15 when OSM phone matches register |
| `bunker-map-deal-pack` | “Build deal pack” from nearby suppliers + storage | Product | Future sprint |

---

## Data quality rules

| Rule | Rationale |
|------|-----------|
| `register_tier=official_port_register` → confidence ≥ 0.85 | Port/regulator published the row |
| Phone/email only if on same official page as company name | No cross-source guessing |
| `terminal_operator` ≠ `bunker_supplier` | Vopak storage ≠ diesel seller |
| Re-sync quarterly | Licences expire (MPA reviews annually) |
| Store `source_accessed_at` in seed meta | Freshness disclaimer |

---

## Current seed status (2026-06-09)

| Hub | Suppliers in seed | Contacts (phone/email) |
|-----|-------------------|------------------------|
| Fujairah (AEFJR) | 14 | 13 with official tel+email from Port register |
| Singapore (SGSIN) | 39 | 39 with address + tel + email (MPA PDF Jun 2026) |
| United Kingdom (GB) | 53 | 53 with address + tel from MCA CSV; **no email on register** |
| Rotterdam (NLRTM) | 35 | 35 ILT-registered names only; **no phone/email/address on register** |
| New Zealand (NZ) | 62 | 62 port-level rows (8 companies); phone on register; **no email/address**; sync dedupes to 8 `oil_companies` |
| Antwerp-Bruges (BEANR) | 37 | 37 register rows (3 PDF lists); address + email on register; **no phone**; Zeebrugge not published online |
| Gibraltar, Houston, Malta, Piraeus, Istanbul | 0 (hub stubs) | — |

**After sync:** Pan to hub → `NearbySuppliersPanel` lists register-attributed suppliers; dossier contacts via `oil_company_contacts` where phone/email exist.

---

## Related map UX plan

This workstream complements the Map UX master plan commercial envelope:

- Pipeline/tank clicks → operator + capacity (GEM/OSM)
- Port bbox → **nearby bunker suppliers** (this plan)
- Dossier → GLEIF + registry + contact tier badges

Do **not** edit `map_ux_gap_audit_741b2063.plan.md`; this runbook is the bunkering expansion source of truth.
