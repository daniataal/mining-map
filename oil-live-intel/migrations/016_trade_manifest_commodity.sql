-- Open customs manifest-like rows + commodity-agnostic trade flows (mining HS).

CREATE TABLE IF NOT EXISTS trade_manifest_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source TEXT NOT NULL,
    bol_tier TEXT NOT NULL DEFAULT 'customs_open',
    source_record_url TEXT,
    reporter_country TEXT,
    partner_country TEXT,
    hs_code TEXT,
    commodity_family TEXT,
    flow_type TEXT,
    period_year INT,
    period_month INT,
    importer_name TEXT,
    exporter_name TEXT,
    product_description TEXT,
    quantity NUMERIC,
    quantity_unit TEXT,
    value_usd NUMERIC,
    port_name TEXT,
    vessel_name TEXT,
    raw JSONB DEFAULT '{}'::jsonb,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_manifest_grain
    ON trade_manifest_rows (
        data_source,
        COALESCE(importer_name, ''),
        COALESCE(exporter_name, ''),
        COALESCE(hs_code, ''),
        COALESCE(period_year, 0),
        COALESCE(period_month, 0),
        COALESCE(partner_country, ''),
        COALESCE(flow_type, '')
    );

CREATE INDEX IF NOT EXISTS idx_trade_manifest_importer
    ON trade_manifest_rows (LOWER(importer_name));
CREATE INDEX IF NOT EXISTS idx_trade_manifest_exporter
    ON trade_manifest_rows (LOWER(exporter_name));
CREATE INDEX IF NOT EXISTS idx_trade_manifest_tier
    ON trade_manifest_rows (bol_tier);

CREATE TABLE IF NOT EXISTS commodity_trade_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source TEXT NOT NULL,
    bol_tier TEXT NOT NULL DEFAULT 'macro',
    reporter TEXT,
    reporter_iso2 TEXT,
    partner TEXT,
    partner_iso2 TEXT,
    hs_code TEXT NOT NULL,
    hs_description TEXT,
    commodity_family TEXT,
    flow_type TEXT,
    year INT,
    trade_value_usd NUMERIC,
    net_weight_kg NUMERIC,
    raw JSONB DEFAULT '{}'::jsonb,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commodity_trade_flows_grain
    ON commodity_trade_flows (data_source, reporter_iso2, partner_iso2, hs_code, year, flow_type);

CREATE INDEX IF NOT EXISTS idx_commodity_trade_reporter_hs
    ON commodity_trade_flows (reporter_iso2, hs_code, year DESC);

CREATE TABLE IF NOT EXISTS jodi_oil_snapshots (
    id SERIAL PRIMARY KEY,
    country TEXT NOT NULL,
    product TEXT,
    flow_indicator TEXT,
    period TEXT NOT NULL,
    value NUMERIC,
    unit TEXT,
    data_source TEXT NOT NULL DEFAULT 'jodi',
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jodi_snapshot
    ON jodi_oil_snapshots (country, product, flow_indicator, period);
