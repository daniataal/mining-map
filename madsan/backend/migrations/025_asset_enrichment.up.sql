CREATE TABLE IF NOT EXISTS asset_enrichment (
    asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    operator_name TEXT,
    owner_name TEXT,
    operator_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    capacity_value NUMERIC,
    capacity_unit TEXT,
    products JSONB DEFAULT '[]'::jsonb,
    oil_terminal_id TEXT,
    source TEXT,
    tier TEXT,
    confidence NUMERIC(5,2) DEFAULT 0,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stale_after TIMESTAMPTZ,
    limitations TEXT[] DEFAULT '{}',
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_enrichment_stale ON asset_enrichment (stale_after);
CREATE INDEX IF NOT EXISTS idx_asset_enrichment_operator ON asset_enrichment (operator_company_id)
    WHERE operator_company_id IS NOT NULL;
