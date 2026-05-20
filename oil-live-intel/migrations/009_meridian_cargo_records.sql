-- Synthetic BOL-shaped Meridian Cargo Records (MCR).
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
  shipper_company_id UUID REFERENCES oil_companies(id) ON DELETE SET NULL,
  consignee_company_id UUID REFERENCES oil_companies(id) ON DELETE SET NULL,
  vessel_name TEXT,
  mmsi BIGINT,
  imo TEXT,
  load_terminal_id UUID REFERENCES oil_terminals(id) ON DELETE SET NULL,
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
  port_call_id UUID REFERENCES oil_port_calls(id) ON DELETE SET NULL,
  commercial_event_id UUID REFERENCES oil_commercial_events(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES oil_opportunities(id) ON DELETE SET NULL,
  corridor_mmsi BIGINT,
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

CREATE INDEX IF NOT EXISTS meridian_cargo_records_commodity_idx ON meridian_cargo_records (commodity_family);
CREATE INDEX IF NOT EXISTS meridian_cargo_records_country_idx ON meridian_cargo_records (load_country);
CREATE INDEX IF NOT EXISTS meridian_cargo_records_mmsi_idx ON meridian_cargo_records (mmsi);
CREATE INDEX IF NOT EXISTS meridian_cargo_records_confidence_idx ON meridian_cargo_records (confidence DESC);
CREATE INDEX IF NOT EXISTS meridian_cargo_records_event_date_idx ON meridian_cargo_records (event_date DESC NULLS LAST);

ALTER TABLE oil_opportunities ADD COLUMN IF NOT EXISTS deal_execution_pack JSONB DEFAULT '{}'::jsonb;
