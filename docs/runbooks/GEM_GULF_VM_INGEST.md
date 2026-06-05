# Gulf / MENA VM ingest verification

Postgres is truth; xlsx and GeoJSON on disk are backups only.

## 1. Place GEM files

```bash
mkdir -p /data/meridian/gem
# Extraction, GOIT, GOGPT, GGIT workbooks
export GEM_TRACKER_XLSX_PATH=/data/meridian/gem/Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx
export GEM_GOIT_PIPELINES_XLSX_PATH=/data/meridian/gem/GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx
export GEM_GOIT_ROUTES_DIR=/data/meridian/gem/goit-pipeline-routes/data/individual-routes/liquid-pipelines
export GEM_GOGPT_XLSX_PATH=/data/meridian/gem/Global-Oil-and-Gas-Plant-Tracker-GOGPT-January-2026.xlsx
export GEM_GGIT_XLSX_PATH=/data/meridian/gem/Global-Gas-Infrastructure-Tracker-GGIT-September-2025.xlsx
```

Rebuild backend after env changes: `docker compose up -d --build backend`

## 2. Admin ingest order

1. `POST /api/admin/gem-extraction-tracker/ingest`
2. `POST /api/admin/gem-goit-pipelines/ingest`
3. `POST /api/admin/gem-gogpt-plants/ingest`
4. `POST /api/admin/gem-ggit-lng/ingest`

Or one shot: `POST /api/admin/oil-live/graph-sync` (includes auto-ingest when `GEM_*_AUTO_INGEST=true`).

## 3. OSM petroleum (Gulf tiles)

Ensure `petroleum-osm-worker` / graph-sync runs MENA gap queue (`mena` in gap list per `docs/DATA_SOURCES.md`).

```sql
SELECT layer_id, COUNT(*) FROM petroleum_osm_features GROUP BY 1;
```

## 4. Storage + port tenants

```bash
# graph-sync storage_terminals step
SELECT COUNT(*) FROM oil_terminals_storage;
```

## 5. Map verification (Fujairah / Gulf bbox)

- Oil & Gas viewport banner: OSM vs GEM counts (complementary, not duplicates)
- Click Fujairah storage → commercial leads (port tenants + nearby GEM)
- Toggle GEM GOIT / GOGPT / GGIT layers
- Click OSM pipeline → optional nearby GEM GOIT attributes (≤2 km)

```bash
curl -s "http://localhost:8000/api/petroleum/infrastructure-coverage?south=22&west=50&north=28&east=58" | jq '.viewport, .coverage_gap'
```

## 6. Brazil manifests (secondary)

```bash
export BRAZIL_MANIFEST_CSV_DIR=/data/brazil_trade_manifests
# drop Comex CSV per data/brazil_trade_manifests/README.md
```

```sql
SELECT COUNT(*) FROM trade_manifest_rows WHERE data_source='brazil_comex_open' AND bol_tier='customs_open';
```

Company intel: `GET /api/company-intel?company=...&country=Brazil` should surface `customs_open` manifest rows when names match.
