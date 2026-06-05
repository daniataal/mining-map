CREATE TABLE IF NOT EXISTS port_manifests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_imo TEXT NOT NULL,
    vessel_name TEXT,
    load_port TEXT,
    discharge_port TEXT,
    cargo_type TEXT,
    quantity_tons NUMERIC,
    departure_time TIMESTAMPTZ,
    arrival_time TIMESTAMPTZ,
    provider TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_port_manifests_vessel_imo ON port_manifests (vessel_imo);
CREATE INDEX IF NOT EXISTS idx_port_manifests_created_at ON port_manifests (created_at DESC);
