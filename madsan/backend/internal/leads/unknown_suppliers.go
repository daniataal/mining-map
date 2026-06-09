package leads

import (
	"context"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const TierInferred = "inferred"

// UnknownSupplierParams filters trade-flow gap lead queries.
type UnknownSupplierParams struct {
	CountryCode string
	Commodity   string
	Limit       int
}

// UnknownSupplierLead is a ranked inferred lead from corridor/asset gaps.
type UnknownSupplierLead struct {
	CountryCode   string   `json:"country_code"`
	Commodity     string   `json:"commodity"`
	GapAssetCount int      `json:"gap_asset_count"`
	OperatorHints []string `json:"operator_hints,omitempty"`
	AvgConfidence float64  `json:"avg_confidence"`
	RankScore     float64  `json:"rank_score"`
	Tier          string   `json:"tier"`
	Detail        string   `json:"detail"`
}

// LeadRankScore scores a trade-flow gap corridor for unknown-supplier discovery.
func LeadRankScore(gapAssetCount, operatorHintCount int, avgConfidence float64) float64 {
	score := float64(gapAssetCount)*3 + float64(operatorHintCount)*5 + avgConfidence*0.2
	return math.Round(score*100) / 100
}

// UnknownSupplierLeads ranks corridors where petroleum assets exist but no supplier company is linked.
func UnknownSupplierLeads(ctx context.Context, pool *pgxpool.Pool, p UnknownSupplierParams) ([]UnknownSupplierLead, error) {
	limit := p.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}

	country := strings.TrimSpace(p.CountryCode)
	commodity := strings.TrimSpace(p.Commodity)

	rows, err := pool.Query(ctx, `
		WITH asset_gaps AS (
			SELECT
				a.country_code,
				a.commodities_supported,
				COALESCE(a.confidence_score, 0) AS confidence_score,
				NULLIF(TRIM(COALESCE(
					a.raw_source_payload->'tags'->>'operator',
					a.raw_source_payload->>'operator_name',
					a.raw_source_payload->>'operator'
				)), '') AS operator_hint
			FROM assets a
			WHERE a.operator_company_id IS NULL
			  AND a.country_code IS NOT NULL AND a.country_code <> ''
			  AND a.asset_type IN ('terminal', 'storage', 'refinery', 'port', 'tank_farm', 'tank')
			  AND (
					cardinality(a.commodities_supported) > 0
					OR a.asset_type IN ('terminal', 'refinery', 'storage', 'tank_farm', 'tank')
			  )
		),
		expanded AS (
			SELECT
				country_code,
				CASE
					WHEN cardinality(commodities_supported) > 0 THEN unnest(commodities_supported)
					ELSE 'petroleum'
				END AS commodity,
				confidence_score,
				operator_hint
			FROM asset_gaps
		),
		corridor_gaps AS (
			SELECT
				country_code,
				commodity,
				COUNT(*)::int AS gap_asset_count,
				AVG(confidence_score) AS avg_confidence,
				array_agg(DISTINCT operator_hint) FILTER (
					WHERE operator_hint IS NOT NULL AND operator_hint <> ''
				) AS operator_hints
			FROM expanded
			GROUP BY country_code, commodity
		)
		SELECT country_code, commodity, gap_asset_count, avg_confidence, operator_hints
		FROM corridor_gaps
		WHERE ($1 = '' OR country_code ILIKE $1)
		  AND ($2 = '' OR commodity ILIKE $2 OR commodity ILIKE '%' || $2 || '%')
		ORDER BY gap_asset_count DESC, avg_confidence DESC
		LIMIT $3
	`, country, commodity, limit*2)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []UnknownSupplierLead
	for rows.Next() {
		var lead UnknownSupplierLead
		var hints []string
		if err := rows.Scan(&lead.CountryCode, &lead.Commodity, &lead.GapAssetCount, &lead.AvgConfidence, &hints); err != nil {
			continue
		}
		if hints == nil {
			hints = []string{}
		}
		if len(hints) > 5 {
			hints = hints[:5]
		}
		lead.OperatorHints = hints
		lead.AvgConfidence = math.Round(lead.AvgConfidence*100) / 100
		lead.RankScore = LeadRankScore(lead.GapAssetCount, len(hints), lead.AvgConfidence)
		lead.Tier = TierInferred
		lead.Detail = tradeFlowGapDetail(lead.CountryCode, lead.Commodity, lead.GapAssetCount, len(hints))
		out = append(out, lead)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].RankScore != out[j].RankScore {
			return out[i].RankScore > out[j].RankScore
		}
		return out[i].GapAssetCount > out[j].GapAssetCount
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func tradeFlowGapDetail(country, commodity string, gapAssets, hintCount int) string {
	if hintCount > 0 {
		return strings.TrimSpace(country + " " + commodity + ": " +
			strconv.Itoa(gapAssets) + " assets without linked supplier; " +
			strconv.Itoa(hintCount) + " operator name hints to verify")
	}
	return strings.TrimSpace(country + " " + commodity + ": " +
		strconv.Itoa(gapAssets) + " petroleum assets with no mapped supplier company")
}
