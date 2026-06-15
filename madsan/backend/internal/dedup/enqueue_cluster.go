package dedup

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	EntityTypeDedupMerge = "dedup_merge"
	ReasonDedupMerge     = "dedup_merge"
)

var (
	ErrClusterNotFound = errors.New("duplicate cluster not found")
	ErrTierNotEligible = errors.New("only high_confidence clusters can be enqueued for merge review")
)

// ClusterEnqueueResult is returned when a single cluster is queued for human merge review.
type ClusterEnqueueResult struct {
	Enqueued   bool   `json:"enqueued"`
	QueueID    string `json:"queue_id,omitempty"`
	ReviewTier string `json:"review_tier,omitempty"`
	Message    string `json:"message,omitempty"`
}

// GetCompanyClusterByNormalizedName loads one same-name duplicate cluster.
func GetCompanyClusterByNormalizedName(ctx context.Context, pool *pgxpool.Pool, normalizedName string) (*CompanyCluster, error) {
	if normalizedName == "" {
		return nil, ErrClusterNotFound
	}
	var norm string
	var count int
	var membersJSON []byte
	err := pool.QueryRow(ctx, `
		SELECT normalized_name, COUNT(*)::int,
		       json_agg(json_build_object(
		         'id', id::text,
		         'name', name,
		         'country_code', COALESCE(country_code,''),
		         'confidence_score', confidence_score
		       ) ORDER BY confidence_score DESC NULLS LAST) AS members
		FROM companies
		WHERE normalized_name = $1
		GROUP BY normalized_name
		HAVING COUNT(*) > 1
	`, normalizedName).Scan(&norm, &count, &membersJSON)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrClusterNotFound
		}
		return nil, err
	}
	var members []CompanyMember
	_ = json.Unmarshal(membersJSON, &members)
	score := scoreCluster(members)
	cluster := &CompanyCluster{
		NormalizedName: norm,
		Count:          count,
		Members:        members,
		MatchScore:     score,
		ReviewTier:     PairTierLabel(score),
	}
	return cluster, nil
}

func buildClusterMergeReviewPayload(c CompanyCluster) map[string]any {
	return map[string]any{
		"normalized_name": c.NormalizedName,
		"member_count":    c.Count,
		"members":         c.Members,
		"review_tier":     c.ReviewTier,
		"match_score":     c.MatchScore,
		"scoring_method":  "pairwise_trigram_v1",
		"pair_type":       "same_name_cluster",
	}
}

func clusterMergeReviewEligible(c CompanyCluster) bool {
	return c.ReviewTier == TierHighConfidence
}

// EnqueueCompanyClusterMergeReview queues one high_confidence cluster for human merge review.
// No auto-merge — analyst must resolve via review queue.
func EnqueueCompanyClusterMergeReview(ctx context.Context, pool *pgxpool.Pool, normalizedName string) (ClusterEnqueueResult, error) {
	cluster, err := GetCompanyClusterByNormalizedName(ctx, pool, normalizedName)
	if err != nil {
		return ClusterEnqueueResult{}, err
	}
	if !clusterMergeReviewEligible(*cluster) {
		return ClusterEnqueueResult{ReviewTier: cluster.ReviewTier}, ErrTierNotEligible
	}

	payload := buildClusterMergeReviewPayload(*cluster)
	payloadJSON, _ := json.Marshal(payload)
	matches, _ := json.Marshal(cluster.Members)

	var queueID uuid.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO manual_review_queue (entity_type, reason, confidence_score, candidate_matches, raw_payload, status)
		SELECT $1, $2, $3, $4, $5, 'pending'
		WHERE NOT EXISTS (
			SELECT 1 FROM manual_review_queue
			WHERE status = 'pending'
			  AND raw_payload->>'normalized_name' = $6
			  AND (entity_type = $1 OR reason IN ($2, 'duplicate_company'))
		)
		RETURNING id
	`, EntityTypeDedupMerge, ReasonDedupMerge, cluster.MatchScore, matches, payloadJSON, cluster.NormalizedName).Scan(&queueID)
	if err != nil {
		// No row inserted — already pending.
		var existing uuid.UUID
		findErr := pool.QueryRow(ctx, `
			SELECT id FROM manual_review_queue
			WHERE status = 'pending'
			  AND raw_payload->>'normalized_name' = $1
			  AND (entity_type = $2 OR reason IN ($3, 'duplicate_company'))
			LIMIT 1
		`, cluster.NormalizedName, EntityTypeDedupMerge, ReasonDedupMerge).Scan(&existing)
		if findErr != nil {
			return ClusterEnqueueResult{}, err
		}
		return ClusterEnqueueResult{
			Enqueued:   false,
			QueueID:    existing.String(),
			ReviewTier: cluster.ReviewTier,
			Message:    "cluster already pending in review queue",
		}, nil
	}

	return ClusterEnqueueResult{
		Enqueued:   true,
		QueueID:    queueID.String(),
		ReviewTier: cluster.ReviewTier,
	}, nil
}

// IsMergeReviewReason reports whether a queue row supports merge/dismiss dedup actions.
func IsMergeReviewReason(reason string) bool {
	return reason == ReasonDedupMerge || reason == "duplicate_company"
}
