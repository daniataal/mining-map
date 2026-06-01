CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS oil_terminals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  terminal_type TEXT,
  operator_name TEXT,
  owner_name TEXT,
  country TEXT,
  port TEXT,
  city TEXT,
  products TEXT[],
  source TEXT,
  source_url TEXT,
  confidence NUMERIC DEFAULT 0.5,
  geom GEOMETRY(GEOMETRY, 4326),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oil_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  company_type TEXT,
  country TEXT,
  website TEXT,
  description TEXT,
  source TEXT,
  source_url TEXT,
  confidence NUMERIC DEFAULT 0.5,
  supplier_status TEXT DEFAULT 'candidate',
  supplier_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(normalized_name, country)
);

CREATE TABLE IF NOT EXISTS oil_vessels (
  mmsi BIGINT PRIMARY KEY,
  imo TEXT,
  name TEXT,
  callsign TEXT,
  vessel_type TEXT,
  tanker_class TEXT,
  length_m NUMERIC,
  beam_m NUMERIC,
  deadweight_tons NUMERIC,
  max_draft_m NUMERIC,
  crude_capable BOOLEAN DEFAULT false,
  product_tanker BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oil_ais_positions (
  id BIGSERIAL PRIMARY KEY,
  mmsi BIGINT,
  ts TIMESTAMPTZ NOT NULL,
  lat NUMERIC NOT NULL,
  lon NUMERIC NOT NULL,
  speed NUMERIC,
  course NUMERIC,
  heading NUMERIC,
  nav_status TEXT,
  draft_m NUMERIC,
  destination TEXT,
  eta TEXT,
  geom GEOMETRY(POINT, 4326),
  raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oil_port_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi BIGINT,
  vessel_name TEXT,
  terminal_id UUID REFERENCES oil_terminals(id),
  arrival_ts TIMESTAMPTZ,
  departure_ts TIMESTAMPTZ,
  duration_hours NUMERIC,
  draft_in NUMERIC,
  draft_out NUMERIC,
  draft_delta NUMERIC,
  destination_in TEXT,
  destination_out TEXT,
  event_type TEXT,
  product_family_inferred TEXT,
  estimated_volume_barrels NUMERIC,
  confidence NUMERIC DEFAULT 0.0,
  status TEXT DEFAULT 'open',
  evidence JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oil_trade_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT,
  reporter_country TEXT,
  partner_country TEXT,
  hs_code TEXT,
  period TEXT,
  flow TEXT,
  quantity NUMERIC,
  quantity_unit TEXT,
  trade_value_usd NUMERIC,
  raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oil_intelligence_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  port_call_id UUID REFERENCES oil_port_calls(id),
  terminal_id UUID REFERENCES oil_terminals(id),
  company_id UUID REFERENCES oil_companies(id),
  title TEXT,
  summary TEXT,
  event_type TEXT,
  product_family_inferred TEXT,
  possible_seller TEXT,
  possible_buyer TEXT,
  confidence NUMERIC DEFAULT 0.0,
  severity TEXT DEFAULT 'info',
  evidence JSONB DEFAULT '[]'::jsonb,
  raw_context JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oil_supplier_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES oil_companies(id),
  supplier_id TEXT,
  export_status TEXT DEFAULT 'pending',
  payload JSONB DEFAULT '{}'::jsonb,
  response JSONB DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
