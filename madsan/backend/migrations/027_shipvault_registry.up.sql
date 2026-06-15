-- ShipVault bulk registry: name history, owner companies, yards (offline batch ingest).

CREATE TABLE IF NOT EXISTS vessel_name_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id UUID REFERENCES vessels(id) ON DELETE CASCADE,
    mmsi TEXT NOT NULL,
    imo TEXT,
    seq INT NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    from_date TEXT,
    to_date TEXT,
    disponent TEXT,
    source TEXT NOT NULL DEFAULT 'shipvault',
    tier TEXT NOT NULL DEFAULT 'observed',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_payload JSONB DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessel_name_history_mmsi_seq ON vessel_name_history(mmsi, seq);
CREATE INDEX IF NOT EXISTS idx_vessel_name_history_vessel_id ON vessel_name_history(vessel_id);
CREATE INDEX IF NOT EXISTS idx_vessel_name_history_imo ON vessel_name_history(imo) WHERE imo IS NOT NULL;

CREATE TABLE IF NOT EXISTS shipvault_companies (
    shipvault_company_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT,
    city TEXT,
    parent_name TEXT,
    parent_company_id TEXT,
    fleet_size INT,
    total_dwt NUMERIC,
    total_gt NUMERIC,
    avg_age_years NUMERIC,
    fleet_list JSONB NOT NULL DEFAULT '[]'::jsonb,
    madsan_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'shipvault',
    tier TEXT NOT NULL DEFAULT 'observed',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stale_after TIMESTAMPTZ NOT NULL DEFAULT now() + interval '180 days',
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipvault_companies_stale ON shipvault_companies(stale_after);
CREATE INDEX IF NOT EXISTS idx_shipvault_companies_madsan_company ON shipvault_companies(madsan_company_id)
    WHERE madsan_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS shipvault_yards (
    shipvault_yard_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT,
    location TEXT,
    vessels_built JSONB NOT NULL DEFAULT '[]'::jsonb,
    source TEXT NOT NULL DEFAULT 'shipvault',
    tier TEXT NOT NULL DEFAULT 'observed',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stale_after TIMESTAMPTZ NOT NULL DEFAULT now() + interval '180 days',
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipvault_yards_stale ON shipvault_yards(stale_after);

CREATE TABLE IF NOT EXISTS vessel_yard_links (
    mmsi TEXT NOT NULL,
    vessel_id UUID REFERENCES vessels(id) ON DELETE CASCADE,
    imo TEXT,
    shipvault_yard_id TEXT NOT NULL REFERENCES shipvault_yards(shipvault_yard_id) ON DELETE CASCADE,
    yard_number TEXT,
    build_year INT,
    source TEXT NOT NULL DEFAULT 'shipvault',
    tier TEXT NOT NULL DEFAULT 'observed',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (mmsi, shipvault_yard_id)
);

CREATE INDEX IF NOT EXISTS idx_vessel_yard_links_vessel_id ON vessel_yard_links(vessel_id);
CREATE INDEX IF NOT EXISTS idx_vessel_yard_links_yard ON vessel_yard_links(shipvault_yard_id);

COMMENT ON TABLE vessel_name_history IS 'Precomputed ShipVault vessel name history; populated by vessel-enrich batch only.';
COMMENT ON TABLE shipvault_companies IS 'ShipVault owner/manager company pages (fleet aggregates); batch ingest.';
COMMENT ON TABLE shipvault_yards IS 'ShipVault shipyard pages; batch ingest.';
COMMENT ON TABLE vessel_yard_links IS 'Vessel built-at yard linkage from ShipVault detail.';
