-- Meridian commercial graph: normalized events from merged free sources.
CREATE TABLE IF NOT EXISTS oil_commercial_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  title TEXT,
  summary TEXT,
  country TEXT,
  partner_country TEXT,
  commodity_family TEXT,
  hs_code TEXT,
  mmsi BIGINT,
  terminal_id UUID REFERENCES oil_terminals(id) ON DELETE SET NULL,
  company_id UUID REFERENCES oil_companies(id) ON DELETE SET NULL,
  port_call_id UUID REFERENCES oil_port_calls(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES oil_opportunities(id) ON DELETE SET NULL,
  volume_low NUMERIC,
  volume_high NUMERIC,
  volume_best_estimate NUMERIC,
  volume_method TEXT,
  confidence NUMERIC DEFAULT 0.5,
  record_tier TEXT DEFAULT 'inferred',
  sources JSONB DEFAULT '[]'::jsonb,
  evidence JSONB DEFAULT '[]'::jsonb,
  raw JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oil_commercial_events_type_idx ON oil_commercial_events (event_type);
CREATE INDEX IF NOT EXISTS oil_commercial_events_country_idx ON oil_commercial_events (country);
CREATE INDEX IF NOT EXISTS oil_commercial_events_occurred_idx ON oil_commercial_events (occurred_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS oil_commercial_events_terminal_idx ON oil_commercial_events (terminal_id);
CREATE INDEX IF NOT EXISTS oil_commercial_events_mmsi_idx ON oil_commercial_events (mmsi);
