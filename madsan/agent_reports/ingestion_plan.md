# Ingestion Plan

## Flow

`scheduler (cron) → ingestion_jobs (River) → worker 16-step pipeline`

## Adapters

| Adapter | Formats | Schedule |
|---------|---------|----------|
| csv | CSV | per-source |
| json | JSON seed | weekly |
| geojson | GeoJSON | monthly |
| api | REST (Comtrade, EIA, GLEIF, etc.) | per-source |
| upload | user/supplier portal | immediate |

## Change detection

- Files: SHA256; skip if unchanged
- APIs: ETag / Last-Modified / response hash
- Rows: normalized checksum; upsert only deltas

## Limits

- 1 worker, batch 500–5000, 3 retries, heavy jobs at night
- Targeted matview refresh only
