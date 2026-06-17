-- Opportunity Originator: broker alpha, open STS leads, margin layer.

ALTER TABLE opportunity_candidates
    ADD COLUMN IF NOT EXISTS buyer_eia_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS cargo_voyage_linked BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cargo_linkage_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS broker_alpha_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID NOT NULL REFERENCES opportunity_candidates(id) ON DELETE CASCADE,
    lane_id TEXT,
    intent_score NUMERIC(6,2) DEFAULT 0,
    counterparty_intent_score NUMERIC(6,2) DEFAULT 0,
    jodi_stress_component NUMERIC(6,2) DEFAULT 0,
    import_dependency_component NUMERIC(6,2) DEFAULT 0,
    open_vessel_proximity_component NUMERIC(6,2) DEFAULT 0,
    lane_fit_component NUMERIC(6,2) DEFAULT 0,
    price_spread_component NUMERIC(6,2) DEFAULT 0,
    thesis_text TEXT NOT NULL,
    scenario_label TEXT NOT NULL DEFAULT 'scenario_intelligence',
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    UNIQUE (opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_broker_alpha_lane ON broker_alpha_snapshots (lane_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_broker_alpha_generated ON broker_alpha_snapshots (generated_at DESC);

CREATE TABLE IF NOT EXISTS sts_open_vessel_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id UUID REFERENCES vessels(id) ON DELETE SET NULL,
    mmsi TEXT NOT NULL UNIQUE,
    imo TEXT,
    vessel_name TEXT,
    vessel_class TEXT,
    zone_label TEXT,
    latest_destination TEXT,
    nav_status TEXT,
    loitering_hours NUMERIC(10,2),
    latest_draft_m NUMERIC(8,2),
    draft_trend TEXT,
    product_family TEXT,
    owner_name TEXT,
    operator_name TEXT,
    owner_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    operator_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
    lead_label TEXT NOT NULL DEFAULT 'open-to-sts',
    confidence_score NUMERIC(6,2) DEFAULT 0,
    evidence_labels TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sts_open_leads_label ON sts_open_vessel_leads (lead_label, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_sts_open_leads_generated ON sts_open_vessel_leads (generated_at DESC);

CREATE TABLE IF NOT EXISTS freight_cost_curves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corridor_key TEXT NOT NULL,
    origin_country TEXT,
    destination_country TEXT,
    vessel_class TEXT NOT NULL DEFAULT 'tanker',
    distance_nm NUMERIC(12,2),
    freight_low_usd_per_bbl NUMERIC(12,4),
    freight_base_usd_per_bbl NUMERIC(12,4),
    freight_high_usd_per_bbl NUMERIC(12,4),
    method TEXT NOT NULL,
    evidence_label TEXT NOT NULL DEFAULT 'estimated',
    source_key TEXT NOT NULL DEFAULT 'open_distance_proxy_v1',
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (corridor_key, vessel_class, method)
);

CREATE INDEX IF NOT EXISTS idx_freight_cost_corridor ON freight_cost_curves (origin_country, destination_country);

CREATE TABLE IF NOT EXISTS quality_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code TEXT NOT NULL,
    quality_band TEXT NOT NULL DEFAULT 'unspecified',
    adjustment_low_usd_per_bbl NUMERIC(12,4),
    adjustment_base_usd_per_bbl NUMERIC(12,4),
    adjustment_high_usd_per_bbl NUMERIC(12,4),
    evidence_label TEXT NOT NULL DEFAULT 'estimated',
    method TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_code, quality_band, method)
);

CREATE TABLE IF NOT EXISTS landed_margin_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID NOT NULL REFERENCES opportunity_candidates(id) ON DELETE CASCADE,
    lane_id TEXT,
    commodity TEXT,
    origin_country TEXT,
    destination_country TEXT,
    benchmark_key TEXT,
    source_price_usd NUMERIC(12,4),
    destination_price_usd NUMERIC(12,4),
    freight_low_usd NUMERIC(12,4),
    freight_base_usd NUMERIC(12,4),
    freight_high_usd NUMERIC(12,4),
    quality_low_usd NUMERIC(12,4),
    quality_base_usd NUMERIC(12,4),
    quality_high_usd NUMERIC(12,4),
    margin_low_usd NUMERIC(12,4),
    margin_base_usd NUMERIC(12,4),
    margin_high_usd NUMERIC(12,4),
    evidence_label TEXT NOT NULL DEFAULT 'estimated',
    method TEXT,
    limitations TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    UNIQUE (opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_landed_margin_lane ON landed_margin_snapshots (lane_id, generated_at DESC);
