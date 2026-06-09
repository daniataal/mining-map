ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS source_slug TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS result_report JSONB;

ALTER TABLE sources ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
UPDATE sources SET slug = lower(regexp_replace(source_name, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_watch_deal_user ON deal_watch_subscriptions(deal_id, user_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    user_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    scopes TEXT[] DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
