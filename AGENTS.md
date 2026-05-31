# Meridian Commodity Intelligence Platform — Cursor Instructions

## Mission
This repository builds a global commodity intelligence platform: map layers for mining, oil/gas, terminals, vessels and trade infrastructure; evidence-backed dossiers for assets and counterparties; supplier/buyer workflow; and eventually gated real-commodity transaction workflows with legal/compliance/insurance/finance controls.

## Permanent backend direction
The long-term backend target is **Go**. Existing Python/FastAPI code and workers are transitional only.

- Prefer new permanent APIs, ingestion workers, provider adapters and high-throughput data services in Go.
- Do not create new permanent Python production subsystems.
- Migrate incrementally using parity tests, a single source of truth, cutover/rollback plans and explicit Python-removal criteria.
- Preserve existing database data and frontend API contracts unless a reviewed migration says otherwise.

## Verified maritime findings to re-check against the current branch
Previous inspection found:
- Existing production storage includes `oil_vessels`, `oil_ais_positions`, `oil_port_calls` and `maritime_source_health`.
- Tanker classification already exists where observations exist.
- The connected AIS source has effectively no Persian Gulf / Hormuz / Gulf of Oman observations; the UI must describe this as limited provider coverage, not no real traffic.
- Go `oil-live-intel-worker` writes durable live maritime data.
- Python `mining-maritime-worker` was retired; **oil-live-intel-worker** is the sole live AIS ingest path (Postgres + `maritime_source_health`).
- Safe retirement of the Python worker requires Go ownership of useful health/status and verification that no active UI consumer still requires the legacy snapshot.

## Always follow
1. Inspect git state, code paths, runtime services and actual database evidence before implementing.
2. Do not integrate standalone diagnostic scripts as production systems.
3. Do not add duplicate vessel tables, workers or provider pathways without explicit migration approval.
4. Do not delete data, drop tables, reset volumes, expose secrets or deploy without explicit approval and rollback.
5. Separate facts, inference, provider coverage, freshness and confidence.
6. Map filters query stored intelligence; they must not silently redefine global ingestion.
7. Every implementation must provide changed files, tests, validation evidence, limitations and rollback.

## Future transaction caution
The later marketplace/funding/insurance/deal-execution goal remains gated by KYC/AML, sanctions, payments, custody/title, licensing, insurance and jurisdictional controls. Never present it as ready solely because intelligence screens exist.
