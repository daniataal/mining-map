package opportunity

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BatchRescoreOpenOpportunities refreshes deal_score and signal_json for open opportunities (MAD-4x-g).
func BatchRescoreOpenOpportunities(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT o.id::text, o.title, o.opportunity_type, o.confidence::float8,
			o.hypothesis, COALESCE(o.signal_json, '{}'::jsonb)
		FROM oil_opportunities o
		WHERE o.status = 'open'
		ORDER BY o.updated_at DESC NULLS LAST
		LIMIT 500
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	updated := 0
	for rows.Next() {
		var id, title, oppType, hypothesis string
		var confidence float64
		var existing []byte
		if err := rows.Scan(&id, &title, &oppType, &confidence, &hypothesis, &existing); err != nil {
			return updated, err
		}
		macroSupport := 0.35
		if confidence >= 0.65 {
			macroSupport = 0.55
		}
		in := DealScoreInput{
			MovementActivity:    clamp01(confidence * 0.9),
			InfrastructureFit: 0.45,
			CounterpartyClarity: clamp01(confidence * 0.7),
			MacroSupport:        macroSupport,
			RouteReadiness:      0.5,
			Provenance:          0.6,
		}
		score := ScoreDeal(in)
		if score < confidence {
			score = confidence
		}
		evidence := []string{hypothesis}
		if title != "" {
			evidence = append(evidence, title)
		}
		sig := signalPayload(
			oppType,
			in,
			"",
			evidence,
			nil,
			nil,
		)
		sig["batch_rescore"] = true
		sigBytes, _ := json.Marshal(sig)
		tag, err := pool.Exec(ctx, `
			UPDATE oil_opportunities
			SET deal_score = $2,
				signal_json = COALESCE(signal_json, '{}'::jsonb) || $3::jsonb,
				source_tiers = $4,
				updated_at = now()
			WHERE id = $1::uuid AND status = 'open'
		`, id, score, sigBytes, sourceTiers("synthetic", "inferred"))
		if err != nil {
			return updated, err
		}
		if tag.RowsAffected() > 0 {
			updated++
		}
	}
	return updated, rows.Err()
}
