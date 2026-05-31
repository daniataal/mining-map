# Antigravity Agent Team for the Commodity Intelligence Platform

This package configures an Antigravity team for the existing repository. It is not a new application scaffold.

## What this team is designed for

The target platform is a global commodity-intelligence operating system that may include:

- Global map layers for mines, oil fields, storage tanks, terminals, vessels and logistics infrastructure.
- Supplier, buyer, operator, owner and asset dossiers.
- Public/open-data ingestion and evidence-backed due diligence.
- Kanban/workflow management for opportunities and counterparties.
- AIS/vessel intelligence and coverage-truthfulness handling.
- A future transaction layer for structuring real commodity deals, with compliance, finance, insurance and operational controls.

Known implementation context supplied by the project owner:
- Existing application and existing UI must be preserved and improved.
- The project has been described as using a Python backend, TypeScript frontend and Docker Compose.
- The agent must verify the actual repository, active branch, database schema, containers and providers before relying on those assumptions.

## Installation

From the root of the real repository, first back up any existing agent configuration:

```bash
mkdir -p .agent-backup
[ -d .agents ] && cp -R .agents ".agent-backup/.agents.$(date +%Y%m%d-%H%M%S)"
```

Then copy the package contents into the repository root:

```bash
cp -R /path/to/commodity_platform_antigravity_team/.agents .
mkdir -p agent_reports
```

Do not blindly overwrite an existing `.agents` directory. Merge carefully if the project already has custom Antigravity workflows or skills.

## Start here

Read `START_HERE_NOW.md` first. The team now also includes `.agents/context/MASTER_PRODUCT_VISION.md`, which states the full intelligence-to-transaction product goal.

## First command to run in Antigravity

Run this before requesting new features:

```text
/auditplatform Inspect the existing repository, active branch, Docker Compose services, database, ingestion providers, frontend map, APIs, background workers, caches and existing vessel/commodity data. Do not implement major changes yet. Produce the factual baseline report and recommended prioritized fix plan.
```

The agent should write:

```text
agent_reports/00_platform_baseline.md
agent_reports/01_architecture_audit.md
agent_reports/02_database_and_data_coverage.md
agent_reports/03_performance_risk_register.md
agent_reports/04_prioritized_execution_plan.md
```

## Recommended operating sequence

1. `/auditplatform` — discover what already exists and identify bottlenecks.
2. Review the reports yourself.
3. `/debugissue <a concrete bug>` — fix one proven bug at a time.
4. `/implementfeature <approved feature>` — implement through backend, frontend, data and tests.
5. `/rearchitect <confirmed performance problem>` — redesign only after profiling and evidence.
6. `/vesselcoverage` — specifically inspect existing vessel/tanker storage, provider scope and Middle East coverage.

## Non-negotiable working principle

The agents must modify the existing application incrementally. They must not create disconnected proof-of-concept services or assume an external diagnostic script is part of the application. Before proposing a new provider, table, service or rewrite, they must show what exists and why it is insufficient.

## Safety and operational rule

Agents may inspect and run non-destructive commands. They must not delete data, reset databases, remove Docker volumes, deploy to production, modify DNS, rotate credentials, expose secrets, or perform destructive migrations without explicit human approval and a backup/rollback plan.
