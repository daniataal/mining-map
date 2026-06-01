# Brazil open trade manifests (MAD-4x-c2)

Place Comex Stat–style CSV exports here. Graph-sync step `trade_manifest_brazil` ingests into `trade_manifest_rows` with `bol_tier=customs_open`.

```bash
export BRAZIL_MANIFEST_CSV_DIR=/data/brazil_trade_manifests
# docker compose graph-sync or:
PYTHONPATH=. python3 -c "from backend.services.trade_manifest_ingest import sync_brazil_open_trade_rows; import psycopg2, os; c=psycopg2.connect(...); print(sync_brazil_open_trade_rows(c)); c.commit()"
```
