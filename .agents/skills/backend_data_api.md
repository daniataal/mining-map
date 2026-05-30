# Skill: Backend and API Implementation

## Objective
Modify the existing Python backend safely and consistently with its discovered framework.

## Procedure

1. Read baseline and approved architecture reports.
2. Inspect current route/model/service/migration conventions before writing files.
3. Define or update API contract first: inputs, outputs, pagination, filters, errors and provenance.
4. Use existing database/session/ORM conventions. Use migrations for schema changes.
5. For geospatial data, use existing PostGIS approach where present; otherwise propose the migration and evidence for it before imposing it.
6. Keep provider-specific logic behind adapters/services, not UI-facing endpoints.
7. Add tests for query logic, filters, data validation and failure modes.
8. Document touched endpoints and migration/runtime commands in the handoff.

## Critical domain rules

- A map region filter must query stored data; it must not silently redefine global ingestion.
- Raw data, enriched fields and AI inference must be distinguishable.
- Never return “no activity” where the real status is “no recent data coverage.”
- Preserve identifiers and source timestamps needed for dossiers and audits.
