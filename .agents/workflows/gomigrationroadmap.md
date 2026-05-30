---
description: Produce a controlled migration roadmap from the existing Python backend to the target Go backend architecture
---

When the user invokes `/gomigrationroadmap`:

1. Read:
   - `.agents/context/MASTER_PRODUCT_VISION.md`
   - `.agents/context/BACKEND_GO_MIGRATION_MANDATE.md`
   - `.agents/context/KNOWN_FINDINGS_AND_CONSTRAINTS.md`
   - `.agents/agents.md`
   - all existing relevant reports in `agent_reports/`.

2. Act as `@investigator` and `@architect`. Inspect the actual repository, active branch, Compose services, current Python backend, existing Go services, database models/migrations, API consumers, workers and runtime topology.

3. Perform an inventory of all Python backend responsibilities, including:
   - API routes and route families;
   - services/domain logic;
   - ingestion/background workers;
   - scheduled jobs;
   - database models and query code;
   - auth/security functionality;
   - Elasticsearch/Redis integrations;
   - external providers;
   - test coverage;
   - frontend API dependencies.

4. Inventory existing Go services and packages and identify what is already implemented or suitable as a migration destination.

5. Do not migrate code in this workflow. Produce a factual plan only.

6. Create `agent_reports/backend_go_migration_roadmap.md` containing:

   - executive summary;
   - current Python backend inventory;
   - current Go backend/service inventory;
   - domain-by-domain migration map;
   - recommended target Go package/service boundaries;
   - API compatibility/cutover strategy;
   - database and migration strategy;
   - worker/provider migration plan;
   - Docker Compose/runtime transition plan;
   - testing/parity strategy;
   - observability, rollback and data-safety requirements;
   - migration milestones ranked by risk and business value;
   - functions/code that must remain temporarily in Python and why;
   - explicit Python-removal milestones.

7. The roadmap must specifically assess:
   - maritime/vessel APIs and workers;
   - high-volume map/geospatial endpoints;
   - oil infrastructure/live intelligence;
   - mining/licenses;
   - suppliers/buyers/dossiers/DD;
   - search/indexing and cache dependencies;
   - future marketplace/transaction services.

8. End with a first approved migration candidate that is small, measurable, reversible and aligned with current business value.

No code modifications, migrations, destructive commands, deployments, provider purchases or runtime cutovers are allowed during this workflow.
