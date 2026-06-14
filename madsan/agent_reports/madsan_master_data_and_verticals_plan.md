# MadSan Master Data And Verticals Plan

## Purpose

This is the full plan. It is wider than the Cursor UI handoff.

MadSan should become a multi-vertical commodity intelligence platform, but the first paid workflow remains oil/gas/LNG opportunity origination.

The product target is:

`real entity + real asset + real owner/control + physical route + vessel/cargo clue + buyer/supplier candidate + market pressure + price context + risk/confidence`

## Product Verticals

### V1: Oil, Gas, LNG

This is the first commercial product surface.

It includes:

- Oil/gas extraction assets.
- Oil/NGL pipelines.
- Gas pipelines.
- LNG export/import terminals.
- LNG carriers.
- Refineries.
- Petroleum terminals and storage.
- Tankers and cargo estimates.
- STS predictions.
- Buyers/importers.
- Supplier/replacement opportunities.
- Investor/control chains.
- Market pressure and price context.

### V2: Mines And Industrial

This is not ignored. It is stored and structured now where possible, but it should not pollute the V1 oil/gas/LNG workflow.

It includes:

- Coal mines.
- Coal terminals.
- Iron ore mines.
- Steel plants.
- Cement plants.
- Chemicals and other industrial fossil-linked assets.
- Mine-to-terminal-to-steel chains.
- Coal mine production and coal terminal export intelligence.

Coal terminals belong to the mines/industrial section, not the oil opportunity surface.

### V3: Power And Demand

This connects fuel sellers to demand assets.

It includes:

- Gas power plants.
- Oil/diesel/fuel-oil power plants.
- Utility buyers.
- Investor-backed power demand.
- LNG/gas buyer replacement opportunities.

Power plants can become buyer-side intelligence for oil/gas/LNG when the fuel is gas, diesel, fuel oil, LPG, or LNG.

### V4: Broader Energy And Transition

This is later.

It includes:

- Renewables.
- Batteries.
- Hydrogen.
- Transmission.
- Transition-risk and investor exposure analysis.

These should be stored separately from oil/gas/LNG V1.

## Raw Data Policy

Raw large datasets do not go into git.

Use:

- `madsan/data/gem/`
- `madsan/data/jodi/`
- `madsan/data/eia/`
- `madsan/data/world_bank/`
- `madsan/data/comtrade/`
- `madsan/data/eurostat/`
- `madsan/data/osm/`
- `madsan/data/sanctions/`
- `madsan/data/assays/`
- `madsan/data/transport_costs/`

Git should keep only:

- `.gitkeep`
- README files
- source manifests
- tiny fixtures for tests

Every imported file should be recorded in `data_source_releases` with:

- source key
- path
- checksum
- row count
- source version/release date
- imported timestamp
- attribution
- license
- commercial-use flag
- import status

## Permanent Ingestion Direction

Permanent ingestion should be Go-first.

Python diagnostic scripts can exist temporarily for exploration, but not as new production systems.

Each adapter should:

- scan source files
- checksum source files
- register source release
- import into normalized tables
- be idempotent
- preserve raw source payload
- label evidence
- route records to the correct vertical

## GEM Dataset Routing

### Oil/Gas/LNG Surface

Route these into V1 oil/gas/LNG:

- Global Oil and Gas Extraction Tracker.
- Global Oil Infrastructure Tracker.
- Global Gas Infrastructure Tracker.
- Global LNG Terminal Tracker.
- Global LNG Carrier Tracker.
- Global Oil and Gas Plant Tracker where assets are oil/gas/refinery/LNG relevant.
- GEM ownership tracker.
- GEM gas finance.
- PECR fossil assets when exposed asset is oil/gas/LNG, pipeline, terminal, refinery, gas plant, or power-demand asset.

### Mines/Industrial Surface

Route these into mines/industrial, not the V1 oil surface:

- Global Coal Mine Tracker.
- Global Coal Terminals Tracker.
- Iron ore and steel datasets.
- Cement datasets.
- Chemicals and other industrial datasets.

### Cross-Vertical Control Layer

Some GEM records should cross verticals through the graph, not through the oil UI.

