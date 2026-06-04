# GEM GOGPT plants — ingest and map verification

## Prerequisites

Workbook at repo root or `data/meridian/gem/`:

`Global-Oil-and-Gas-Plant-Tracker-GOGPT-January-2026.xlsx`

Set `GEM_GOGPT_XLSX_PATH` if not at repo root (Docker: `/data/meridian/gem/...`).

## Ingest (loads Postgres on VM)

```bash
curl -X POST "http://localhost:8000/api/admin/gem-gogpt-plants/ingest" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Optional sub-threshold units:

```bash
curl -X POST "http://localhost:8000/api/admin/gem-gogpt-plants/ingest" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"include_sub_threshold": true}'
```

## Verify API

```bash
curl -s "http://localhost:8000/api/petroleum/gem-plants?south=24&west=46&north=32&east=56" | jq '.feature_count,.limitations[0]'
```

```sql
SELECT COUNT(*) FROM gem_plant_units;
SELECT tags->>'primary_counterparty', tags->>'Owner(s)'
FROM gem_plant_units
WHERE tags->>'country' ILIKE '%saudi%'
LIMIT 5;
```

## Map

1. Oil & Gas view → enable **Plants — GEM GOGPT (power/CHP)**.
2. Click a marker → popup should list **Operator**, **Owner**, **Parent**, captive industry when present.
3. Cross-check **Storage tank farms** and **GEM GOIT pipelines** in the same viewport for logistics leads.

## Commercial use (honest limits)

- GEM provides **owners, operators, parents, captive industrial users** — useful for outreach and dossiers.
- GEM does **not** list tank farm lessors, storage contractors, or lease parties. Verify on the ground and via terminals/trade data.

## Rollback

```sql
TRUNCATE gem_plant_units;
```

Or set `GEM_GOGPT_AUTO_INGEST=false`.
