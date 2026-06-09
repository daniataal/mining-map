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

type STSScoreInput struct {
	DistanceM      float64 `json:"distance_m"`
	DurationMin    float64 `json:"duration_min"`
	SpeedDelta     float64 `json:"speed_delta"`
	FlagMismatch   bool    `json:"flag_mismatch"`
	AISGapMinutes  float64 `json:"ais_gap_minutes"`
	SanctionsHit   bool    `json:"sanctions_hit"`
}

// ScoreSTS applies 6-factor weighted STS detection score (0-100).
func ScoreSTS(in STSScoreInput) float64 {
	base := 30.0
	if in.DistanceM < 500 {
		base += 25
	}
	if in.DurationMin > 30 {
		base += 15
	}
	if in.SpeedDelta < 2 {
		base += 10
	}
	if in.FlagMismatch {
		base += 10
	}
	if in.AISGapMinutes > 60 {
		base += 15
	}
	signals := map[string]bool{"sanctions_risk": in.SanctionsHit}
	return confidence.Score(base, signals)
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
