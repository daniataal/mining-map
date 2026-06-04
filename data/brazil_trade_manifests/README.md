# Brazil open trade manifests (Comexstat-style file drop)

Place government/open Comex CSV exports here. Graph-sync step `trade_manifest_brazil` ingests into `trade_manifest_rows` with **`bol_tier=customs_open`** only (no paid API scrape in v1).

## Required columns (at least one party)

| Column (aliases) | Purpose |
|------------------|---------|
| `importer_name`, `importer`, `consignee` | Brazilian importer / consignee |
| `exporter_name`, `exporter`, `shipper` | Foreign exporter / shipper |

Rows without importer **and** exporter are skipped.

## Recommended columns

| Column | Purpose |
|--------|---------|
| `hs_code`, `hs`, `ncm` | HS/NCM commodity code |
| `period_year`, `year` | Calendar year |
| `period_month`, `month` | Month (optional) |
| `port_name`, `port` | Brazilian port |
| `reporter_country`, `country` | Defaults to Brazil when omitted |
| `flow_type` | `import` / `export` |
| `value_usd`, `value` | USD value |
| `quantity`, `quantity_unit` | Volume |
| `cnpj_importer`, `cnpj_exporter` | Stored in `raw` JSON for diligence |
| `product_description`, `product` | Goods description |
| `source_record_url`, `url` | Attribution link |

Header names are case-insensitive; spaces become underscores during ingest.

## Rejected files

CSV without any party column is rejected (see `files` array in graph-sync `trade_manifest_brazil` summary).

## Run ingest

```bash
export BRAZIL_MANIFEST_CSV_DIR=/data/brazil_trade_manifests
export BRAZIL_TRADE_MANIFEST_SYNC_ENABLED=true
```

```bash
# docker compose graph-sync or:
PYTHONPATH=. python3 -c "
from backend.services.trade_manifest_ingest import sync_brazil_open_trade_rows
import psycopg2, os
c=psycopg2.connect(os.environ['DATABASE_URL'])
print(sync_brazil_open_trade_rows(c))
c.commit()
"
```

## Verify company intel path

```sql
SELECT COUNT(*) FROM trade_manifest_rows
 WHERE data_source='brazil_comex_open' AND bol_tier='customs_open';
```

```bash
curl -s "http://localhost:8000/api/company-intel?company=ACME%20BR&country=Brazil&commodity=crude%20oil" | jq '.trade_flows.flows[] | select(.bol_tier==\"customs_open\")'
```
