-- Ensure oil-live-intel trade columns exist (shared mining_db may have backend schema).
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS reporter_country TEXT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS partner_country TEXT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS period TEXT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS flow TEXT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS quantity NUMERIC;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS quantity_unit TEXT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS trade_value_usd NUMERIC;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS raw JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS oil_trade_sync_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  rows_upserted INTEGER DEFAULT 0,
  source_summary JSONB DEFAULT '{}'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb
);
