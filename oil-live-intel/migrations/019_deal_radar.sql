-- Deal Radar v1: additive opportunity enrichment for execution-focused leads.
ALTER TABLE oil_opportunities ADD COLUMN IF NOT EXISTS deal_score NUMERIC;
ALTER TABLE oil_opportunities ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE oil_opportunities ADD COLUMN IF NOT EXISTS signal_json JSONB DEFAULT '{}'::jsonb;
ALTER TABLE oil_opportunities ADD COLUMN IF NOT EXISTS route_prefill_json JSONB DEFAULT '{}'::jsonb;
ALTER TABLE oil_opportunities ADD COLUMN IF NOT EXISTS source_tiers TEXT[] DEFAULT '{}';
ALTER TABLE oil_opportunities ADD COLUMN IF NOT EXISTS freshness_at TIMESTAMPTZ;

UPDATE oil_opportunities
SET
  deal_score = COALESCE(deal_score, confidence),
  signal_json = COALESCE(signal_json, '{}'::jsonb),
  route_prefill_json = COALESCE(route_prefill_json, '{}'::jsonb),
  source_tiers = COALESCE(source_tiers, ARRAY['synthetic']::TEXT[]),
  freshness_at = COALESCE(freshness_at, updated_at, created_at)
WHERE deal_score IS NULL
   OR signal_json IS NULL
   OR route_prefill_json IS NULL
   OR source_tiers IS NULL
   OR freshness_at IS NULL;

CREATE INDEX IF NOT EXISTS oil_opportunities_status_deal_score_idx
  ON oil_opportunities (status, deal_score DESC NULLS LAST, updated_at DESC);

CREATE INDEX IF NOT EXISTS oil_opportunities_signal_json_gin_idx
  ON oil_opportunities USING GIN (signal_json);

CREATE UNIQUE INDEX IF NOT EXISTS oil_opportunities_open_fingerprint_uidx
  ON oil_opportunities (fingerprint)
  WHERE fingerprint IS NOT NULL AND status = 'open';
