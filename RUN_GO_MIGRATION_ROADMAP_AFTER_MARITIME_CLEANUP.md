# Run After the Maritime Cleanup Feature Is Validated

Paste this into Antigravity only after the current duplicate maritime ingestion cleanup and truthful coverage UI work have been completed and reviewed:

```text
/gomigrationroadmap

The permanent backend architecture mandate is now Go. Produce a controlled, evidence-based roadmap to migrate all existing Python/FastAPI backend responsibilities into a Go backend architecture in phases.

Do not implement the migration yet. Inspect the real current repository, Compose topology, Python routes/services/workers, existing Go services, database models, frontend API dependencies and tests.

Prioritize:
1. maritime/vessel functionality already adjacent to the existing Go oil-live-intel service;
2. high-volume geospatial/map APIs;
3. ingestion/provider-health services;
4. oil, mining, supplier, dossier and future transaction domains.

Create `agent_reports/backend_go_migration_roadmap.md` with migration milestones, compatibility plan, testing/parity criteria, rollback and the smallest first approved migration candidate.
```
