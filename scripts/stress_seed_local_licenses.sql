-- Synthetic mining licenses to reproduce remote-scale /licenses latency locally.
-- Run ONLY against a disposable local DB, e.g.:
--   docker compose exec -T db psql -U postgres -d mining_db -f - < scripts/stress_seed_local_licenses.sql
--
-- Remove later:
--   DELETE FROM licenses WHERE id LIKE 'stress-bench-%';

INSERT INTO licenses (
  id, company, country, region, commodity, license_type, status,
  lat, lng, sector, record_origin, source_id, source_name
)
SELECT
  'stress-bench-' || gs::text,
  'Bench Co',
  'Ghana',
  'Bench Region',
  'Gold',
  'ML',
  'Active',
  6.5 + ((gs % 200)::float / 1000.0),
  -1.5 + ((gs % 200)::float / 1000.0),
  'mining',
  'open_data',
  'british_columbia_mineral_tenure',
  'Bench synthetic'
FROM generate_series(1, 25000) AS gs
ON CONFLICT (id) DO NOTHING;
