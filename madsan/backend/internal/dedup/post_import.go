package dedup

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostImportEnqueueCap limits high_confidence dedup pairs enqueued after each legacy_import run.
const PostImportEnqueueCap = 20

// EnqueueHighConfidenceAfterImport scans exact-name clusters and cross-name pairs at tier
// high_confidence only (score >= 85) and enqueues them for human merge review. No Splink runtime.
func EnqueueHighConfidenceAfterImport(ctx context.Context, pool *pgxpool.Pool, cap int) (CompanyEnqueueResult, error) {
	if cap <= 0 || cap > PostImportEnqueueCap {
		cap = PostImportEnqueueCap
	}
	var result CompanyEnqueueResult
	remaining := cap

	clusters, err := ListCompanyDuplicateClusters(ctx, pool, cap*2)
	if err != nil {
		return result, err
	}
	for _, c := range clusters {
		if remaining <= 0 {
			break
		}
		if c.ReviewTier != TierHighConfidence {
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"normalized_name": c.NormalizedName,
			"member_count":    c.Count,
			"members":         c.Members,
			"review_tier":     c.ReviewTier,
			"match_score":     c.MatchScore,
			"scoring_method":  "pairwise_trigram_v1",
			"pair_type":       "same_name_cluster",
			"trigger":         "legacy_import",
		})
		matches, _ := json.Marshal(c.Members)
		tag, err := pool.Exec(ctx, `
			INSERT INTO manual_review_queue (entity_type, reason, confidence_score, candidate_matches, raw_payload, status)
			SELECT 'company', 'duplicate_company', $1, $2, $3, 'pending'
			WHERE NOT EXISTS (
				SELECT 1 FROM manual_review_queue
				WHERE reason = 'duplicate_company' AND status = 'pending'
				  AND raw_payload->>'normalized_name' = $4
			)
		`, c.MatchScore, matches, payload, c.NormalizedName)
		if err != nil {
			return result, err
		}
		n := int(tag.RowsAffected())
		result.ExactNameEnqueued += n
		remaining -= n
	}

	if remaining <= 0 {
		return result, nil
	}

	crossEnqueued, err := enqueueHighConfidenceCrossNamePairs(ctx, pool, remaining)
	result.CrossNameEnqueued = crossEnqueued
	return result, err
}

func enqueueHighConfidenceCrossNamePairs(ctx context.Context, pool *pgxpool.Pool, cap int) (int, error) {
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
		if p.ReviewTier != TierHighConfidence {
			continue
		}
		payload := buildCrossNameEnqueuePayload(p)
		payload["trigger"] = "legacy_import"
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