Examples:

- Investor owns gas terminal and coal terminal.
- Parent company operates oil field and steel plant.
- PE fund backs LNG terminal and gas power plant.
- Coal terminal connects to mine/steel workflow later.

These relationships belong in the entity/control graph and investor exposure views.

## Core Normalized Tables

Already planned or partially implemented:

- `data_source_releases`
- `gem_entities`
- `gem_ownership_edges`
- `gem_asset_ownership`
- `asset_production_facts`
- `asset_reserve_facts`
- `asset_emissions_facts`
- `private_equity_exposures`
- `market_balance_observations`
- `market_pressure_scores`
- `market_price_observations`
- `trade_flow_facts`
- `cargo_estimates`
- `asset_geometries`
- `opportunity_candidates`
- `opportunity_chain_segments`
- `opportunity_investor_path_snapshots`

Reuse existing:

- `assets`
- `companies`
- `contacts`
- `relationships`
- `pipeline_graph_edges`
- `vessels`
- `vessel_enrichment`
- `ais_positions`
- `port_call_visits`
- `voyages`
- `core_signals`
- `predictive_signals`

## Vertical Routing Fields

Every imported asset should have enough metadata to route it.

Add or preserve:

- `asset_type`
- `commodities_supported`
- `raw_source_payload`
- source key/release id
- country
- operator/owner/parent where available
- geometry reference
- evidence label
- commercial-use flag

Recommended logical vertical labels:

- `oil_gas_lng`
- `mines`
- `coal`
- `steel`
- `cement`
- `power`
- `transport`
- `finance`
- `transition`

V1 APIs should filter to `oil_gas_lng` plus fuel-demand power assets only.

## Geometry Strategy

Do not serve raw GeoJSON/GPKG files from the app.

Import into PostGIS:

- points
- polygons
- lines
- route geometries
- simplified geometries

Use:

- GiST indexes
- bbox filters
- simplification for map serving
- precomputed chain segments

Map views should receive:

- bbox-filtered features
- simplified geometries
- selected-chain overlays
- never entire raw dataset dumps

## Missing Or Incomplete Data Adapters

Still needed for the full plan:

- EIA company-level imports.
- EIA crude quality / crude input quality where available.
- DOE crude oil assays.
- World Bank Pink Sheet benchmark prices.
- UN Comtrade product/corridor flows.
- Eurostat energy/trade flows.
- TED procurement.
- USAspending procurement.
- GLEIF legal entity IDs.
- SEC EDGAR entity enrichment.
- Official sanctions lists.
- OSM pipeline/terminal substance tags and infrastructure context.
- UNCTAD/OECD CIF-FOB or transport-cost references.
- JODI Gas when usable.

JODI Oil is the active foundation. JODI Gas stays deferred until a usable dataset is available.

## Implementation Matrix

This matrix separates what is already built from what is only planned.

### Implemented Or Partially Implemented

- Opportunity APIs:
  - `/api/intel/opportunities`
  - `/api/intel/cargo-movements`
  - `/api/intel/arbitrage`
  - `/api/intel/market-pressure`
  - `/api/intel/sts-predictions`
  - `/api/intel/entities/{type}/{id}/commercial-profile`
  - `/api/intel/investor-paths`
- JODI Oil market pressure foundation.
- GEM oil/gas/LNG foundation.
- Market benchmark price context.
- Cargo estimates from AIS/draft/DWT logic.
- Vessel owner/operator enrichment.
- Company/contact bundles from normalized contacts and raw payloads.
- Investor path snapshots.
- Opportunity candidates.
- Full dossier routes.
- Map popup and dossier separation.
- First opportunity originator right rail.

### Planned But Not Fully Built

- EIA company-level imports as full buyer/importer history.
- UN Comtrade and Eurostat corridor flow adapters.
- DOE crude assays and EIA crude quality adapters.
- UNCTAD/OECD transport cost adapter.
- GLEIF, SEC EDGAR, and sanctions enrichment.
- Freight cost curves.
- Quality/refining adjustment curves.
- Landed margin snapshots.
- Full supplier graph.
- Full buyer discovery graph.
- Tank/pipeline product inference.
- Repeat vessel-terminal-country-product pattern detection.
- Commercial STS rebuild.
- Open-to-STS vessel leads.
- Cargo/voyage chain engine.
- Coal/mine/industrial vertical routing.

