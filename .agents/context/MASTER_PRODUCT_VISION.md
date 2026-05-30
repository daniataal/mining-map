# Master Product Vision — Global Commodity Intelligence and Transaction Platform

## What the platform is

This application is intended to become a global operating platform for commodity intelligence and, later, real commodity transaction execution.

It is not only a mining map, oil map, vessel tracking screen, supplier directory, due-diligence assistant, funding product or marketplace. These are connected components of one platform.

The long-term objective is to let a user or operating company:

1. Discover real commodity opportunities.
2. Understand the physical assets, supply chains and logistics behind them.
3. Verify suppliers, buyers, operators, vessels and infrastructure.
4. Structure and manage due diligence for a potential deal.
5. Potentially arrange approved transaction funding and insurance/risk controls.
6. Ultimately coordinate the purchase and sale of real commodities through properly controlled processes.

Real-money transactions are a future gated capability. They require legal, compliance, financial, sanctions, KYC/AML, payment, insurance and jurisdictional controls before any production implementation.

## Core product components

### 1. Global intelligence map

The map should eventually expose selectable layers for:

- Mines and mineral projects.
- Oil and gas fields.
- Refineries.
- Storage terminals and tank farms.
- Ports and export infrastructure.
- Maritime vessels and tanker movement.
- Trade flows and logistics routes.
- Importers, exporters, suppliers, buyers and operators.
- Relevant public filings, permits, ownership records and risk indicators.

A point on the map is not just a marker. It is an entry point into an entity dossier and potentially a commercial opportunity.

### 2. Entity and asset dossiers

Each mine, oil field, terminal, vessel, supplier, buyer, operator, owner or opportunity should be capable of opening a dossier containing:

- Raw original source data for human verification.
- Structured normalized fields.
- AI-generated summaries that clearly distinguish facts from inferences.
- Company relationships.
- Asset ownership and operation.
- Export/import or trading evidence where available.
- Vessel/terminal interactions where available.
- Source links, source dates, refresh status and reliability.
- Internal notes, workflow state, red flags and missing-evidence tasks.

The dossier system is the trust layer of the product.

### 3. Supplier and buyer network

The system should organize existing and potential suppliers and buyers, commodities, assets, geographic presence, evidence of activity, related ports/terminals/vessels, verification state and commercial workflow state.

Always distinguish:

- discovered from public evidence;
- verified as active;
- commercially contacted;
- approved counterparty;
- actual participant in a specific deal.

### 4. Marketplace and opportunity layer

The platform should eventually support structured commodity opportunities, for example:

- A supplier has commodity X, volume Y, at location Z.
- A buyer seeks commodity X, volume Y, under specified delivery terms.
- An operator uses the platform to validate, structure and manage the potential transaction.
- The platform tracks evidence, pricing assumptions, counterparties, terms, logistics, documentation and status.

Marketplace opportunities must be built on verification and evidence, not unverified user claims.

### 5. Deal structuring and execution layer

Longer term, the platform should assist with supplier and buyer verification, product specifications, quantity and availability, Incoterms, logistics feasibility, contract workflow, inspection requirements, payment structure, finance, risk review, compliance review, closing and audit trail.

No agent may imply that deals are ready to execute simply because intelligence data or counterparties appear in the UI.

### 6. Funding and insurance layers

Potential future finance or crowdfunding and insurance/risk capabilities may connect to opportunity workflows, but agents may currently design only safe architecture hooks and data models unless specifically approved.

Any real implementation must account for investor/financial regulation, KYC/AML, sanctions, flow of funds, custody/title transfer, risk disclosures, enforceable contracts, insurance conditions, licensed partners and jurisdictional restrictions.

## Current engineering priorities

Right now, prioritize the intelligence foundation:

1. Inspect and understand the existing application and active database.
2. Improve architecture and performance incrementally rather than rebuild blindly.
3. Build reliable, scalable global map layers.
4. Correctly ingest, normalize and expose assets, companies and vessel intelligence.
5. Preserve original data/evidence for human due diligence.
6. Build readable dossiers and supplier/buyer workflows.
7. Expose provider coverage, freshness and confidence truthfully.
8. Keep future marketplace and transaction needs in mind without prematurely building unsafe execution flows.

## Engineering principles

- Work in the existing repository and database first.
- Do not create disconnected prototypes without explicit approval.
- Do not assume diagnostic scripts are part of the application.
- Separate data ingestion, normalization, entity resolution, geospatial storage, API delivery and map rendering.
- A visible map filter must never silently replace global data ingestion.
- Missing provider data must not be shown as proof that no real-world entity or activity exists.
- Preserve raw source provenance and make inference/uncertainty visible.
- Design for global scale and human due-diligence usability.
- Explain how meaningful architecture decisions support the eventual intelligence-to-transaction platform.
