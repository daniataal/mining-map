-- Dev-only: populate hormuz_disruption_v1 top_corridors (commodity_family=crude, load origin in bbox).
-- Safe to re-run (ON CONFLICT fingerprint). Production: do not run; use OIL_LIVE_DISABLE_DEMO_SEED=1.

INSERT INTO meridian_cargo_records (
  synthetic_bol_id, fingerprint, recipe, commodity_family, confidence, triangulation_score,
  bol_tier, shipper_name, consignee_name, load_country, discharge_country,
  commodity_description, volume_best_estimate, volume_unit, event_date,
  corridor_mmsi, corridor_load_lat, corridor_load_lng, corridor_discharge_lat, corridor_discharge_lng,
  evidence_chain, sources, metadata
) VALUES
(
  'DEMO-HORMUZ-MCR-001', 'demo-hormuz-mcr-001-ras-india', 'demo_hormuz_corridor', 'crude', 0.78, 1,
  'synthetic', 'Saudi Aramco (demo)', 'Indian Oil Corp (demo)', 'Saudi Arabia', 'India',
  'Crude oil (demo corridor)', 820000, 'bbl', now() - interval '12 days',
  636012345, 26.707, 50.061, 18.95, 72.82,
  '["DEMO SEED — Hormuz crisis desk"]'::jsonb,
  '[{"name":"demo_seed","url":"internal://sql/seed_hormuz_crisis_demo"}]'::jsonb,
  '{"scenario":"hormuz_disruption_v1"}'::jsonb
),
(
  'DEMO-HORMUZ-MCR-002', 'demo-hormuz-mcr-002-fujairah-china', 'demo_hormuz_corridor', 'crude', 0.74, 1,
  'synthetic', 'ADNOC Trading (demo)', 'Sinopec (demo)', 'United Arab Emirates', 'China',
  'Crude oil (demo corridor)', 650000, 'bbl', now() - interval '18 days',
  636012345, 25.128, 56.337, 31.23, 121.47,
  '["DEMO SEED — Hormuz crisis desk"]'::jsonb,
  '[{"name":"demo_seed","url":"internal://sql/seed_hormuz_crisis_demo"}]'::jsonb,
  '{"scenario":"hormuz_disruption_v1"}'::jsonb
),
(
  'DEMO-HORMUZ-MCR-003', 'demo-hormuz-mcr-003-bandar-fujairah', 'demo_hormuz_corridor', 'crude', 0.71, 1,
  'synthetic', 'NIOC (demo)', 'Emirates National Oil (demo)', 'Iran', 'United Arab Emirates',
  'Crude oil (demo corridor)', 540000, 'bbl', now() - interval '9 days',
  636012345, 27.18, 56.28, 25.01, 55.05,
  '["DEMO SEED — Hormuz crisis desk"]'::jsonb,
  '[{"name":"demo_seed","url":"internal://sql/seed_hormuz_crisis_demo"}]'::jsonb,
  '{"scenario":"hormuz_disruption_v1"}'::jsonb
)
ON CONFLICT (fingerprint) DO UPDATE SET
  commodity_family = EXCLUDED.commodity_family,
  corridor_load_lat = EXCLUDED.corridor_load_lat,
  corridor_load_lng = EXCLUDED.corridor_load_lng,
  corridor_discharge_lat = EXCLUDED.corridor_discharge_lat,
  corridor_discharge_lng = EXCLUDED.corridor_discharge_lng,
  updated_at = now();
