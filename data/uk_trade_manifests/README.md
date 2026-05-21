# UK open trade manifest samples

Place HMRC-style CSV exports here (`*.csv`). Graph-sync step `trade_manifest_uk` ingests them into `trade_manifest_rows` with `bol_tier=customs_open`.

Bundled `sample_open_trade.csv` is a **demo row** for UI/search smoke tests — not official HMRC data.

Env on VM:

```bash
UK_MANIFEST_CSV_DIR=/data/uk_trade_manifests
UK_TRADE_MANIFEST_SYNC_ENABLED=true
```

Compose mounts this folder read-only into workers that run graph-sync.
