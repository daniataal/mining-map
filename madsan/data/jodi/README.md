# JODI raw drops

Place JODI Oil CSV exports under `madsan/data/jodi/oil/`.

JODI Gas is intentionally deferred until a usable dataset is available.

Raw files in this directory are local/import inputs only and are ignored by git.
Track only this README, `.gitkeep`, and small `manifest*.json` or
`manifest*.csv` files that describe source release, checksum, row count,
coverage, attribution, and license/commercial-use notes.

Permanent ingestion should be implemented in Go and should write normalized
rows into MadSan/Postgres rather than reading raw CSVs from API handlers.
