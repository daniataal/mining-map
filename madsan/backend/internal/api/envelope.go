package api

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
)

func countEvidence(ctx context.Context, pool *pgxpool.Pool, entityType string, entityID uuid.UUID) int {
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM evidence WHERE entity_type = $1 AND entity_id = $2`, entityType, entityID).Scan(&n); err != nil {
		return 0
	}
	return n
}

func entityTier(confidence float64, evidenceCount int, lastSeen *time.Time, entityType string) string {
	if entityType == "vessel" {
		return vesselEntityTier(lastSeen, evidenceCount)
	}
	return intelligence.SupplierDiscoveryTier(confidence, evidenceCount)
}

func vesselEntityTier(lastSeen *time.Time, evidenceCount int) string {
	if lastSeen != nil {
		if time.Since(*lastSeen) < 72*time.Hour {
			return "observed"
		}
		return "inferred"
	}
	if evidenceCount >= 1 {
		return "inferred"
	}
	return "missing"
}

func latestObservedAt(explicit *time.Time, history []SignalHistoryEntry) *time.Time {
	if explicit != nil {
		return explicit
	}
	if len(history) == 0 {
		return nil
	}
	latest := history[0].ObservedAt
	for _, h := range history[1:] {
		if h.ObservedAt.After(latest) {
			latest = h.ObservedAt
		}
	}
	return &latest
}

func buildEntityEnvelope(resp CoreEntityResponse, evidenceCount int, observedAt *time.Time, lastSeen *time.Time) EntityEnvelope {
	obs := latestObservedAt(observedAt, resp.SignalHistory)
	if resp.EntityType == "vessel" && lastSeen != nil && (obs == nil || lastSeen.After(*obs)) {
		obs = lastSeen
	}
	return EntityEnvelope{
		ID: resp.ID, EntityType: resp.EntityType, Confidence: resp.Confidence.Score,
		Tier: entityTier(resp.Confidence.Score, evidenceCount, lastSeen, resp.EntityType),
		EvidenceCount: evidenceCount, ObservedAt: obs, Limitations: resp.Limitations,
	}
}

func (s *Server) attachEntityEnvelope(ctx context.Context, resp *CoreEntityResponse, uid uuid.UUID, observedAt *time.Time, lastSeen *time.Time) {
	resp.Envelope = buildEntityEnvelope(*resp, countEvidence(ctx, s.pool, resp.EntityType, uid), observedAt, lastSeen)
}
