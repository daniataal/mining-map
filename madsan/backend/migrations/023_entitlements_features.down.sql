DELETE FROM plan_features
WHERE feature_key IN ('supplier_portal', 'deal_watch')
  AND plan_id IN (SELECT id FROM plans WHERE slug IN ('free', 'pro', 'enterprise'));
