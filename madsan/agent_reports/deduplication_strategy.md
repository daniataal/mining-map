# Deduplication Strategy

## Tooling

**Splink** (Fellegi-Sunter) batch on Postgres/DuckDB for companies/assets.

## Thresholds

| Match score | Action |
|-------------|--------|
| ≥ 85 | auto-merge / auto-update |
| 60–84 | manual_review_queue |
| < 60 | separate unverified record or reject |

## Signals

normalized_name, aliases, country, coordinate proximity, website domain, registration number, IMO/MMSI, asset_type, port, commodity overlap, source reliability.

Never merge on name similarity alone.
