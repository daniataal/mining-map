CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    country_code TEXT,
    website TEXT,
    phone TEXT,
    email TEXT,
    registration_number TEXT,
    company_type TEXT,
    commodities TEXT[] DEFAULT '{}',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    data_quality_status TEXT DEFAULT 'unverified',
    last_verified_at TIMESTAMPTZ,
    raw_source_payload JSONB,
    legacy_table TEXT,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_norm ON companies(normalized_name);
CREATE INDEX IF NOT EXISTS idx_companies_country ON companies(country_code);
CREATE INDEX IF NOT EXISTS idx_companies_confidence ON companies(confidence_score);

CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT,
    phone TEXT,
    role TEXT,
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    evidence_snippet TEXT,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    verification_status TEXT DEFAULT 'unverified',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commodities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    commodity_group TEXT NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    unit TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geom GEOGRAPHY(Point, 4326),
    country_code TEXT,
    port_id UUID,
    operator_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    owner_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    commodities_supported TEXT[] DEFAULT '{}',
    capacity NUMERIC,
    capacity_unit TEXT,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    data_quality_status TEXT DEFAULT 'unverified',
    last_verified_at TIMESTAMPTZ,
    raw_source_payload JSONB,
    legacy_table TEXT,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_geom ON assets USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_country ON assets(country_code);
CREATE INDEX IF NOT EXISTS idx_assets_confidence ON assets(confidence_score);

CREATE TABLE IF NOT EXISTS vessels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    imo TEXT,
    mmsi TEXT UNIQUE,
    vessel_type TEXT,
    flag_country_code TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geom GEOGRAPHY(Point, 4326),
    destination TEXT,
    course DOUBLE PRECISION,
    speed_knots DOUBLE PRECISION,
    last_seen_at TIMESTAMPTZ,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    data_quality_status TEXT DEFAULT 'unverified',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vessels_geom ON vessels USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_vessels_imo ON vessels(imo);
CREATE INDEX IF NOT EXISTS idx_vessels_mmsi ON vessels(mmsi);

CREATE TABLE IF NOT EXISTS prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commodity_id UUID REFERENCES commodities(id) ON DELETE SET NULL,
    location_name TEXT,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    price NUMERIC,
    currency TEXT,
    unit TEXT,
    price_type TEXT,
    observed_at TIMESTAMPTZ,
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);
