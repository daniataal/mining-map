CREATE TABLE IF NOT EXISTS oil_opportunity_economics (
  opportunity_id UUID PRIMARY KEY REFERENCES oil_opportunities(id) ON DELETE CASCADE,
  volume_bbl NUMERIC,
  buy_price_usd_per_bbl NUMERIC,
  sell_price_usd_per_bbl NUMERIC,
  freight_usd NUMERIC,
  storage_usd NUMERIC,
  other_costs_usd NUMERIC,
  notes TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
