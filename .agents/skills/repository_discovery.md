# Skill: Repository and Database Discovery

## Trigger
Use this for any request involving an existing feature, missing data, a bug, redesign, integration or uncertainty about the current application.

## Required process

1. Read `.agents/context/PLATFORM_VISION.md` and `.agents/context/KNOWN_FINDINGS_AND_CONSTRAINTS.md`.
2. Record current git branch, status and top-level repository structure.
3. Locate backend, frontend, Docker/Compose, migrations, database configuration names, APIs, jobs/workers, caches and provider integrations.
4. Search for relevant domain terms: `vessel`, `ais`, `tanker`, `mmsi`, `imo`, `mine`, `oil`, `terminal`, `supplier`, `dossier`, `map`, `geojson`, `postgis`, `provider`, `ingestion`.
5. Inspect active storage non-destructively. Never assume table names; first discover them.
6. Trace the requested UI behaviour backwards: component -> API call -> backend handler -> query/service -> table/provider/cache.
7. Write a baseline report with findings, not guesses.

## Required output format

Save `agent_reports/00_platform_baseline.md` containing:

- Current branch and working-tree state.
- Runtime/container inventory.
- Actual backend/frontend frameworks.
- Database type, container/service and vessel/domain tables discovered.
- Existing data providers and ingestion mechanisms.
- Current map data path.
- Counts/freshness/coverage relevant to the request.
- Root-cause hypotheses ranked by evidence.
- Exact next changes proposed, blocked until investigation is complete.

## Guardrails
Do not add a new table, provider, service, frontend layer or redesign until the baseline identifies why the existing pathway cannot satisfy the requirement.
