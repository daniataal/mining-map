CREATE TABLE IF NOT EXISTS core_source_ledger (
    source_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    license_name TEXT,
    terms_url TEXT,
    attribution TEXT,
    commercial_use_ok BOOLEAN NOT NULL DEFAULT true,
    enabled BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_core_source_ledger_commercial ON core_source_ledger (commercial_use_ok) WHERE enabled = true;
INSERT INTO core_source_ledger (source_key, display_name, source_type, license_name, terms_url, attribution, commercial_use_ok) VALUES
 ('eia','U.S. EIA','official_api','U.S. public domain','https://www.eia.gov/about/copyrights_reuse.php','Source: U.S. EIA',true),
 ('osm_petroleum','OSM petroleum','overpass_snapshot','ODbL','https://www.openstreetmap.org/copyright','© OSM contributors',true),
 ('opensanctions','OpenSanctions','public_api','OpenSanctions terms',NULL,'Data from OpenSanctions',true),
 ('global_fishing_watch','Global Fishing Watch','research_api','GFW non-commercial','https://globalfishingwatch.org/terms-of-use/','Data © GFW',false),
 ('bunker_suppliers_seed','Bunker suppliers seed','curated_json','internal_seed',NULL,'MadSan seed',true)
ON CONFLICT (source_key) DO UPDATE SET commercial_use_ok = EXCLUDED.commercial_use_ok, updated_at = now();
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_method TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_path TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created ON audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
