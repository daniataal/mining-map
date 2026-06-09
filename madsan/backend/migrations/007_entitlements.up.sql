CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    feature_key TEXT NOT NULL,
    quota_limit INT,
    UNIQUE(plan_id, feature_key)
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status TEXT DEFAULT 'active',
    started_at TIMESTAMPTZ DEFAULT now(),
    ends_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS entitlement_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    feature_key TEXT NOT NULL,
    allowed BOOLEAN NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key TEXT NOT NULL UNIQUE,
    enabled BOOLEAN DEFAULT false,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    feature_key TEXT NOT NULL,
    quantity INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO plans (slug, display_name) VALUES
    ('free', 'Free'),
    ('pro', 'Professional'),
    ('enterprise', 'Enterprise')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, quota_limit)
SELECT p.id, f.feature_key, f.quota
FROM plans p
CROSS JOIN (VALUES
    ('deal_verification', 5),
    ('map_premium_layers', NULL),
    ('supplier_discovery', 50),
    ('deal_pack_export', 3),
    ('api_access', 1000)
) AS f(feature_key, quota)
WHERE p.slug = 'free'
ON CONFLICT DO NOTHING;
