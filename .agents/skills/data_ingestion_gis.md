# Skill: Data Ingestion, GIS and Entity Resolution

## Objective
Make public/live data useful, auditable and performant inside the existing data architecture.

## Procedure

1. Inventory existing source integrations, database schema and scheduled/stream workers.
2. Verify source license/access terms, fields, refresh frequency, geography and failure behaviour before recommending it.
3. Preserve raw source payloads or source references sufficient for human DD.
4. Normalize entities with durable identifiers where possible and maintain source-specific identifiers.
5. Store geographic coordinates/geometry using existing geospatial conventions and create region/asset relationships as derived, traceable data.
6. Track provider health, last-success timestamp, coverage gaps and retries.
7. Implement entity resolution conservatively: uncertain matches remain uncertain.

## Vessel-specific rule

Do not treat an external AIS diagnostic script as the application's current source. First locate the app's own vessel data path. When AIS data is used, distinguish:
- vessel position observation,
- identity/static classification,
- tanker inference/classification,
- terminal visit inference,
- provider coverage quality,
- external verification evidence.

## Output
For a new or changed provider, create a report documenting source, fields, ingestion method, limits, cost/access assumptions, lineage, refresh, geographic coverage and failure handling.
