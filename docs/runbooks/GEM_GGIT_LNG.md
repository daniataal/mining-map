# GEM GGIT LNG terminals ingest

## Source

- Workbook: `Global-Gas-Infrastructure-Tracker-GGIT-September-2025.xlsx` (or `GEM_GGIT_XLSX_PATH`)
- Sheets: `LNG Terminals`, `LNG Import Terminals`, `LNG Export Trains` (fallback: any sheet name containing `lng`)
- Tracker: [Global Gas Infrastructure Tracker](https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/)

## VM setup

```bash
mkdir -p /data/meridian/gem
cp Global-Gas-Infrastructure-Tracker-GGIT-September-2025.xlsx /data/meridian/gem/
export GEM_GGIT_XLSX_PATH=/data/meridian/gem/Global-Gas-Infrastructure-Tracker-GGIT-September-2025.xlsx
export GEM_GGIT_AUTO_INGEST=true
```

## Ingest

```bash
curl -X POST "http://localhost:8000/api/admin/gem-ggit-lng/ingest" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Or graph-sync step `gem_ggit_lng` on `POST /api/admin/oil-live/graph-sync`.

## Verify

```sql
SELECT COUNT(*) FROM gem_lng_terminals;
```

```bash
curl -s "http://localhost:8000/api/petroleum/gem-lng-terminals?south=22&west=50&north=28&east=58" | jq '.feature_count'
```

Oil & Gas map layer: **LNG terminals — GEM GGIT**. Storage terminal popups include nearby LNG within 25 km.
