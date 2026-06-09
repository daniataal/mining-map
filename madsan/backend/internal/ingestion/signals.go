package ingestion

import (
	"context"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/intelligence"
)

func (s *Service) persistImportSignals(ctx context.Context, rec NormalizedRecord, entityID uuid.UUID, evidenceCount int, score float64) {
	if entityID == uuid.Nil {
		return
	}
	inputs := make([]intelligence.EvidenceInput, 0, evidenceCount)
	for _, c := range claimsForRecord(rec) {
		inputs = append(inputs, intelligence.EvidenceInput{
			ClaimType: c.Type, ClaimValue: c.Value, Tier: c.Tier,
		})
	}
	_ = intelligence.PersistImportSnapshot(ctx, s.pool, entityID, intelligence.ImportSnapshot{
		EntityType: rec.EntityType, AssetType: rec.AssetType, Commodities: rec.Commodities,
		Evidence: inputs, EvidenceCount: evidenceCount, Confidence: score,
	})
}
