package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const cargoEstimatesBackfillJobType = "cargo_estimates_backfill"

type CargoEstimatesBackfillOptions struct {
	LookbackDays   int     `json:"lookback_days,omitempty"`
	Limit          int     `json:"limit,omitempty"`
	MinDraftDeltaM float64 `json:"min_draft_delta_m,omitempty"`
}

type CargoEstimatesBackfillResult struct {
	RowsWritten    int64 `json:"rows_written"`
	LookbackDays   int   `json:"lookback_days"`
	DurationMillis int64 `json:"duration_ms"`
}

func (s *Service) processCargoEstimatesBackfill(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := CargoEstimatesBackfillOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.BackfillCargoEstimates(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) BackfillCargoEstimates(ctx context.Context, opts CargoEstimatesBackfillOptions) (CargoEstimatesBackfillResult, error) {
	started := time.Now()
	if opts.LookbackDays <= 0 {
		opts.LookbackDays = 21
	}
	if opts.Limit <= 0 {
		opts.Limit = 5000
	}
	if opts.MinDraftDeltaM <= 0 {
		opts.MinDraftDeltaM = 0.6
	}

	tag, err := s.pool.Exec(ctx, cargoEstimatesBackfillSQL, opts.LookbackDays, opts.MinDraftDeltaM, opts.Limit)
	res := CargoEstimatesBackfillResult{
		RowsWritten:    tag.RowsAffected(),
		LookbackDays:   opts.LookbackDays,
		DurationMillis: time.Since(started).Milliseconds(),
	}
	return res, err
}

const cargoEstimatesBackfillSQL = `
WITH draft_stats AS (
	SELECT
		a.mmsi,
		COALESCE(v.id, ve.vessel_id) AS vessel_id,
		MAX(COALESCE(ve.deadweight_tons, 0)) AS dwt,
		MIN(a.draft_m) AS min_draft_m,
		MAX(a.draft_m) AS max_draft_m,
		(ARRAY_AGG(a.draft_m ORDER BY a.ts DESC))[1] AS latest_draft_m,
		(ARRAY_AGG(a.ts ORDER BY a.ts DESC))[1] AS latest_ts,
		(ARRAY_AGG(COALESCE(a.destination, '') ORDER BY a.ts DESC))[1] AS latest_destination,
		(ARRAY_AGG(COALESCE(ve.vessel_class, v.vessel_type, '') ORDER BY a.ts DESC))[1] AS vessel_class
	FROM ais_positions a
	LEFT JOIN vessels v ON v.mmsi = a.mmsi
	LEFT JOIN vessel_enrichment ve ON ve.mmsi = a.mmsi
	WHERE a.ts >= now() - ($1::int * interval '1 day')
	  AND a.draft_m IS NOT NULL
	  AND a.draft_m > 0
	GROUP BY a.mmsi, COALESCE(v.id, ve.vessel_id)
),
eligible AS (
	SELECT
		*,
		(max_draft_m - min_draft_m) AS draft_delta_m,
		LEAST(
			dwt,
			GREATEST(0::numeric, ((max_draft_m - min_draft_m) / NULLIF(max_draft_m, 0))::numeric * dwt)
		) AS payload_best
	FROM draft_stats
	WHERE vessel_id IS NOT NULL
	  AND dwt > 0
	  AND max_draft_m > 0
	  AND (max_draft_m - min_draft_m) >= $2
),
ranked AS (
	SELECT *
	FROM eligible
	ORDER BY latest_ts DESC, payload_best DESC
	LIMIT $3
)
INSERT INTO cargo_estimates (
	vessel_id,
	payload_tons,
	payload_low,
	payload_best,
	payload_high,
	method,
	confidence_score,
	observed_at,
	product_family,
	quantity_unit,
	evidence,
	source_payload
)
SELECT
	vessel_id,
	ROUND(payload_best, 2),
	ROUND(GREATEST(0::numeric, payload_best * 0.75), 2),
	ROUND(payload_best, 2),
	ROUND(LEAST(dwt, payload_best * 1.25), 2),
	'ais_draft_delta_v1',
	ROUND(LEAST(0.78, 0.38 + ((draft_delta_m / NULLIF(max_draft_m, 0)) * 0.6))::numeric, 2),
	latest_ts,
	CASE
		WHEN lower(vessel_class) LIKE '%lng%' THEN 'lng'
		WHEN lower(vessel_class) LIKE '%lpg%' THEN 'lpg'
		WHEN lower(vessel_class) LIKE '%chemical%' OR lower(vessel_class) LIKE '%product%' THEN 'oil_products'
		WHEN lower(vessel_class) LIKE '%tanker%' OR lower(vessel_class) LIKE '%oil%' THEN 'crude_oil'
		ELSE 'petroleum_liquids'
	END,
	'tons',
	jsonb_build_array(
		jsonb_build_object(
			'label', 'estimated',
			'source', 'ais_positions',
			'method', 'draft_delta_x_dwt_over_observed_max_draft',
			'min_draft_m', ROUND(min_draft_m::numeric, 2),
			'max_draft_m', ROUND(max_draft_m::numeric, 2),
			'draft_delta_m', ROUND(draft_delta_m::numeric, 2),
			'deadweight_tons', ROUND(dwt, 2)
		)
	),
	jsonb_build_object(
		'generator', 'cargo_estimates_backfill_v1',
		'mmsi', mmsi,
		'latest_destination', latest_destination,
		'vessel_class', vessel_class,
		'lookback_days', $1
	)
FROM ranked
ON CONFLICT (vessel_id, method, observed_at) WHERE method = 'ais_draft_delta_v1' AND vessel_id IS NOT NULL
DO UPDATE SET
	payload_tons = EXCLUDED.payload_tons,
	payload_low = EXCLUDED.payload_low,
	payload_best = EXCLUDED.payload_best,
	payload_high = EXCLUDED.payload_high,
	confidence_score = EXCLUDED.confidence_score,
	product_family = EXCLUDED.product_family,
	evidence = EXCLUDED.evidence,
	source_payload = EXCLUDED.source_payload
`
