CREATE TABLE IF NOT EXISTS opportunity_investor_path_snapshots (
    id TEXT PRIMARY KEY,
    opportunity_id UUID NOT NULL REFERENCES opportunity_candidates(id) ON DELETE CASCADE,
    lane_id TEXT,
    commodity TEXT,
    origin_country TEXT,
    destination_country TEXT,
    investor_name TEXT,
    investor_entity_id TEXT,
    supplier_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    buyer_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    supplier_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    buyer_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    score NUMERIC(6,2) DEFAULT 0,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    investor_control_score NUMERIC(5,2) DEFAULT 0,
    evidence_label TEXT NOT NULL DEFAULT 'inferred',
    payload JSONB NOT NULL,
    generated_by TEXT NOT NULL DEFAULT 'opportunity_investor_paths_v1',
    generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_investor_paths_score
    ON opportunity_investor_path_snapshots (score DESC, confidence_score DESC, investor_control_score DESC);

CREATE INDEX IF NOT EXISTS idx_opportunity_investor_paths_filters
    ON opportunity_investor_path_snapshots (commodity, origin_country, destination_country);

CREATE INDEX IF NOT EXISTS idx_opportunity_investor_paths_investor
    ON opportunity_investor_path_snapshots (investor_name, investor_entity_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_investor_paths_assets
    ON opportunity_investor_path_snapshots (supplier_asset_id, buyer_asset_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_investor_paths_companies
    ON opportunity_investor_path_snapshots (supplier_company_id, buyer_company_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_investor_paths_payload
    ON opportunity_investor_path_snapshots USING GIN (payload);
