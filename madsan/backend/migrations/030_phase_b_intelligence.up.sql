-- Phase B: STS zone seed, MCR storage, STS signal dedupe keys.

INSERT INTO sts_zones (name, zone_type, geom, source, confidence, metadata)
SELECT v.name, v.zone_type, v.geom::geography, v.source, v.confidence, v.metadata
FROM (VALUES
  (
    'Fujairah STS anchorage (approx)',
    'sts_anchorage',
    ST_GeomFromText('POLYGON((56.35 24.95, 56.65 24.95, 56.65 25.15, 56.35 25.15, 56.35 24.95))', 4326),
    'inferred_open_sources',
    0.55::numeric,
    '{"region":"UAE","note":"Approximate Fujairah/offshore anchorage polygon"}'::jsonb
  ),
  (
    'West Africa STS area (approx)',
    'sts_anchorage',
    ST_GeomFromText('POLYGON((1.5 4.8, 2.8 4.8, 2.8 6.0, 1.5 6.0, 1.5 4.8))', 4326),
    'inferred_open_sources',
    0.50::numeric,
    '{"region":"Gulf of Guinea","note":"Approximate open-water STS hotspot"}'::jsonb
  ),
  (
    'Singapore Strait STS area (approx)',
    'sts_anchorage',
    ST_GeomFromText('POLYGON((103.5 1.0, 104.2 1.0, 104.2 1.5, 103.5 1.5, 103.5 1.0))', 4326),
    'inferred_open_sources',
    0.55::numeric,
    '{"region":"Singapore/Malaysia","note":"Approximate eastern strait STS anchorage area"}'::jsonb
  )
) AS v(name, zone_type, geom, source, confidence, metadata)
WHERE NOT EXISTS (SELECT 1 FROM sts_zones LIMIT 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_signals_sts_pair_start
    ON core_signals ((payload->>'sts_pair_key'))
    WHERE signal_type = 'sts' AND payload->>'sts_pair_key' IS NOT NULL;

CREATE TABLE IF NOT EXISTS meridian_cargo_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    synthetic_bol_id TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL UNIQUE,
    recipe TEXT NOT NULL,
    commodity_family TEXT NOT NULL,
    confidence NUMERIC DEFAULT 0.5,
    triangulation_score INT DEFAULT 0,
    bol_tier TEXT DEFAULT 'synthetic',
    shipper_name TEXT,
    consignee_name TEXT,
    shipper_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    consignee_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    vessel_name TEXT,
    mmsi TEXT,
    imo TEXT,
    load_terminal_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    load_port_name TEXT,
    load_country TEXT,
    discharge_hint TEXT,
    discharge_country TEXT,
    commodity_description TEXT,
    volume_low NUMERIC,
    volume_high NUMERIC,
    volume_best_estimate NUMERIC,
    volume_method TEXT,
    volume_unit TEXT DEFAULT 'bbl',
    event_date TIMESTAMPTZ,
    port_call_id UUID REFERENCES port_call_visits(id) ON DELETE SET NULL,
    commercial_event_id UUID,
    opportunity_id UUID,
    corridor_mmsi TEXT,
    corridor_load_lat NUMERIC,
    corridor_load_lng NUMERIC,
    corridor_discharge_lat NUMERIC,
    corridor_discharge_lng NUMERIC,
    evidence_chain JSONB DEFAULT '[]'::jsonb,
    sources JSONB DEFAULT '[]'::jsonb,
    contact_ids UUID[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcr_commodity ON meridian_cargo_records (commodity_family);
CREATE INDEX IF NOT EXISTS idx_mcr_country ON meridian_cargo_records (load_country);
CREATE INDEX IF NOT EXISTS idx_mcr_mmsi ON meridian_cargo_records (mmsi);
CREATE INDEX IF NOT EXISTS idx_mcr_confidence ON meridian_cargo_records (confidence DESC);
CREATE INDEX IF NOT EXISTS idx_mcr_event_date ON meridian_cargo_records (event_date DESC NULLS LAST);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voyages_pair_legs
    ON voyages (mmsi, (metadata->>'load_visit_id'), (metadata->>'discharge_visit_id'))
    WHERE metadata->>'load_visit_id' IS NOT NULL AND metadata->>'discharge_visit_id' IS NOT NULL;
