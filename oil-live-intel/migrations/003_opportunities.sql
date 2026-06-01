CREATE TABLE IF NOT EXISTS oil_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_type TEXT NOT NULL,
  mmsi BIGINT,
  terminal_id UUID REFERENCES oil_terminals(id),
  port_call_id UUID REFERENCES oil_port_calls(id),
  company_id UUID REFERENCES oil_companies(id),
  title TEXT NOT NULL,
  hypothesis TEXT,
  confidence NUMERIC DEFAULT 0.0,
  severity TEXT DEFAULT 'info',
  evidence JSONB DEFAULT '[]'::jsonb,
  profit_checklist JSONB DEFAULT '[]'::jsonb,
  raw_context JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'open',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oil_opportunities_type_idx ON oil_opportunities (opportunity_type);
CREATE INDEX IF NOT EXISTS oil_opportunities_status_idx ON oil_opportunities (status);
CREATE INDEX IF NOT EXISTS oil_opportunities_created_idx ON oil_opportunities (created_at DESC);

CREATE TABLE IF NOT EXISTS oil_watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  watch_type TEXT NOT NULL,
  watch_ref TEXT NOT NULL,
  label TEXT,
  min_confidence NUMERIC DEFAULT 0.6,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, watch_type, watch_ref)
);
