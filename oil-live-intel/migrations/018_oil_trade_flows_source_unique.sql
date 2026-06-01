-- Macro trade rows from multiple open sources can share the same bilateral corridor
-- (reporter/partner/HS/year/flow) without overwriting each other.
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS reporter VARCHAR(255);
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS reporter_m49 VARCHAR(10);
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS reporter_iso2 VARCHAR(5);
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS partner VARCHAR(255) DEFAULT 'World';
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS partner_m49 VARCHAR(10) DEFAULT '0';
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS hs_description TEXT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS flow_type CHAR(1);
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS year SMALLINT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS net_weight_kg BIGINT;
ALTER TABLE oil_trade_flows ADD COLUMN IF NOT EXISTS data_source VARCHAR(80) NOT NULL DEFAULT 'seed/static';

ALTER TABLE oil_trade_flows DROP CONSTRAINT IF EXISTS oil_trade_flows_reporter_m49_partner_m49_hs_code_flow_type_year_key;
ALTER TABLE oil_trade_flows DROP CONSTRAINT IF EXISTS oil_trade_flows_macro_source_unique;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'oil_trade_flows'
      AND column_name = 'reporter_m49'
  ) THEN
    ALTER TABLE oil_trade_flows
      ADD CONSTRAINT oil_trade_flows_macro_source_unique
      UNIQUE (reporter_m49, partner_m49, hs_code, flow_type, year, data_source);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
