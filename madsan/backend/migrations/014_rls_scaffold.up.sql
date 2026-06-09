-- Phase 12d: Postgres RLS scaffold (non-breaking).
-- Go API today connects as table owner (postgres) and bypasses RLS until FORCE + dedicated role cutover.
-- See madsan/agent_reports/madsan_v2_launch_checklist.md §2 and policy sketches below.

COMMENT ON SCHEMA public IS
    'MadSan V2 public schema. Tenant isolation: app-layer tenant_id FKs (006/007); '
    'RLS cutover starts on usage_events (014). Map/search intelligence tables remain shared until Phase 12d+ review.';

-- Session GUC read by future policies: SET app.tenant_id = '<uuid>' per request.
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
        SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
    $$;

COMMENT ON FUNCTION app_current_tenant_id() IS
    'Returns app.tenant_id session GUC as UUID. Used by RLS policies after madsan_rls role cutover.';

-- Future restricted DB role (not granted to Go API yet).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madsan_rls') THEN
        CREATE ROLE madsan_rls NOLOGIN;
    END IF;
END
$$;

COMMENT ON ROLE madsan_rls IS
    'Placeholder for tenant-scoped DB sessions. Deny-by-default on usage_events until policies are replaced and API uses this role.';

-- Lowest-risk tenant table: append-only audit (INSERT only in entitlements resolver; no reads yet).
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE usage_events IS
    'Per-tenant feature usage audit. RLS enabled (014). Owner bypasses until FORCE RLS + madsan_rls cutover. '
    'Target policy: tenant_id IS NOT DISTINCT FROM app_current_tenant_id().';

-- Deny-by-default stub for madsan_rls only; inert while API uses postgres owner.
CREATE POLICY usage_events_deny_default ON usage_events
    AS RESTRICTIVE
    FOR ALL
    TO madsan_rls
    USING (false);

COMMENT ON POLICY usage_events_deny_default ON usage_events IS
    'Scaffold: blocks madsan_rls until replaced with tenant_id = app_current_tenant_id(). Does not affect postgres owner.';

-- Policy sketches for later migrations (not applied):
COMMENT ON TABLE memberships IS
    'RLS sketch (deferred): USING (tenant_id = app_current_tenant_id()). Membership is tenant-scoped; cutover after deals/documents.';
COMMENT ON TABLE tenant_subscriptions IS
    'RLS sketch (deferred): USING (tenant_id = app_current_tenant_id()).';
COMMENT ON TABLE entitlement_overrides IS
    'RLS sketch (deferred): USING (tenant_id IS NOT DISTINCT FROM app_current_tenant_id() OR tenant_id IS NULL).';
COMMENT ON TABLE deals IS
    'RLS sketch (deferred): USING (tenant_id IS NOT DISTINCT FROM app_current_tenant_id()). Requires JWT tenant in all deal queries.';
COMMENT ON TABLE documents IS
    'RLS sketch (deferred): USING (tenant_id IS NOT DISTINCT FROM app_current_tenant_id()).';
COMMENT ON TABLE companies IS
    'RLS sketch (deferred, high-risk): nullable tenant_id — global map/search rows must stay visible; policy likely '
    '(tenant_id IS NULL OR tenant_id = app_current_tenant_id()) with careful API audit before ENABLE.';
