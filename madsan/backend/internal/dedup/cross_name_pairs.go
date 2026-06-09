package dedup

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultTrgmSimilarityThreshold is the pg_trgm similarity floor for cross-name pair discovery.
const DefaultTrgmSimilarityThreshold = 0.6

// DefaultCrossNameEnqueueCap limits cross-name pairs enqueued per scan/export run.
const DefaultCrossNameEnqueueCap = 50

// ListCrossNameDuplicatePairs finds unordered company pairs with different normalized_name
// but pg_trgm similarity >= threshold, filtered to same-or-missing country.
// Each pair is rescored with ScoreCompanyPair for tier alignment with cluster exports.
func ListCrossNameDuplicatePairs(ctx context.Context, pool *pgxpool.Pool, similarityThreshold float64, limit int) ([]CompanyPair, error) {
	if similarityThreshold <= 0 || similarityThreshold > 1 {
		similarityThreshold = DefaultTrgmSimilarityThreshold
	}
	if limit <= 0 || limit > 5000 {
		limit = 200
	}

	rows, err := pool.Query(ctx, `
		WITH trgm AS (
		  SELECT set_config('pg_trgm.similarity_threshold', $1::text, true)
		)
		SELECT
		  a.id::text, a.name, COALESCE(a.country_code, ''), a.confidence_score, a.normalized_name,
		  b.id::text, b.name, COALESCE(b.country_code, ''), b.confidence_score, b.normalized_name,
		  similarity(a.normalized_name, b.normalized_name) AS trgm_sim
		FROM trgm, companies a
		JOIN companies b ON a.id < b.id
		WHERE a.normalized_name <> b.normalized_name
		  AND a.normalized_name % b.normalized_name
		  AND similarity(a.normalized_name, b.normalized_name) >= $2::float8
		  AND (
		    a.country_code IS NULL OR b.country_code IS NULL
		    OR a.country_code = b.country_code
		  )
		ORDER BY trgm_sim DESC
		LIMIT $3
	`, fmt.Sprintf("%f", similarityThreshold), similarityThreshold, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CompanyPair
	for rows.Next() {
		var left, right CompanyMember
		var leftNorm, rightNorm string
		var trgmSim float64
		if err := rows.Scan(
			&left.ID, &left.Name, &left.CountryCode, &left.ConfidenceScore, &leftNorm,
			&right.ID, &right.Name, &right.CountryCode, &right.ConfidenceScore, &rightNorm,
			&trgmSim,
		); err != nil {
			continue
		}
		out = append(out, buildScoredCrossNamePair(left, right, leftNorm, rightNorm))
	}
	return out, rows.Err()
}

func buildScoredCrossNamePair(left, right CompanyMember, leftNorm, rightNorm string) CompanyPair {
	pairScore := ScoreCompanyPair(left, right)
	return CompanyPair{
		NormalizedName: crossNamePairLabel(leftNorm, rightNorm),
		MatchScore:     pairScore,
		ReviewTier:     PairTierLabel(pairScore),
		Left:           left,
		Right:          right,
	}
}

func crossNamePairLabel(leftNorm, rightNorm string) string {
	if leftNorm == rightNorm {
		return leftNorm
	}
	return fmt.Sprintf("%s|%s", leftNorm, rightNorm)
}

// crossNameCountryEligible mirrors the SQL country filter for unit tests.
func crossNameCountryEligible(countryA, countryB string) bool {
	countryA = strings.TrimSpace(countryA)
	countryB = strings.TrimSpace(countryB)
	if countryA == "" || countryB == "" {
		return true
	}
	return strings.EqualFold(countryA, countryB)
}

// EnqueueCrossNameDuplicatePairs adds high_confidence/manual_review cross-name pairs to manual_review_queue.
func EnqueueCrossNameDuplicatePairs(ctx context.Context, pool *pgxpool.Pool, cap int) (int, error) {
	if cap <= 0 || cap > DefaultCrossNameEnqueueCap {
		cap = DefaultCrossNameEnqueueCap
	}
	discoveryLimit := cap * 4
	if discoveryLimit < 200 {
		discoveryLimit = 200
	}
	pairs, err := ListCrossNameDuplicatePairs(ctx, pool, DefaultTrgmSimilarityThreshold, discoveryLimit)
	if err != nil {
		return 0, err
	}
	var enqueued int
	for _, p := range pairs {
		if enqueued >= cap {
			break
		}
		if !crossNameEnqueueEligible(p) {
			continue
		}
		payload := buildCrossNameEnqueuePayload(p)
		payloadJSON, _ := json.Marshal(payload)
		members := []CompanyMember{p.Left, p.Right}
		matches, _ := json.Marshal(members)
		pairKey := crossNamePairKey(p.Left.ID, p.Right.ID)
		tag, err := pool.Exec(ctx, `
			INSERT INTO manual_review_queue (entity_type, reason, confidence_score, candidate_matches, raw_payload, status)
			SELECT 'company', 'duplicate_company', $1, $2, $3, 'pending'
			WHERE NOT EXISTS (
				SELECT 1 FROM manual_review_queue
				WHERE reason = 'duplicate_company' AND status = 'pending'
				  AND raw_payload->>'pair_key' = $4
			)
		`, p.MatchScore, matches, payloadJSON, pairKey)
		if err != nil {
			return enqueued, err
		}
		enqueued += int(tag.RowsAffected())
	}
	return enqueued, nil
}

func crossNameEnqueueEligible(p CompanyPair) bool {
	return p.MatchScore >= 60 && p.ReviewTier != TierSkip
}

func buildCrossNameEnqueuePayload(p CompanyPair) map[string]any {
	return map[string]any{
		"pair_type":       "cross_name",
		"pair_key":        crossNamePairKey(p.Left.ID, p.Right.ID),
		"left_id":         p.Left.ID,
		"right_id":        p.Right.ID,
		"normalized_name": p.NormalizedName,
		"members":         []CompanyMember{p.Left, p.Right},
		"review_tier":     p.ReviewTier,
		"match_score":     p.MatchScore,
		"scoring_method":  "cross_name_trgm_v1",
	}
}

func crossNamePairKey(leftID, rightID string) string {
	if leftID > rightID {
		leftID, rightID = rightID, leftID
	}
	return leftID + "|" + rightID
}