### Not In V1 Product Surface

These are stored or routed later, but should not appear as oil/gas/LNG opportunities unless they connect to fuel demand or investor exposure:

- Coal mines.
- Coal terminals.
- Iron ore mines.
- Steel plants.
- Cement plants.
- Chemicals and other industrial datasets.
- Renewables and transition assets.

## Opportunity Engines

### Oil/Gas/LNG Opportunity Engine

Output:

`supplier + buyer + asset + owner + route + vessel/cargo clue + market pressure + price context + confidence`

Core algorithms:

- Supplier Reality Score.
- Buyer Reality Score.
- Market Pressure Score.
- Route Feasibility Score.
- Cargo Quantity Estimate.
- Product Family Inference.
- Price Context Score.
- Investor Control Score.
- Risk Discount.
- Commercial STS Prediction.
- Open-To-STS Vessel Lead Score.

### Investor Control Engine

Output:

`investor -> parent -> portfolio company -> asset -> pipeline/terminal -> vessel/cargo -> buyer -> spread`

This is the strongest differentiator.

It should use:

- GEM ownership.
- PECR fossil assets.
- private equity exposures.
- company contacts.
- asset ownership.
- vessel owner/operator.
- buyer/importer records.
- price and pressure context.

### Cargo/Voyage Chain Engine

Output:

`vessel -> owner/operator -> cargo estimate -> latest AIS destination -> likely buyer assets/importers -> market pressure -> benchmark context`

This is the next backend priority after dossier UX.

### STS Intelligence Engine

STS should be three separate products, not one generic layer.

#### 1. STS Event Detection

Output:

`two vessels likely performed an STS transfer`

Evidence:

- vessel proximity
- low speed
- parallel or co-located track
- duration at close range
- known STS zone or offshore anchorage
- draft decrease/increase pattern when available
- AIS navigation status changes

User label:

- `completed-sts`
- `active-sts`

#### 2. Commercial STS Prediction

Output:

`these vessels may perform STS soon, and here is the commercial reason`

Evidence:

- route convergence
- compatible vessel/product class
- supplier-linked vessel
- buyer-linked vessel
- cargo/draft clue
- known STS zone
- historical STS behavior
- owner/operator/investor link
- market pressure or price spread reason
- risk context

User label:

- `likely-sts-soon`
- `watch-window-6h`
- `watch-window-24h`
- `watch-window-48h`

#### 3. Open-To-STS Vessel Leads

Output:

`this vessel may be commercially open, waiting for orders, or ready for an STS deal`

This is a broker-facing lead product.

Evidence from AISStream and stored AIS:

- AIS destination keywords:
  - `FOR ORDERS`
  - `WAITING ORDERS`
  - `OPL`
  - `STS`
  - `OFFSHORE`
- tanker class or LNG/LPG carrier class
- loitering outside port limits
- anchored or moored for sustained period
- restricted maneuverability at sea
- low speed or drifting in known STS/open-water zones
- no assigned terminal call
- ballast or partial draft clue
- previous STS behavior
- owner/operator/contact is known

User label:

- `open-to-sts`
- `waiting-for-orders`
- `position-open`
- `sts-capable-watch`

Open-to-STS leads should not claim a buyer or cargo owner is confirmed. They should say what is observed, what is inferred, and what must be verified.

Recommended future API:

- `GET /api/intel/sts-open-vessels`

Recommended future table:

- `sts_open_vessel_leads`

Core fields:

- vessel id, MMSI, IMO, name
- vessel class
- current zone
- latest AIS destination
- navigation status
- loitering duration
- draft trend
- likely product family
- owner/operator/manager
- contacts/source refs
- last loading terminal or likely origin
- likely cargo owner/supplier candidate
- likely buyer/import destination candidate
- market/price reason
- risk flags
- confidence score
- evidence labels
- generated_at / expires_at

### Cargo Owner And Contact Inference

MadSan cannot confirm cargo title from AIS alone. It can generate a ranked contact/investigation path:

