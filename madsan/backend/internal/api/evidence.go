package api

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func loadEvidence(ctx context.Context, pool *pgxpool.Pool, entityType string, entityID uuid.UUID) ([]EvidenceClaim, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.source_name, e.claim_type, COALESCE(e.claim_value,''), e.confidence_score, COALESCE(e.tier,'')
		FROM evidence e
		JOIN sources s ON s.id = e.source_id
		WHERE e.entity_type = $1 AND e.entity_id = $2
		ORDER BY e.confidence_score DESC, e.claim_type
		LIMIT 25
	`, entityType, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EvidenceClaim
	for rows.Next() {
		var ec EvidenceClaim
		if err := rows.Scan(&ec.SourceName, &ec.ClaimType, &ec.ClaimValue, &ec.ConfidenceScore, &ec.Tier); err != nil {
			return nil, err
		}
		out = append(out, ec)
	}
	return out, rows.Err()
}
