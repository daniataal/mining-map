-- EIA Petroleum Supply Monthly — company-level U.S. petroleum imports (file upload).
-- Populated by backend/services/eia_historic_imports.py (not live EIA API).

CREATE TABLE IF NOT EXISTS eia_historic_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source TEXT NOT NULL DEFAULT 'eia_file_upload',
    source_file TEXT NOT NULL,
    source_sheet TEXT,
    period_year INT,
    period_month INT,
    line_num INT,
    importer_name TEXT,
    importer_country TEXT DEFAULT 'United States',
    origin_country TEXT,
    origin_name TEXT,
    product TEXT,
    commodity_family TEXT,
    volume NUMERIC,
    volume_unit TEXT DEFAULT 'bbl',
    value_usd NUMERIC,
    port_code TEXT,
    port_city TEXT,
    port_state TEXT,
    raw JSONB,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eia_historic_imports_grain
    ON eia_historic_imports (
        data_source,
        source_file,
        COALESCE(source_sheet, ''),
        period_year,
        COALESCE(period_month, 0),
        COALESCE(importer_name, ''),
        COALESCE(origin_country, ''),
        COALESCE(product, ''),
        COALESCE(port_code, ''),
        COALESCE(line_num, 0)
    );

CREATE INDEX IF NOT EXISTS idx_eia_historic_imports_importer_year
    ON eia_historic_imports (importer_name, period_year);

CREATE INDEX IF NOT EXISTS idx_eia_historic_imports_origin_year
    ON eia_historic_imports (origin_country, period_year);

CREATE INDEX IF NOT EXISTS idx_eia_historic_imports_period
    ON eia_historic_imports (period_year, period_month);
