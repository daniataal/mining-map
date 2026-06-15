package entitlements

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AllFeatures is the canonical gated capability list (plan + overrides + flags).
var AllFeatures = []string{
	"deal_verification",
	"deal_pack_export",
	"deal_watch",
	"map_premium_layers",
	"supplier_discovery",
	"supplier_portal",
	"api_access",
}

type Resolver struct {
	pool                  *pgxpool.Pool
	grantMapPremiumLayers bool
}

type QuotaStatus struct {
	Allowed    bool   `json:"allowed"`
	FeatureKey string `json:"feature_key"`
	PlanSlug   string `json:"plan_slug,omitempty"`
	Used       int    `json:"used"`
	Limit      *int   `json:"limit,omitempty"`
	Remaining  *int   `json:"remaining,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

func New(pool *pgxpool.Pool, grantMapPremiumLayers bool) *Resolver {
	return &Resolver{pool: pool, grantMapPremiumLayers: grantMapPremiumLayers}
}

// Can returns whether tenant/user may use feature_key.
func (r *Resolver) Can(ctx context.Context, tenantID, userID *uuid.UUID, featureKey string) (bool, error) {
	if r.grantMapPremiumLayers && featureKey == "map_premium_layers" {
		return true, nil
	}
	if tenantID == nil {
		return false, nil
	}
	if r.pool == nil {
		return false, nil
	}
	var override *bool
	_ = r.pool.QueryRow(ctx, `
		SELECT allowed FROM entitlement_overrides
		WHERE feature_key = $1 AND (tenant_id = $2 OR user_id = $3)
		ORDER BY user_id NULLS LAST LIMIT 1
	`, featureKey, tenantID, userID).Scan(&override)
	if override != nil {
		return *override, nil
	}
	var enabled bool
	err := r.pool.QueryRow(ctx, `SELECT COALESCE(enabled, false) FROM feature_flags WHERE flag_key = $1`, featureKey).Scan(&enabled)
	if err == nil && !enabled {
		return false, nil
	}
	var hasFeature bool
	err = r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM tenant_subscriptions ts
			JOIN plan_features pf ON pf.plan_id = ts.plan_id
			WHERE ts.tenant_id = $1 AND ts.status = 'active' AND pf.feature_key = $2
		)
	`, tenantID, featureKey).Scan(&hasFeature)
	if err != nil {
		return false, err
	}
	if hasFeature {
		return true, nil
	}
	// Default: free plan features only if subscribed to free
	var freeHas bool
	_ = r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM tenant_subscriptions ts
			JOIN plans p ON p.id = ts.plan_id
			JOIN plan_features pf ON pf.plan_id = p.id
			WHERE ts.tenant_id = $1 AND p.slug = 'free' AND pf.feature_key = $2
		)
	`, tenantID, featureKey).Scan(&freeHas)
	return freeHas, nil
}

func (r *Resolver) Check(ctx context.Context, tenantID, userID *uuid.UUID, featureKey string, qty int) (QuotaStatus, error) {
	if qty <= 0 {
		qty = 1
	}
	status := QuotaStatus{FeatureKey: featureKey}
	if r.grantMapPremiumLayers && featureKey == "map_premium_layers" {
		status.Allowed = true
		status.Reason = "dev_grant"
		return status, nil
	}
	if tenantID == nil {
		status.Reason = "missing_tenant"
		return status, nil
	}
	if r.pool == nil {
		status.Reason = "resolver_unavailable"
		return status, nil
	}

	allowed, err := r.Can(ctx, tenantID, userID, featureKey)
	if err != nil {
		return status, err
	}
	if !allowed {
		status.Reason = "not_entitled"
		return status, nil
	}

	var quota *int
	err = r.pool.QueryRow(ctx, `
		SELECT p.slug, pf.quota_limit
		FROM tenant_subscriptions ts
		JOIN plans p ON p.id = ts.plan_id
		JOIN plan_features pf ON pf.plan_id = p.id AND pf.feature_key = $2
		WHERE ts.tenant_id = $1 AND ts.status = 'active'
		ORDER BY ts.started_at DESC NULLS LAST
		LIMIT 1
	`, tenantID, featureKey).Scan(&status.PlanSlug, &quota)
	if err != nil && err != pgx.ErrNoRows {
		return status, err
	}
	if err == pgx.ErrNoRows || quota == nil {
		status.Allowed = true
		return status, nil
	}

	status.Limit = quota
	err = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(quantity), 0)::int
		FROM usage_events
		WHERE tenant_id = $1
		  AND feature_key = $2
		  AND created_at >= date_trunc('month', now())
	`, tenantID, featureKey).Scan(&status.Used)
	if err != nil {
		return status, err
	}
	remaining := *quota - status.Used
	if remaining < 0 {
		remaining = 0
	}
	status.Remaining = &remaining
	if status.Used+qty > *quota {
		status.Reason = "quota_exceeded"
		return status, nil
	}
	remaining = *quota - status.Used - qty
	if remaining < 0 {
		remaining = 0
	}
	status.Remaining = &remaining
	status.Allowed = true
	return status, nil
}

// Resolve returns per-feature access and the active plan slug for a tenant/user.
func (r *Resolver) Resolve(ctx context.Context, tenantID, userID *uuid.UUID) (map[string]bool, string, error) {
	out := make(map[string]bool, len(AllFeatures))
	var planSlug string
	if tenantID != nil {
		_ = r.pool.QueryRow(ctx, `
			SELECT p.slug FROM tenant_subscriptions ts
			JOIN plans p ON p.id = ts.plan_id
			WHERE ts.tenant_id = $1 AND ts.status = 'active'
			ORDER BY ts.started_at DESC NULLS LAST LIMIT 1
		`, tenantID).Scan(&planSlug)
	}
	for _, key := range AllFeatures {
		ok, err := r.Can(ctx, tenantID, userID, key)
		if err != nil {
			return nil, planSlug, err
		}
		out[key] = ok
	}
	return out, planSlug, nil
}

func (r *Resolver) RecordUsage(ctx context.Context, tenantID, userID *uuid.UUID, featureKey string, qty int) error {
	if qty <= 0 {
		qty = 1
	}
	if r == nil || r.pool == nil {
		return nil
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO usage_events (tenant_id, user_id, feature_key, quantity) VALUES ($1,$2,$3,$4)
	`, tenantID, userID, featureKey, qty)
	return err
}
