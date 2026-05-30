# Platform Vision and Product Context

## Mission

Build a professional, evidence-driven commodity intelligence platform that helps users find assets, understand supply chains, perform human and AI-assisted due diligence, discover credible buyers/suppliers/operators and eventually support real-world commodity transactions.

## Intended product surfaces

### Intelligence map
A high-performance global map with selectively enabled layers, including where available:
- Mines and mineral assets.
- Oil and gas fields.
- Terminals, refineries, storage tanks and logistics infrastructure.
- Maritime vessel activity and tanker movements.
- Export/import, trade-flow and public registry data.
- Geographic risk, terminal visits and routes.

### Dossiers and workflow
Each asset/company/vessel/opportunity should be capable of opening a dossier with:
- Raw-source evidence, preserving the original data for human due diligence.
- Structured AI summaries that clearly distinguish facts, inferences and missing information.
- Ownership/operator/buyer/supplier relationships.
- Source dates, links, confidence, data lineage and refresh status.
- Kanban/workflow tracking, notes and future enrichment tasks.

### Commercial direction
Longer-term, the owner envisions connecting intelligence to real trade execution: suppliers, buyers, transaction structuring, funding/finance, insurance and operational execution. This is strategically relevant, but implementation must respect legal, KYC/AML, sanctions, licensing, insurance, custody, payments and jurisdictional requirements. No agent may imply that live commodity trading is ready merely because a map or matching UI exists.

## Known technical context to verify

The owner has described:
- Python backend container.
- TypeScript frontend container.
- Docker Compose deployment.
- Existing map UI and existing supplier/dossier structure.
- Multiple LLM connections for due diligence.

These are context, not proof. Inspect actual repository structure and runtime configuration before making architectural decisions.

## Priorities

1. Truthful, sourced data and coverage visibility.
2. Fast map interaction at global scale.
3. Reusable entity/dossier model across oil, mining, vessels and counterparties.
4. Clear separation between raw evidence, enriched data, AI inference and user-authored notes.
5. Reliable incremental engineering with tests, migrations and rollback paths.
6. Modular providers so one unstable source cannot break the platform.

## Architecture principle

Do not couple the UI viewport to global ingestion. Data ingestion, normalization, entity resolution, geospatial storage, API delivery and map rendering are separate layers. User-selected views should query/filter data, not accidentally replace the collection strategy.
