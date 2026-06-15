DROP INDEX IF EXISTS idx_trade_flow_port_product;
DROP INDEX IF EXISTS idx_trade_flow_participant_name;
DROP INDEX IF EXISTS idx_trade_flow_participant_company;
DROP INDEX IF EXISTS uq_trade_flow_natural_key;

ALTER TABLE trade_flow_facts
    DROP COLUMN IF EXISTS quality_sulfur,
    DROP COLUMN IF EXISTS quality_api,
    DROP COLUMN IF EXISTS source_line_id,
    DROP COLUMN IF EXISTS product_name,
    DROP COLUMN IF EXISTS port_padd,
    DROP COLUMN IF EXISTS port_state,
    DROP COLUMN IF EXISTS port_name,
    DROP COLUMN IF EXISTS port_code,
    DROP COLUMN IF EXISTS counterparty_name,
    DROP COLUMN IF EXISTS participant_name,
    DROP COLUMN IF EXISTS participant_company_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_flow_natural_key
    ON trade_flow_facts (
        source_key,
        reporter_country_code,
        partner_country_code,
        product_code,
        flow_code,
        month,
        year
    ) NULLS NOT DISTINCT;

