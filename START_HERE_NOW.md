# Execute This Now

## Your immediate objective

Do not begin by redesigning the product or integrating the standalone AISStream scripts.

First, establish what the real application currently contains, what data powers its map, what database tables already exist, and why worldwide or Middle East tanker data is or is not visible.

## Step 1 — Run baseline audit

In Antigravity, from the actual repository workspace, run:

```text
/auditplatform

Read `.agents/context/MASTER_PRODUCT_VISION.md`, `.agents/context/PLATFORM_VISION.md`, `.agents/context/KNOWN_FINDINGS_AND_CONSTRAINTS.md` and `.agents/agents.md`.

You are inside my existing commodity intelligence platform repository. Perform an inspection-only baseline audit before implementing major changes.

Inspect:
- active git branch and working-tree state;
- Docker Compose services and Dockerfiles;
- actual backend framework and routes;
- actual frontend framework, map library, state flow and API clients;
- actual database type, migrations and live tables;
- existing data ingestion/provider integrations;
- current oil, mining, terminals, vessel/AIS, supplier, dossier and due-diligence implementations;
- performance risks for global map scale.

Do not expose secrets. Do not delete/reset data. Do not add a new data provider. Do not integrate the external AISStream Python diagnostics.

Produce the required agent_reports files and end with:
1. what already exists;
2. what is actually connected and populated;
3. where the biggest correctness/performance problems are;
4. the smallest approved next implementation tasks.
```

## Step 2 — Run vessel-specific diagnosis after audit

Only after the baseline audit report exists, run:

```text
/vesselcoverage

Use the existing app database and existing app provider pipeline. Determine whether worldwide and Middle East vessel/tanker records already exist in storage, whether tanker classification exists, whether the frontend/API hides them, or whether the existing provider lacks that geographic data.

Return actual counts, table names, provider identity, timestamps, API/UI data flow and exact files requiring changes. Do not solve this by attaching standalone AISStream scripts unless you prove the application has no usable vessel source and request approval.
```

## Step 3 — Bring the reports back for decision

Do not approve a rebuild before reviewing:
- `agent_reports/00_platform_baseline.md`
- `agent_reports/01_architecture_audit.md`
- `agent_reports/02_database_and_data_coverage.md`
- `agent_reports/03_performance_risk_register.md`
- `agent_reports/04_prioritized_execution_plan.md`
- `agent_reports/vessel_coverage_diagnostic.md`

The decision after that evidence will be one of:
- fix existing API/frontend filtering;
- add tanker classification over existing stored vessel data;
- optimize existing map and database performance;
- expand/replace the existing vessel provider with an integrated provider adapter;
- implement a broader architectural migration in measured phases.
