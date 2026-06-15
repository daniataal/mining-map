CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    storage_path TEXT NOT NULL,
    sha256 TEXT,
    uploaded_by UUID,
    entity_type TEXT,
    entity_id UUID,
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    title TEXT,
    commodity TEXT,
    quantity NUMERIC,
    quantity_unit TEXT,
    location_name TEXT,
    seller_name TEXT,
    buyer_name TEXT,
    incoterm TEXT,
    price NUMERIC,
    currency TEXT,
    status TEXT DEFAULT 'draft',
    verification_score NUMERIC(5,2),
    verification_result JSONB,
    claimed_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    claimed_vessel_id UUID REFERENCES vessels(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals(tenant_id, status);
