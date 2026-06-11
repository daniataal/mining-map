-- Deal playground: user-built deal graphs on the map (nodes + links) with
-- per-node due-diligence state, layered on the existing deals table.
CREATE TABLE IF NOT EXISTS deal_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'custom', -- supplier | buyer | facility | vessel | transport | custom
    ref_entity_type TEXT,                -- company | asset | vessel (NULL for custom nodes)
    ref_entity_id UUID,
    name TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    dd_status TEXT NOT NULL DEFAULT 'pending', -- pending | in_review | verified | rejected
    dd_notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_nodes_deal_idx ON deal_nodes (deal_id);

CREATE TABLE IF NOT EXISTS deal_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    from_node UUID NOT NULL REFERENCES deal_nodes(id) ON DELETE CASCADE,
    to_node UUID NOT NULL REFERENCES deal_nodes(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'supply', -- supply | transport | storage | sale | finance
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_links_deal_idx ON deal_links (deal_id);

-- Storage inventory estimates: tank-farm sites clustered from OSM tank points,
-- with capacity and inventory ranges derived from open data (OSM density +
-- EIA regional utilization). Honest tiers only — never presented as measured.
CREATE TABLE IF NOT EXISTS storage_site_estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_key TEXT NOT NULL UNIQUE,       -- cluster fingerprint
    name TEXT,
    country_code TEXT,
    tank_count INT NOT NULL,
    centroid_lat DOUBLE PRECISION NOT NULL,
    centroid_lon DOUBLE PRECISION NOT NULL,
    geom GEOGRAPHY(POINT, 4326),
    capacity_bbl_low NUMERIC,
    capacity_bbl_high NUMERIC,
    fill_rate_low NUMERIC,
    fill_rate_high NUMERIC,
    fill_rate_source TEXT,
    inventory_bbl_low NUMERIC,
    inventory_bbl_high NUMERIC,
    method TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'inferred', -- inferred | low
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_site_estimates_gix ON storage_site_estimates USING GIST (geom);