`last loading terminal -> terminal operator -> likely supplier/shipper -> vessel commercial manager -> chartering/contact desk -> buyer/import candidate`

Evidence sources:

- port-call/geofence load event
- terminal/operator ownership
- berth/terminal product capability
- cargo estimate
- AIS destination
- EIA/importer or trade-flow records
- company contacts
- vessel owner/operator contacts
- source URLs and registry checks

User wording:

- `likely cargo controller`
- `likely supplier`
- `commercial manager to verify`
- `buyer candidate`
- never `confirmed cargo owner` unless there is source-backed title/import evidence

### Mines/Industrial Chain Engine

Later output:

`mine -> owner/operator -> terminal -> vessel/rail/port -> steel/power/industrial buyer -> price/risk context`

Coal and mine data belongs here.

## UI Strategy

### Map Popup

Fast truth card only.

Shows:

- name
- type
- confidence
- evidence tier
- action to inspect rail
- action to open dossier

### Right Rail

Working investigation surface.

Shows:

- active opportunities
- selected chain
- cargo clue
- buyer/supplier candidates
- STS signals
- investor/control path
- contacts and evidence
- risk notes

### Full Dossier

Deep due diligence route.

Tabs should converge toward:

- Chain
- Cargo
- Buyers
- Suppliers
- Ownership
- Contacts
- Market
- Risk

Full dossier should use `/api/intel/entities/{type}/{id}/commercial-profile`, not broad client-side scans.

### STS UX

The STS surface should include tabs or filters:

- `Open vessels`
- `Predicted STS`
- `Active STS`
- `Completed STS`
- `Risk`

Each STS card should show:

- vessel pair or single open vessel
- status label
- predicted or observed window
- zone
- product family
- cargo quantity range if available
- draft/load clue
- supplier-side evidence
- buyer-side evidence
- owner/operator/manager
- contacts/source refs
- market/price reason
- risk flags
- confidence score
- evidence chain

Actions:

- `Open vessel dossier`
- `Show chain`
- `Verify owner`
- `Compare margin`
- `Watch vessel`
- `Watch zone`
- `Export lead` for enterprise only

## Monetization

Free:

- basic map layers
- limited public dossiers
- limited market pressure preview

Pro:

- opportunity scores
- cargo movement feed
- supplier/buyer graph paths
- commercial STS predictions
- price context
- contactability/source refs

Enterprise:

- API access
- bulk exports
- watchlists
- route/country/product alerts
- investor exposure reports
- custom monitoring

## Current Reality

Implemented or partially implemented:

- GEM/JODI/oil opportunity foundation.
- Opportunity APIs.
- Market pressure API.
- Cargo movement API.
- Commercial profile API.
- Investor path snapshots.
- Vessel dossier cargo/contact/ownership surface.
- Map popup and dossier route.
- First right-rail opportunity originator.
- STS prediction API surface and predictive signal storage.

Still incomplete:

- Full GEM vertical routing for coal/mines/industrial.
- All missing external adapters listed above.
- Commercial STS rebuild.
- Open-to-STS vessel leads.
- STS UX split into open, predicted, active, completed, and risk.
- Cargo/voyage chain engine.
- Tank/pipeline contents inference.
- Full landed-margin engine.
- Better dossier tabs and chain map overlays.

## Immediate Next Order

1. Let Cursor improve dossier tabs/UX from `linked_intel`.
2. Codex reviews Cursor changes.
3. Codex implements cargo/voyage chain engine.
4. Codex implements `sts_open_vessel_leads` from AIS status, destination keywords, loitering, draft, zone, and owner/contact evidence.
5. Codex rebuilds commercial STS on top of cargo/voyage/owner/buyer/open-vessel logic.
6. Implement selected-chain map overlays.
7. Add tank/pipeline contents inference.
8. Add missing source adapters in priority order:
   - EIA company imports.
   - World Bank prices.
   - GLEIF/SEC/sanctions.
   - UN Comtrade/Eurostat.
   - DOE assays.
   - UNCTAD/OECD transport costs.
9. Implement GEM vertical routing for mines/coal/industrial.
