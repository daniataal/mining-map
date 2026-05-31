# Uncommitted Maritime Changes Review

## 1. Context and Objective
This report reviews the uncommitted maritime code changes found in the working tree prior to adding any new Middle East data providers. The objective is to determine if these pending changes align with the existing platform architecture, whether they safely extend capabilities, or if they introduce redundant parallel systems.

## 2. Review of the Ingestion Pipeline & Database Migration
### The Problem: Parallel Redundant Ingestion
The working tree contains a massive new Python service (`backend/services/ais_tanker_ingestion.py`) and an accompanying SQL migration (`020_ais_tanker_ingestion.sql`). 

These files introduce the following new tables:
- `vessel_identity`
- `vessel_positions`
- `vessel_type_history`
- `provider_coverage_metrics`

**Architectural Conflict:**
This completely duplicates and ignores the existing, proven production pipeline. The database already contains heavily populated tables for maritime data:
- `oil_vessels` (7,500+ rows) - duplicates `vessel_identity`
- `oil_ais_positions` (1.2M+ rows) - duplicates `vessel_positions`
- `maritime_source_health` - duplicates `provider_coverage_metrics`

Furthermore, the existing production system uses a highly performant **Go service** (`oil-live-intel/internal/workers/ais_ingestor.go`) to handle the AISStream ingestion. Replacing or bypassing it with a parallel Python worker violates the core mandate to "evolve existing architecture over creating parallel services." 

**Conclusion:** The Python ingestion code and its SQL migration are harmful parallel prototypes and must be discarded.

## 3. Review of the Frontend & API Changes
### The Value: Coverage Warnings & Tanker Views
The frontend changes in `mining-viz/src/...` are highly valuable. They introduce:
- `MaritimeTankerView` types (e.g., `middle_east`, `persian_gulf`).
- A dedicated coverage status display indicating if a region has `coverage_warning` or is `limited_terrestrial_ais`.
- Visual fields in dossiers for `provider`, `coverage_confidence`, and `region_tags`.

This UI work perfectly aligns with the earlier diagnostic recommendation to "present a truthful UI coverage/status banner" for the Middle East gap. 

However, `backend/main.py` appears to have added API routes that query the redundant `vessel_positions` tables. These API endpoints should either be discarded, or rebuilt within the existing Go `oil-live-intel` service to query the correct `oil_ais_positions` and `maritime_source_health` tables.

## 4. Documentation and Tests
- `docs/DATA_SOURCES.md` and `docs/LIVE_DATA.md` contain helpful updates regarding the new views and coverage warnings.
- `backend/tests/test_vessel_ais.py` tests the redundant Python ingestion service and should be discarded alongside it.

---

## Final Categorization

### KEEP_AND_COMPLETE
These files contain valuable frontend UI work, types, and documentation for rendering coverage gaps and region-specific views. They should be kept, but their API dependencies must be repointed to the existing Go backend.
- `mining-viz/src/components/MapComponent.tsx`
- `mining-viz/src/components/OilMaritimePanel.tsx`
- `mining-viz/src/components/vessels/fieldDisplay.ts`
- `mining-viz/src/lib/vessels/types.ts`
- `mining-viz/src/lib/vessels/useVessels.ts`
- `mining-viz/src/types/index.ts`
- `docs/DATA_SOURCES.md`
- `docs/LIVE_DATA.md`
- `README.md`

### DISCARD_OR_REVERT
These files introduce a redundant, parallel Python ingestion pipeline that ignores the existing Go workers and `oil_ais_positions` tables.
- `backend/services/ais_tanker_ingestion.py`
- `oil-live-intel/migrations/020_ais_tanker_ingestion.sql`
- `backend/maritime_worker.py`
- `backend/tests/test_vessel_ais.py`

### REQUIRES_DECISION_BEFORE_IMPLEMENTATION
These files contain mixed changes. The API routes in `main.py` need to be evaluated to see if they should be ported to Go. The Docker compose files need review to ensure no parallel worker containers are mistakenly deployed.
- `backend/main.py`
- `docker-compose.yml`
- `docker-compose.prod.yml`
