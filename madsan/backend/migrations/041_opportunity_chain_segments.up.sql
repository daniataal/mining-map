CREATE TABLE IF NOT EXISTS opportunity_chain_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID NOT NULL REFERENCES opportunity_candidates(id) ON DELETE CASCADE,
    lane_id TEXT,
    segment_order INT NOT NULL DEFAULT 0,
    from_step TEXT NOT NULL,
    to_step TEXT NOT NULL,
    label TEXT NOT NULL,
    geometry_source TEXT NOT NULL DEFAULT 'inferred_direct_corridor',
    source_key TEXT,
    project_id TEXT,
    pipeline_name TEXT,
    distance_m NUMERIC,
    evidence_label TEXT NOT NULL DEFAULT 'inferred',
    geom geometry(Geometry, 4326) NOT NULL,
    properties JSONB DEFAULT '{}'::jsonb,
    generated_by TEXT NOT NULL DEFAULT 'opportunity_chain_segments_v1',
    generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunity_chain_segments_natural
    ON opportunity_chain_segments (opportunity_id, segment_order, geometry_source, from_step, to_step, generated_by);

CREATE INDEX IF NOT EXISTS idx_opportunity_chain_segments_opportunity
    ON opportunity_chain_segments (opportunity_id, segment_order);

CREATE INDEX IF NOT EXISTS idx_opportunity_chain_segments_lane
    ON opportunity_chain_segments (lane_id) WHERE lane_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opportunity_chain_segments_source
    ON opportunity_chain_segments (geometry_source, source_key);

CREATE INDEX IF NOT EXISTS idx_opportunity_chain_segments_geom
    ON opportunity_chain_segments USING GIST (geom);
