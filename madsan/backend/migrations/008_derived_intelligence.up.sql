CREATE TABLE IF NOT EXISTS voyages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id UUID REFERENCES vessels(id) ON DELETE SET NULL,
    mmsi TEXT,
    load_port_name TEXT,
    load_country TEXT,
    discharge_port_name TEXT,
    discharge_country TEXT,
    commodity_family TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    geom GEOGRAPHY(LineString, 4326),
    confidence_score NUMERIC(5,2) DEFAULT 0,
    tier TEXT DEFAULT 'observed',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cargo_estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id UUID REFERENCES vessels(id) ON DELETE SET NULL,
    voyage_id UUID REFERENCES voyages(id) ON DELETE SET NULL,
    payload_tons NUMERIC,
    payload_low NUMERIC,
    payload_high NUMERIC,
    method TEXT,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    observed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_graph_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    osm_id TEXT,
    source_node_id BIGINT,
    target_node_id BIGINT,
    geom GEOGRAPHY(Geometry, 4326),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_pipeline_geom ON pipeline_graph_edges USING GIST (geom);

CREATE TABLE IF NOT EXISTS deal_watch_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    last_snapshot JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    message TEXT,
    payload JSONB DEFAULT '{}',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    company_name TEXT,
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending',
    review_queue_id UUID REFERENCES manual_review_queue(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    entity_type TEXT,
    entity_id UUID,
    verdict TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
