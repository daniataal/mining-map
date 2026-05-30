# Skill: Architecture and Performance Audit

## Objective
Assess correctness, scalability and efficiency of the implemented platform, then recommend an incremental architecture rather than a speculative rewrite.

## Audit areas

### Data and ingestion
- Provider adapter boundaries, scheduling/streaming patterns, retries and failure visibility.
- Raw-source retention, normalization, lineage, entity resolution, deduplication and refresh semantics.
- Separation of raw evidence from AI inference.

### Backend/database
- Actual schema, indexes, PostGIS usage, latest-position/entity queries, pagination, caching and API payload sizes.
- Query plans for heavy endpoints.
- Background worker concurrency, idempotency and recovery.

### Frontend/map
- Map library and rendering layer.
- Number of rendered entities and whether DOM markers are used for large layers.
- Fetch strategy: viewport, tile, layer, time window and caching.
- Dossier loading and state update behaviour.

### Infrastructure
- Compose topology, memory/CPU limits, database volumes/backups, logs/metrics, healthchecks and CI/CD.

## Measurement requirement
Before recommending major redesign, gather reproducible evidence: query timings/explain plans, payload sizes, map marker counts/render timings, worker throughput or container resource observations.

## Deliverables

Write:
- `agent_reports/01_architecture_audit.md`
- `agent_reports/03_performance_risk_register.md`
- `agent_reports/04_prioritized_execution_plan.md`

Each recommendation must include:
- Proven problem.
- Proposed change.
- Files/services affected.
- Migration and rollback approach.
- Acceptance test.
- Expected performance/correctness benefit.
- Risk and dependency.
