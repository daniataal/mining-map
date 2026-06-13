-- Preserve company-level import/export facts without collapsing multiple importers
-- into one country/product/month aggregate.

ALTER TABLE trade_flow_facts
    ADD COLUMN IF NOT EXISTS participant_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS participant_name TEXT,
    ADD COLUMN IF NOT EXISTS counterparty_name TEXT,
    ADD COLUMN IF NOT EXISTS port_code TEXT,
    ADD COLUMN IF NOT EXISTS port_name TEXT,
    ADD COLUMN IF NOT EXISTS port_state TEXT,
    ADD COLUMN IF NOT EXISTS port_padd TEXT,
    ADD COLUMN IF NOT EXISTS product_name TEXT,
    ADD COLUMN IF NOT EXISTS source_line_id TEXT,
    ADD COLUMN IF NOT EXISTS quality_api NUMERIC,
    ADD COLUMN IF NOT EXISTS quality_sulfur NUMERIC;

DROP INDEX IF EXISTS uq_trade_flow_natural_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_flow_natural_key
    ON trade_flow_facts (
        source_key,
        reporter_country_code,
        partner_country_code,
        product_code,
        flow_code,
        month,
        year,
        participant_name,
        port_code,
        source_line_id
    ) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_trade_flow_participant_company
    ON trade_flow_facts (participant_company_id, month DESC NULLS LAST, year DESC NULLS LAST)
    WHERE participant_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trade_flow_participant_name
    ON trade_flow_facts (participant_name, month DESC NULLS LAST, year DESC NULLS LAST)
    WHERE participant_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trade_flow_port_product
    ON trade_flow_facts (port_code, product_code, month DESC NULLS LAST)
    WHERE port_code IS NOT NULL;

