package intelligence

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/confidence"
)

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) WriteSignal(ctx context.Context, entityType string, entityID uuid.UUID, signalType, tier string, score float64, evidence map[string]any) error {
	b, _ := json.Marshal(evidence)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO core_signals (entity_type, entity_id, signal_type, tier, confidence_score, payload)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, entityType, entityID, signalType, tier, score, b)
	return err
}

func (s *Service) DetectDarkFleet(ctx context.Context, mmsi string, gapMinutes float64) (float64, error) {
	score := confidence.Score(20, map[string]bool{})
	if gapMinutes > 180 {
		score = confidence.Score(score, map[string]bool{"weak_single_source": true})
		score += 30
	}
	return score, nil
}
