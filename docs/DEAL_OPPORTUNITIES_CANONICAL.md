# Deal opportunities — canonical signal store (MAD-4x-g)

**Decision:** `oil_opportunities` is the single canonical table for ranked deal hypotheses. Do **not** add a parallel `deal_opportunity_signals` table unless ingest volume requires partitioning.

## Columns

| Column | Purpose |
|--------|---------|
| `deal_score` | Ranked score (0–1); batch rescore + port-call scanner |
| `signal_json` | Provenance: `signal_kind`, `scoring`, `why_this_matters`, `recommended_actions` |
| `source_tiers` | Honest tiers (`synthetic`, `inferred`, `live`, …) |
| `fingerprint` | Dedupe key for scanner inserts |

## Workers

- **Create:** `opportunity.ScanRecentPortCalls` (hourly) — port-call recipes
- **Rescore:** `opportunity.BatchRescoreOpenOpportunities` (same tick) — refreshes open rows

## UI

- Live Data → Deal Radar list + map opportunity layer
- Crisis desk → `top_opportunities` from digest API
- Deal Execution Pack → `GET /opportunities/{id}/deal-pack`

## Copy rule

Always label as **hypothesis** / signal — never “confirmed deal” or paid BOL.
