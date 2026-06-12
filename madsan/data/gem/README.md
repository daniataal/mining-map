# GEM tracker workbooks (MadSan standalone)

Place Global Energy Monitor `.xlsx` trackers here for `legacy-tier2` / `RunGEMImport`:

| File | Tracker |
|------|---------|
| `Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx` | `gem_extraction` |
| `Global-Oil-and-Gas-Plant-Tracker-GOGPT-January-2026.xlsx` | `gem_plants` |
| `GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx` | `gem_pipelines` |

Download from [Global Energy Monitor](https://globalenergymonitor.org/). Files are not committed (large binaries).

Auto-detect order: `madsan/data/gem/` → monorepo repo root (transitional fallback).

```bash
cd madsan/backend
# Dry-run row counts
go run ./cmd/legacy-tier2 --tables gem_extraction,gem_plants,gem_pipelines --dry-run
# Import pipelines + geometry from legacy mining-db
go run ./cmd/legacy-tier2 --tables gem_pipelines --gem-segments
```

**Pipeline dossiers (GEM GOIT):** The legacy app showed rich pipeline data from GEM (fuel, status, owner, capacity) — not OSM tags alone. MadSan imports:

1. xlsx → `assets` (`legacy_table = gem_goit_pipelines`)
2. legacy `gem_pipeline_segments` → `pipeline_graph_edges` (`osm_id = gem:{segment_key}`)

Scheduled job: `gem_pipeline_import` (weekly). Requires `LEGACY_DATABASE_URL` with populated `gem_pipeline_segments` (see `scripts/fetch_gem_goit_pipeline_routes.sh` if missing).
