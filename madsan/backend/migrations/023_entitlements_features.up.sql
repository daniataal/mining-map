-- Extend plan_features for supplier portal, deal watch, and paid tiers (mechanism only; billing deferred).

INSERT INTO plan_features (plan_id, feature_key, quota_limit)
SELECT p.id, f.feature_key, f.quota
FROM plans p
CROSS JOIN (VALUES
    ('supplier_portal', 10),
    ('deal_watch', 5)
) AS f(feature_key, quota)
WHERE p.slug = 'free'
ON CONFLICT DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, quota_limit)
SELECT p.id, f.feature_key, f.quota
FROM plans p
CROSS JOIN (VALUES
    ('deal_verification', NULL),
    ('deal_pack_export', NULL),
    ('deal_watch', NULL),
    ('map_premium_layers', NULL),
    ('supplier_discovery', NULL),
    ('supplier_portal', NULL),
    ('api_access', NULL)
) AS f(feature_key, quota)
WHERE p.slug IN ('pro', 'enterprise')
ON CONFLICT DO NOTHING;
