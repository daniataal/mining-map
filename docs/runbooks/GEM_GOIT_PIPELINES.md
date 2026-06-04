# GEM GOIT pipelines — ingest and map verification

## Prerequisites

1. Workbook at repo root: `GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx` (or set `GEM_GOIT_PIPELINES_XLSX_PATH`).
2. Route GeoJSON: `./scripts/fetch_gem_goit_pipeline_routes.sh` → `data/gem/goit-pipeline-routes/data/individual-routes/liquid-pipelines/*.geojson` (~2k oil/NGL routes).

## Ingest

```bash
curl -X POST "http://localhost:8000/api/admin/gem-goit-pipelines/ingest" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Verify API

```bash
# Gulf viewport
curl -s "http://localhost:8000/api/petroleum/gem-pipelines?south=20&west=45&north=32&east=60" | jq '.feature_count,.limitations'

curl -s "http://localhost:8000/api/petroleum/gem-pipelines/coverage?south=20&west=45&north=32&east=60" | jq .
```

## Map (mining-viz)

1. Oil & Gas view, pan to a region with pipelines.
2. Layers: enable **Pipelines — GEM GOIT (CC BY)** (default on).
3. Click a line → popup should show Status, Capacity, Owner when present in spreadsheet.
4. Compare with OSM **Oil pipelines** / **Gas pipelines** toggles.

## Rollback

```sql
TRUNCATE gem_pipeline_segments;
```

Or set `GEM_GOIT_PIPELINES_AUTO_INGEST=false`.
