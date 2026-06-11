-- STS accuracy upgrade: port/anchorage context and spatial pair-prediction serving.

CREATE TABLE IF NOT EXISTS maritime_context_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'gfw_anchorages',
    source_id TEXT NOT NULL,
    name TEXT,
    context_type TEXT NOT NULL DEFAULT 'anchorage',
    port_group_id TEXT,
    port_name TEXT,
    country_code TEXT,
    radius_m DOUBLE PRECISION DEFAULT 3000,
    confidence NUMERIC(5,2) DEFAULT 0.75,
    geom GEOGRAPHY(Geometry, 4326) NOT NULL,
    metadata JSONB DEFAULT '{}',
    imported_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_maritime_context_zones_geom
    ON maritime_context_zones USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_maritime_context_zones_type
    ON maritime_context_zones (context_type, source);

CREATE INDEX IF NOT EXISTS idx_maritime_context_zones_port_group
    ON maritime_context_zones (port_group_id)
    WHERE port_group_id IS NOT NULL;

ALTER TABLE predictive_signals
    ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(Point, 4326),
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_predictive_signals_geom
    ON predictive_signals USING GIST (geom);
