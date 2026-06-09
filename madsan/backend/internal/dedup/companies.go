package dedup

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CompanyMember struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	CountryCode     string   `json:"country_code,omitempty"`
	ConfidenceScore *float64 `json:"confidence_score,omitempty"`
}

type CompanyCluster struct {
	NormalizedName string          `json:"normalized_name"`
	Count          int             `json:"count"`
	MatchScore     float64         `json:"match_score"`
	Members        []CompanyMember `json:"members"`
}

// ListCompanyDuplicateClusters finds companies sharing normalized_name (Splink-prep SQL pass).
func ListCompanyDuplicateClusters(ctx context.Context, pool *pgxpool.Pool, limit int) ([]CompanyCluster, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
		SELECT normalized_name, COUNT(*)::int,
		       json_agg(json_build_object(
		         'id', id::text,
		         'name', name,
		         'country_code', COALESCE(country_code,''),
		         'confidence_score', confidence_score
		       ) ORDER BY confidence_score DESC NULLS LAST) AS members
		FROM companies
		GROUP BY normalized_name
		HAVING COUNT(*) > 1
		ORDER BY COUNT(*) DESC, normalized_name
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CompanyCluster
	for rows.Next() {
		var norm string
		var count int
		var membersJSON []byte
		if rows.Scan(&norm, &count, &membersJSON) != nil {
			continue
		}
		var members []CompanyMember
		_ = json.Unmarshal(membersJSON, &members)
		out = append(out, CompanyCluster{
			NormalizedName: norm,
			Count:          count,
			Members:        members,
			MatchScore:     scoreCluster(members),
		})
	}
	return out, rows.Err()
}

func scoreCluster(members []CompanyMember) float64 {
	if len(members) < 2 {
		return 0
	}
	countries := map[string]bool{}
	for _, m := range members {
		if m.CountryCode != "" {
			countries[m.CountryCode] = true
		}
	}
	score := 88.0
	if len(countries) > 1 {
		score = 72.0
	}
	if len(members) > 5 {
		score -= 5
	}
	return score
}

// EnqueueCompanyDuplicates adds high-confidence duplicate clusters to manual_review_queue.
func EnqueueCompanyDuplicates(ctx context.Context, pool *pgxpool.Pool, limit int) (enqueued int, err error) {
	clusters, err := ListCompanyDuplicateClusters(ctx, pool, limit)
	if err != nil {
		return 0, err
	}
	for _, c := range clusters {
		if c.MatchScore < 60 {
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"normalized_name": c.NormalizedName,
			"member_count":    c.Count,
			"members":         c.Members,
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
			return enqueued, err
		}
		enqueued += int(tag.RowsAffected())
	}
	return enqueued, nil
}

// ClusterSummary returns counts for admin dashboard.
func ClusterSummary(ctx context.Context, pool *pgxpool.Pool) (clusterCount int, extraRows int, err error) {
	err = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int, COALESCE(SUM(cnt - 1), 0)::int FROM (
			SELECT COUNT(*)::int AS cnt FROM companies GROUP BY normalized_name HAVING COUNT(*) > 1
		) s
	`).Scan(&clusterCount, &extraRows)
	return clusterCount, extraRows, err
}

func CanonicalID(cluster CompanyCluster) string {
	if len(cluster.Members) == 0 {
		return ""
	}
	best := cluster.Members[0]
	for _, m := range cluster.Members[1:] {
		if m.ConfidenceScore != nil && best.ConfidenceScore != nil && *m.ConfidenceScore > *best.ConfidenceScore {
			best = m
		}
	}
	return best.ID
}

func FormatClusterHint(c CompanyCluster) string {
	return fmt.Sprintf("%s (%d records, score %.0f) → canonical %s", c.NormalizedName, c.Count, c.MatchScore, CanonicalID(c))
}
