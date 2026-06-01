# Backend Go Migration Mandate

## Permanent architectural requirement

The long-term target architecture for this commodity intelligence platform is a Go-based backend.

The current repository may contain Python/FastAPI backend code and Python workers because they are part of the historical or transitional implementation. They may continue to run temporarily while capabilities are migrated safely, but they are not the desired final backend architecture.

The strategic requirement is:

```text
Migrate the entire backend capability toward Go in controlled phases.
Do not expand Python into new permanent production subsystems.
```

## What this means for all future work

Before implementing any backend feature, determine:

1. Does an equivalent Go service, handler, worker or domain package already exist?
2. Can the feature be added to the Go backend instead of Python?
3. If existing Python code must be modified temporarily, what is the bounded migration path to Go?
4. Does the change introduce new Python technical debt or reduce it?
5. Can the work be performed as part of a safe Go migration milestone?

## Mandatory engineering rules

- New production APIs should be implemented in Go wherever technically feasible.
- New long-running ingestion workers should be implemented in Go wherever technically feasible.
- New domain services, provider adapters, geospatial query layers and performance-critical pipelines should target Go.
- Python must not become the permanent location for maritime, oil, mining, supplier, dossier, search, marketplace or transaction backend logic.
- Existing Python functionality must not be deleted blindly. Inventory it, test it, migrate it incrementally and remove it only after the Go replacement is validated.
- Maintain frontend API compatibility or provide a deliberate compatibility/cutover strategy.
- Preserve existing database data and schema safely.
- Do not rewrite the full backend in one unbounded operation.
- Do not run duplicate Go and Python production pipelines without a temporary cutover plan, source-of-truth rule and cleanup milestone.
- Any temporary Python bridge requires an explicit `TEMPORARY_PYTHON_BRIDGE` note in the implementation report, including removal criteria and intended Go replacement.

## Migration principle: strangler pattern

```text
Inventory current Python backend responsibilities
        ↓
Map data models, APIs, jobs and dependencies
        ↓
Define stable Go domain boundaries and compatibility contracts
        ↓
Prioritize performance-critical and actively changing domains
        ↓
Implement equivalent Go modules against existing storage
        ↓
Run parity tests and controlled validation
        ↓
Route traffic/jobs to Go
        ↓
Remove superseded Python only after proof and rollback readiness
```

## Current likely migration priority order

The architect must confirm this from the real codebase, but the current direction is:

1. Maritime/vessel intelligence, because an existing Go production path already exists under `oil-live-intel`.
2. High-volume geospatial and map-serving APIs needed for global map performance.
3. Provider ingestion adapters and provider-health/coverage reporting.
4. Oil terminal, storage and trade-intelligence APIs.
5. Mining, licenses and mineral-asset geospatial APIs.
6. Supplier, buyer, dossier and due-diligence APIs.
7. Future marketplace, opportunity and controlled transaction workflow services.

## Immediate maritime impact

For the pending maritime work:

- Discard the duplicate Python AIS ingestion prototype.
- Do not create replacement permanent Python maritime endpoints or workers.
- Keep useful React UI coverage-warning and tanker-view changes.
- Implement required maritime coverage/status APIs in the existing Go `oil-live-intel` pathway using existing production tables.
- Treat this as the first practical implementation aligned with backend migration to Go.

## Required roadmap deliverable

After maritime cleanup is validated, produce:

```text
agent_reports/backend_go_migration_roadmap.md
```

The roadmap must inventory all existing Python backend routes, services, workers and dependencies, then map each responsibility to a future Go package/service, migration order, compatibility risks, tests, Docker Compose changes, database impacts, cutover sequence and rollback plan.

No full backend rewrite may begin before human review and approval of that roadmap.
